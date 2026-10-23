import { alignStatements, type StatementSignature } from './diff/align.js';
import { buildModel, type QueryModel } from './diff/model.js';
import { SEVERITY } from './diff/severity.js';
import { diffStatements, type Change } from './diff/structural.js';
import { code } from './diff/text.js';
import { symmetricDiff, tokenDiff, type Segment } from './diff/token.js';
import { caseInsensitiveWords, tokenKey } from './keywords.js';
import { lineColumn } from './location.js';
import {
  createNormalizer,
  RULES,
  type AnalyzedStatement,
  type NormalizerCache,
  type NormToken,
  type SideSnapshot,
} from './normalize/index.js';
import type { ParserAdapter } from './parse.js';
import { splitStatements } from './split.js';
import { isTrivia, tokenize, type Token } from './tokenize.js';
import { deriveVerdict, emptyStats } from './verdict.js';
import type {
  CompareOptions,
  ComparisonResult,
  Dialect,
  Difference,
  ParseIssue,
  SourceRange,
  StatementInfo,
  StatementPair,
} from './types.js';

export { lineColumn };

type Side = 'left' | 'right';
const SIDES = ['left', 'right'] as const;

function analyzeSide(
  side: Side,
  text: string,
  options: CompareOptions,
  parser: ParserAdapter | null,
  errors: ParseIssue[],
): Array<AnalyzedStatement & { info: StatementInfo }> {
  return splitStatements(text, options.dialect).map((statement) => {
    const info: StatementInfo = {
      index: statement.index,
      start: statement.start,
      end: statement.end,
      kind: statement.kind,
      status: 'skipped',
    };
    if (!parser) return { statement, status: 'skipped', info };
    const parsed = parser.parse(statement);
    if (parsed.status === 'parsed') {
      return { statement, status: 'parsed', ast: parsed.ast, info: { ...info, status: 'parsed' } };
    }
    if (parsed.status === 'unsupported') {
      return {
        statement,
        status: 'unsupported',
        info: { ...info, status: 'unsupported', message: parsed.reason },
      };
    }
    const offset = statement.start + Math.min(parsed.offset, statement.text.length);
    errors.push({
      side,
      statementIndex: statement.index,
      message: parsed.message,
      offset,
      ...lineColumn(text, offset),
    });
    return {
      statement,
      status: 'error',
      info: { ...info, status: 'error', message: parsed.message },
    };
  });
}

/** A parser that parses each distinct statement text once (results are read-only). */
function memoized(parser: ParserAdapter): ParserAdapter {
  const results = new Map<string, ReturnType<ParserAdapter['parse']>>();
  return {
    name: parser.name,
    dialect: parser.dialect,
    canonical: (ast, mode) => parser.canonical(ast, mode),
    parse(statement) {
      const key = `${statement.opaque ?? ''}\u0000${statement.text}`;
      let result = results.get(key);
      if (!result) {
        result = parser.parse(statement);
        results.set(key, result);
      }
      return result;
    },
  };
}

const UNANALYZABLE = new Set(['error', 'unsupported']);
const RULE_LEVEL = new Map(RULES.map((r) => [r.id, r.level]));
const RULE_TITLE = new Map(RULES.map((r) => [r.id, r.title]));
const MAX_SNIPPET = 48;
const SEPARATORS = new Set([',', '(', ')', ';', 'AND', 'OR']);

function snippet(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > MAX_SNIPPET ? `${s.slice(0, MAX_SNIPPET - 1)}…` : s;
}

interface Residual {
  left: Set<number>;
  right: Set<number>;
}

/** Source starts of normalized tokens that still differ between the two sides. */
function residual(left: NormToken[], right: NormToken[], dialect: Dialect): Residual {
  const keywords = caseInsensitiveWords(dialect);
  const key = (t: NormToken) => tokenKey(t, keywords);
  const out = { left: new Set<number>(), right: new Set<number>() };
  let a = 0;
  let b = 0;
  for (const change of symmetricDiff(left.map(key), right.map(key))) {
    if (change.removed) {
      for (let k = 0; k < change.count; k++) out.left.add(left[a + k]!.start);
      a += change.count;
    } else if (change.added) {
      for (let k = 0; k < change.count; k++) out.right.add(right[b + k]!.start);
      b += change.count;
    } else {
      a += change.count;
      b += change.count;
    }
  }
  return out;
}

interface Resolution {
  resolved: boolean;
  rules: string[];
}

type Starts = { left: Array<{ start: number }>; right: Array<{ start: number }> };

/**
 * Is a token-level change explained by normalization? None of its tokens may
 * still differ after normalization, and either a rule rewrote, moved or dropped
 * one of them, or the normalized statements are identical (then a token can be
 * the unchanged counterpart of tokens a rule moved on the other side).
 */
function resolve(
  tokens: Starts,
  snapshots: { left: SideSnapshot; right: SideSnapshot },
  still: Residual,
  context: Starts,
): Resolution {
  const rules = new Set<string>();
  for (const side of SIDES) {
    for (const t of tokens[side]) {
      if (still[side].has(t.start)) return { resolved: false, rules: [] };
      for (const r of snapshots[side].touched.get(t.start) ?? []) rules.add(r);
    }
  }
  if (rules.size > 0) return { resolved: true, rules: [...rules] };
  if (still.left.size + still.right.size > 0) return { resolved: false, rules: [] };
  // Identical after normalization: credit the rules applied in the surrounding statement.
  for (const side of SIDES) {
    for (const t of context[side]) {
      for (const r of snapshots[side].touched.get(t.start) ?? []) rules.add(r);
    }
  }
  return { resolved: true, rules: [...rules] };
}

function tokensIn(significant: Token[], range: SourceRange | undefined): Token[] {
  if (!range) return [];
  return significant.filter((t) => t.start >= range.start && t.end <= range.end);
}

/** Per-side data: statements, their tokens, and which statement owns each token. */
interface SideData {
  text: string;
  significant: Token[];
  infos: StatementInfo[];
  /** Significant-token index range owned by each statement (terminator included). */
  owned: Array<[number, number]>;
  /** Owning statement of a source position (-1 when the side has no statements). */
  owner: (pos: number) => number;
}

function sideData(text: string, infos: StatementInfo[], dialect: Dialect): SideData {
  const significant = tokenize(text, dialect).filter((t) => !isTrivia(t));
  const starts = infos.map((s) => s.start);
  const owner = (pos: number) => {
    if (starts.length === 0) return -1;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const owned = infos.map((): [number, number] => [0, 0]);
  significant.forEach((t, i) => {
    const k = owner(t.start);
    if (k === -1) return;
    const range = owned[k]!;
    if (range[1] === 0 || range[1] <= range[0]) range[0] = i;
    range[1] = i + 1;
  });
  // Statements own contiguous token runs; make empty ones point at the right place.
  for (let k = 0; k < owned.length; k++) {
    const r = owned[k]!;
    if (r[1] <= r[0]) {
      const at = k > 0 ? owned[k - 1]![1] : 0;
      owned[k] = [at, at];
    }
  }
  return { text, significant, infos, owned, owner };
}

/** Normalized tokens of each statement (its own tokens, terminator excluded). */
function statementTokens(snapshot: SideSnapshot, side: SideData): NormToken[][] {
  const out = side.infos.map((): NormToken[] => []);
  for (const t of snapshot.tokens) {
    const k = side.owner(t.start);
    const info = side.infos[k];
    if (info && t.start >= info.start && t.start < info.end) out[k]!.push(t);
  }
  return out;
}

function rangeOf(tokens: NormToken[]): { start: number; end: number } | null {
  if (tokens.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const t of tokens) {
    start = Math.min(start, t.start);
    end = Math.max(end, t.end);
  }
  return { start, end };
}

/** Top-level clause of a model containing token `index`, as a path. */
function locate(model: QueryModel | null, index: number, fallback: string): string[] {
  if (!model) return [fallback];
  const clause = model.clauses.find((c) => c.span.start <= index && index < c.span.end);
  return clause ? [model.kind, clause.name] : [model.kind || fallback];
}

/**
 * Compare two SQL inputs (PLAN §5.5).
 *
 * 1. Both inputs are split into statements, normalized (L1 + L2, plus L3 when
 *    aggressive) and statements are aligned across the inputs.
 * 2. Token diff of each aligned pair: whitespace / comment / keyword-case
 *    changes are `formatting`; everything else is a candidate change. A
 *    candidate that disappears after normalization is `structural`
 *    (`formatting` if only L1 rules explain it), with the rules that resolved it.
 * 3. What remains is potentially `semantic`. For pairs the parser accepted, the
 *    clause-aware differ describes it (path, description, severity, precise
 *    ranges); in statements that couldn't be parsed it is `unknown`. At L2, an
 *    L3 dry run adds a hint to semantic changes aggressive mode would resolve.
 */
export function compare(
  left: string,
  right: string,
  options: CompareOptions,
  parser: ParserAdapter | null = null,
): ComparisonResult {
  const errors: ParseIssue[] = [];
  // Most statements appear on both sides unchanged: parse each text once.
  if (parser) parser = memoized(parser);
  const analyzed = {
    left: analyzeSide('left', left, options, parser, errors),
    right: analyzeSide('right', right, options, parser, errors),
  };
  const statements = {
    left: analyzed.left.map((a) => a.info),
    right: analyzed.right.map((a) => a.info),
  };
  const keywords = caseInsensitiveWords(options.dialect);

  const normalizeOptions = {
    dialect: options.dialect,
    level: options.level,
    disabledRules: new Set(options.disabledRules ?? []),
    caseInsensitiveTables: options.caseInsensitiveTables ?? false,
  };
  const cache: NormalizerCache = new Map();
  const normalizers = {
    left: createNormalizer('left', left, analyzed.left, normalizeOptions, parser, cache),
    right: createNormalizer('right', right, analyzed.right, normalizeOptions, parser, cache),
  };
  const level = options.level >= 3 ? 3 : 2;
  const snapshots = {
    left: normalizers.left.snapshot(level),
    right: normalizers.right.snapshot(level),
  };
  const data = {
    left: sideData(left, statements.left, options.dialect),
    right: sideData(right, statements.right, options.dialect),
  };

  // --- 1. Statement alignment ------------------------------------------------
  const normalized = {
    left: statementTokens(snapshots.left, data.left),
    right: statementTokens(snapshots.right, data.right),
  };
  const models = {
    left: new Map<number, QueryModel>(),
    right: new Map<number, QueryModel>(),
  };
  const modelOf = (side: Side, k: number): QueryModel | null => {
    if (statements[side][k]?.status !== 'parsed') return null;
    let model = models[side].get(k);
    if (!model) {
      model = buildModel(normalized[side][k]!, statements[side][k]!.kind, { keywords });
      models[side].set(k, model);
    }
    return model;
  };
  const signature = (side: Side, k: number): StatementSignature => {
    const model = modelOf(side, k);
    const target = model?.target;
    return {
      kind: model?.kind || statements[side][k]!.kind,
      target: target ? (target.name ?? target.key) : '',
      keys: normalized[side][k]!.map((t) => tokenKey(t, keywords)),
    };
  };
  const alignment = alignStatements(
    statements.left.map((_, k) => signature('left', k)),
    statements.right.map((_, k) => signature('right', k)),
  );
  const kindOf = (l: number | null, r: number | null) => {
    if (r !== null) return modelOf('right', r)?.kind || statements.right[r]!.kind;
    return l !== null ? modelOf('left', l)?.kind || statements.left[l]!.kind : '';
  };
  const pairs: StatementPair[] = alignment.pairs.map((p, index) => ({
    index,
    left: p.left,
    right: p.right,
    status: p.moved
      ? 'moved'
      : p.left === null
        ? 'added'
        : p.right === null
          ? 'removed'
          : 'unchanged',
    kind: kindOf(p.left, p.right),
  }));
  // Neither side has a statement (empty or comment-only input): one pseudo pair.
  if (pairs.length === 0) {
    pairs.push({ index: 0, left: null, right: null, status: 'unchanged', kind: '' });
  }
  const pairOf = {
    left: new Map(pairs.filter((p) => p.left !== null).map((p) => [p.left!, p.index])),
    right: new Map(pairs.filter((p) => p.right !== null).map((p) => [p.right!, p.index])),
  };

  // One token-diff segment per aligned pair. Segments of statements in place
  // are in order on both sides and diffed together; a moved statement's
  // segment is diffed on its own.
  const moved = {
    left: new Set(pairs.flatMap((p) => (p.status === 'moved' ? [p.left!] : []))),
    right: new Set(pairs.flatMap((p) => (p.status === 'moved' ? [p.right!] : []))),
  };
  const steps = alignment.steps.length > 0 ? alignment.steps : [{ left: null, right: null }];
  const segments: Array<Segment & { pair: number; left0: number | null; right0: number | null }> =
    [];
  const position = { left: 0, right: 0 };
  for (const step of steps) {
    if (
      (step.left !== null && moved.left.has(step.left)) ||
      (step.right !== null && moved.right.has(step.right))
    ) {
      continue;
    }
    const range = (side: Side): [number, number] => {
      const k = step[side];
      return k === null ? [position[side], position[side]] : data[side].owned[k]!;
    };
    const l = range('left');
    const r = range('right');
    position.left = l[1];
    position.right = r[1];
    const pair =
      step.left !== null
        ? (pairOf.left.get(step.left) ?? 0)
        : step.right !== null
          ? (pairOf.right.get(step.right) ?? 0)
          : 0;
    segments.push({ left: l, right: r, pair, left0: step.left, right0: step.right });
  }
  const inPlace = segments.length;
  for (const p of pairs) {
    if (p.status !== 'moved') continue;
    segments.push({
      left: data.left.owned[p.left!]!,
      right: data.right.owned[p.right!]!,
      pair: p.index,
      left0: p.left,
      right0: p.right,
    });
  }
  // A side without statements (only stray `;`): its tokens join the first segment.
  for (const side of SIDES) {
    if (statements[side].length === 0 && data[side].significant.length > 0) {
      segments[0]![side] = [0, data[side].significant.length];
    }
  }
  const segmentOf = { left: new Map<number, number>(), right: new Map<number, number>() };
  segments.forEach((s, i) => {
    if (s.left0 !== null) segmentOf.left.set(s.left0, i);
    if (s.right0 !== null) segmentOf.right.set(s.right0, i);
  });

  /** Normalized tokens (statement + terminators/stray tokens) of each segment. */
  const segmentNorm = (snapshot: { left: SideSnapshot; right: SideSnapshot }) => {
    const out = segments.map(() => ({ left: [] as NormToken[], right: [] as NormToken[] }));
    for (const side of SIDES) {
      for (const t of snapshot[side].tokens) {
        const k = data[side].owner(t.start);
        const seg = k === -1 ? 0 : (segmentOf[side].get(k) ?? 0);
        out[seg]![side].push(t);
      }
    }
    return out;
  };
  const segmentTokens = segments.map((s) => ({
    left: data.left.significant.slice(...s.left),
    right: data.right.significant.slice(...s.right),
  }));
  const hunkTokens = (d: Difference) => ({
    left: tokensIn(segmentTokens[d.statementPair]!.left, d.left),
    right: tokensIn(segmentTokens[d.statementPair]!.right, d.right),
  });

  // --- 2. Token diff + classification ---------------------------------------
  // While processing, `statementPair` holds the segment index.
  let differences: Difference[] = [];
  if (left !== right) {
    differences = tokenDiff(left, right, options.dialect, segments.slice(0, inPlace));
    for (let k = inPlace; k < segments.length; k++) {
      for (const d of tokenDiff(left, right, options.dialect, [segments[k]!])) {
        differences.push({ ...d, id: `m${k}-${d.id}`, statementPair: k });
      }
    }
  }

  const residuals = segmentNorm(snapshots).map((n) => residual(n.left, n.right, options.dialect));
  differences = differences.map((d) => {
    if (d.class !== 'semantic') return d;
    const seg = d.statementPair;
    const { resolved, rules } = resolve(
      hunkTokens(d),
      snapshots,
      residuals[seg]!,
      segmentTokens[seg]!,
    );
    if (!resolved) return d;
    const formattingOnly = rules.every((r) => RULE_LEVEL.get(r) === 1);
    return {
      ...d,
      class: formattingOnly ? 'formatting' : 'structural',
      severity: 'info',
      resolvedBy: rules
        .sort((a, b) => (RULE_LEVEL.get(b) ?? 0) - (RULE_LEVEL.get(a) ?? 0))
        .join(','),
    };
  });

  // --- 3. Semantic differences, per segment ----------------------------------
  let nextId = 0;
  const newId = () => `s${++nextId}`;
  const statementRange = (side: Side, k: number): SourceRange => ({
    side,
    start: statements[side][k]!.start,
    end: statements[side][k]!.end,
  });
  const emittedMoves = new Set<number>();
  /** Statement-level differences (added / removed / moved statements). */
  const statementLevel = new Set<string>();
  const refined: Difference[] = [];

  segments.forEach((segment, seg) => {
    const inSegment = differences.filter((d) => d.statementPair === seg);
    const still = residuals[seg]!;
    const stillDiffers = still.left.size + still.right.size > 0;
    let candidates = inSegment.filter((d) => d.class === 'semantic');
    let others = inSegment.filter((d) => d.class !== 'semantic');
    const pair = pairs[segment.pair]!;

    // Guard: if the normalized statements still differ, something must stay semantic.
    if (stillDiffers && candidates.length === 0) {
      const resolvedByRules = (d: Difference) => d.resolvedBy !== undefined;
      candidates = others.filter(resolvedByRules).map((d) => {
        const reverted: Difference = {
          ...d,
          class: 'semantic',
          severity: SEVERITY['statement.other'],
        };
        delete reverted.resolvedBy;
        return reverted;
      });
      others = others.filter((d) => !resolvedByRules(d));
    }
    const othersFrom = refined.length;
    refined.push(...others);
    const path = [pair.kind || 'Statement'];
    if (pair.status === 'moved' && !emittedMoves.has(pair.index)) {
      emittedMoves.add(pair.index);
      const l = pair.left!;
      const r = pair.right!;
      const id = newId();
      statementLevel.add(id);
      refined.push({
        id,
        statementPair: seg,
        path,
        kind: 'moved',
        class: 'semantic',
        severity: SEVERITY['statement.moved'],
        description: `Statement ${code(snippet(data.right.text.slice(statements.right[r]!.start, statements.right[r]!.end)))} moved from position ${l + 1} to ${r + 1}`,
        left: statementRange('left', l),
        right: statementRange('right', r),
      });
    }
    if (candidates.length === 0 && !stillDiffers) return;

    // Statement added or removed: one difference for the whole statement.
    if (pair.status === 'added' || pair.status === 'removed') {
      const side: Side = pair.status === 'added' ? 'right' : 'left';
      const k = pair[side]!;
      const other = candidates[0]?.[side === 'left' ? 'right' : 'left'];
      const id = newId();
      statementLevel.add(id);
      refined.push({
        id,
        statementPair: seg,
        path,
        kind: pair.status,
        class: 'semantic',
        severity: SEVERITY[pair.status === 'added' ? 'statement.added' : 'statement.removed'],
        description: `${pair.status === 'added' ? 'Added' : 'Removed'} statement ${code(snippet(data[side].text.slice(statements[side][k]!.start, statements[side][k]!.end)))}`,
        [side]: statementRange(side, k),
        ...(other ? { [side === 'left' ? 'right' : 'left']: other } : {}),
      } as Difference);
      return;
    }

    if (pair.left === null || pair.right === null) {
      // Pseudo pair of inputs without statements (stray `;`).
      refined.push(...candidates);
      if (candidates.length === 0 && stillDiffers) refined.push(residualDifference(seg));
      return;
    }
    const l = pair.left;
    const r = pair.right;
    const lm = modelOf('left', l);
    const rm = modelOf('right', r);
    const leftNorm = normalized.left[l]!;
    const rightNorm = normalized.right[r]!;
    const index = new Map(leftNorm.map((t, i) => [t.start, i]));
    const rIndex = new Map(rightNorm.map((t, i) => [t.start, i]));
    const located = (d: Difference): string[] => {
      const ht = hunkTokens(d);
      const li = ht.left.map((t) => index.get(t.start)).find((i) => i !== undefined);
      if (li !== undefined) return locate(lm, li, path[0]!);
      const ri = ht.right.map((t) => rIndex.get(t.start)).find((i) => i !== undefined);
      return ri !== undefined ? locate(rm, ri, path[0]!) : path;
    };
    // Formatting and structural changes get their clause too.
    for (let k = othersFrom; k < othersFrom + others.length; k++) {
      refined[k] = { ...refined[k]!, path: located(refined[k]!) };
    }

    const describable =
      lm !== null &&
      rm !== null &&
      (lm.kind !== rm.kind ||
        lm.clauses.length + rm.clauses.length > 0 ||
        !!(lm.target ?? rm.target) ||
        !!(lm.branches ?? rm.branches));
    if (!describable) {
      // No clause model (unparsed statement, Generic dialect, or a statement
      // kind without one): keep the token-level description.
      refined.push(...candidates.map((d) => ({ ...d, path: located(d) })));
      if (candidates.length === 0 && stillDiffers) refined.push(residualDifference(seg));
      return;
    }

    const indices = (tokens: NormToken[], set: Set<number>) =>
      new Set(tokens.flatMap((t, i) => (set.has(t.start) ? [i] : [])));
    const changes = diffStatements(
      lm!,
      rm!,
      {
        left: { tokens: leftNorm, source: left, residual: indices(leftNorm, still.left) },
        right: { tokens: rightNorm, source: right, residual: indices(rightNorm, still.right) },
      },
      keywords,
    );
    const starts = (tokens: NormToken[], range: { start: number; end: number } | null) =>
      range ? tokens.slice(range.start, range.end).map((t) => t.start) : [];
    // Keep changes whose items still differ after normalization.
    const kept = changes
      .map((c) => ({
        change: c,
        left: starts(leftNorm, c.scope.left),
        right: starts(rightNorm, c.scope.right),
      }))
      .filter(
        (c) => c.left.some((s) => still.left.has(s)) || c.right.some((s) => still.right.has(s)),
      );
    const explained = (d: Difference) => {
      const ht = hunkTokens(d);
      const ls = new Set(ht.left.map((t) => t.start));
      const rs = new Set(ht.right.map((t) => t.start));
      return kept.some((c) => c.left.some((s) => ls.has(s)) || c.right.some((s) => rs.has(s)));
    };
    const residualIn = (d: Difference) => {
      const ht = hunkTokens(d);
      return (
        ht.left.some((t) => still.left.has(t.start)) ||
        ht.right.some((t) => still.right.has(t.start))
      );
    };
    // Leftover separators (`,` `(` `)` AND OR) of a described list edit need no entry of their own.
    const onlySeparators = (d: Difference) => {
      const ht = hunkTokens(d);
      const residualTokens = [
        ...ht.left.filter((t) => still.left.has(t.start)),
        ...ht.right.filter((t) => still.right.has(t.start)),
      ];
      return residualTokens.every(
        (t) =>
          ((t.type === 'punctuation' || t.type === 'operator') && SEPARATORS.has(t.text)) ||
          (t.type === 'word' && SEPARATORS.has(t.text.toUpperCase())),
      );
    };
    const uncovered = candidates.filter(
      (d) => !explained(d) && residualIn(d) && !(kept.length > 0 && onlySeparators(d)),
    );
    for (const c of kept) {
      refined.push(toDifference(c.change, seg, leftNorm, rightNorm, l, r));
    }
    refined.push(...uncovered.map((d) => ({ ...d, path: located(d) })));
    if (kept.length === 0 && uncovered.length === 0) {
      // Nothing described the remaining difference: keep the token-level changes.
      refined.push(...candidates.map((d) => ({ ...d, path: located(d) })));
      if (candidates.length === 0) refined.push(residualDifference(seg));
    }
  });

  /** Fallback when normalized tokens differ but no token-level change shows it. */
  function residualDifference(seg: number): Difference {
    const still = residuals[seg]!;
    const norm = segmentNorm(snapshots)[seg]!;
    const pair = pairs[segments[seg]!.pair]!;
    const range = (side: Side): SourceRange => {
      const r = rangeOf(norm[side].filter((t) => still[side].has(t.start)));
      if (r) return { side, ...r };
      const k = pair[side];
      const at = k === null ? 0 : statements[side][k]!.start;
      return { side, start: at, end: at };
    };
    return {
      id: newId(),
      statementPair: seg,
      path: [pair.kind || 'Statement'],
      kind: 'changed',
      class: 'semantic',
      severity: SEVERITY['statement.other'],
      description: 'Changed after normalization',
      left: range('left'),
      right: range('right'),
    };
  }

  function toDifference(
    c: Change,
    seg: number,
    leftNorm: NormToken[],
    rightNorm: NormToken[],
    l: number,
    r: number,
  ): Difference {
    const range = (
      side: Side,
      tokens: NormToken[],
      span: Change['left'],
      at: number,
    ): SourceRange => {
      const found = span ? rangeOf(tokens.slice(span.start, span.end)) : null;
      if (found) return { side, ...found };
      // Insertion point: after the token before `at` (or the statement start).
      const before = tokens[at - 1];
      const pos = before
        ? before.end
        : (tokens[at]?.start ?? statements[side][side === 'left' ? l : r]!.start);
      return { side, start: pos, end: pos };
    };
    return {
      id: newId(),
      statementPair: seg,
      path: c.path,
      kind: c.kind,
      class: 'semantic',
      severity: c.severity,
      description: c.description,
      left: range('left', leftNorm, c.left, c.leftAt),
      right: range('right', rightNorm, c.right, c.rightAt),
    };
  }

  differences = refined;

  // L3 dry run: hint at changes aggressive normalization would resolve.
  if (level === 2 && options.level >= 2 && differences.some((d) => d.class === 'semantic')) {
    // Only statements with semantic differences need the dry run.
    const only = { left: new Set<number>(), right: new Set<number>() };
    for (const d of differences) {
      if (d.class !== 'semantic') continue;
      const pair = pairs[segments[d.statementPair]!.pair]!;
      if (pair.left !== null) only.left.add(pair.left);
      if (pair.right !== null) only.right.add(pair.right);
    }
    const dry = {
      left: normalizers.left.snapshot(3, only.left),
      right: normalizers.right.snapshot(3, only.right),
    };
    const dryResiduals = segmentNorm(dry).map((n) => residual(n.left, n.right, options.dialect));
    differences = differences.map((d) => {
      if (d.class !== 'semantic') return d;
      const seg = d.statementPair;
      const { resolved, rules } = resolve(
        hunkTokens(d),
        dry,
        dryResiduals[seg]!,
        segmentTokens[seg]!,
      );
      const l3 = rules.filter((r) => RULE_LEVEL.get(r) === 3);
      if (!resolved || l3.length === 0) return d;
      return {
        ...d,
        l3Hint: `May be structural under aggressive normalization (${l3.map((r) => RULE_TITLE.get(r)).join(', ')})`,
      };
    });
  }

  // Changes inside statements that couldn't be parsed are `unknown`.
  differences = differences.map((d) => {
    const segment = segments[d.statementPair]!;
    const pair = pairs[segment.pair]!;
    const unanalyzable =
      !statementLevel.has(d.id) &&
      [statements.left[pair.left ?? -1], statements.right[pair.right ?? -1]].some(
        (s) => s !== undefined && UNANALYZABLE.has(s.status),
      );
    return {
      ...d,
      statementPair: segment.pair,
      path: d.path.length > 0 ? d.path : [pair.kind || 'Statement'],
      class: d.class === 'semantic' && unanalyzable ? 'unknown' : d.class,
    };
  });

  differences.sort(
    (x, y) =>
      x.statementPair - y.statementPair ||
      (x.left?.start ?? 0) - (y.left?.start ?? 0) ||
      (x.right?.start ?? 0) - (y.right?.start ?? 0),
  );
  differences = differences.map((d, i) => ({ ...d, id: `d${i + 1}` }));
  for (const p of pairs) {
    if (p.status === 'unchanged' && differences.some((d) => d.statementPair === p.index)) {
      p.status = 'changed';
    }
  }

  const stats = emptyStats();
  for (const d of differences) stats[d.class]++;
  return {
    verdict: deriveVerdict(stats),
    stats,
    differences,
    transformations: [...snapshots.left.transformations, ...snapshots.right.transformations],
    normalizationIssues: [...snapshots.left.issues, ...snapshots.right.issues],
    errors,
    statements,
    pairs,
    parser: parser?.name ?? null,
    views: {
      left: {
        original: left,
        normalized: snapshots.left.text,
        normalizedSources: snapshots.left.sources,
      },
      right: {
        original: right,
        normalized: snapshots.right.text,
        normalizedSources: snapshots.right.sources,
      },
    },
  };
}
