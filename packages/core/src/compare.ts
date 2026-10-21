import { symmetricDiff, tokenDiff } from './diff/token.js';
import { caseInsensitiveWords, tokenKey } from './keywords.js';
import {
  createNormalizer,
  RULES,
  type AnalyzedStatement,
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
} from './types.js';

type Side = 'left' | 'right';

/** 1-based line and column of a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

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

/** Statements a source range touches (an empty range touches the statement containing it). */
function overlapping(statements: StatementInfo[], range: SourceRange | undefined) {
  if (!range) return [];
  return statements.filter((s) =>
    range.start === range.end
      ? s.start <= range.start && range.start <= s.end
      : s.start < range.end && range.start < s.end,
  );
}

const UNANALYZABLE = new Set(['error', 'unsupported']);
const RULE_LEVEL = new Map(RULES.map((r) => [r.id, r.level]));
const RULE_TITLE = new Map(RULES.map((r) => [r.id, r.title]));

/** Source starts of normalized tokens that still differ between the two sides. */
function residual(left: SideSnapshot, right: SideSnapshot, dialect: Dialect) {
  const keywords = caseInsensitiveWords(dialect);
  const key = (t: { type: Token['type']; text: string; start: number; end: number }) =>
    tokenKey(t, keywords);
  const out = { left: new Set<number>(), right: new Set<number>() };
  let a = 0;
  let b = 0;
  for (const change of symmetricDiff(left.tokens.map(key), right.tokens.map(key))) {
    if (change.removed) {
      for (let k = 0; k < change.count; k++) out.left.add(left.tokens[a + k]!.start);
      a += change.count;
    } else if (change.added) {
      for (let k = 0; k < change.count; k++) out.right.add(right.tokens[b + k]!.start);
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

/**
 * Is a token-level change explained by normalization? None of its tokens may
 * still differ after normalization, and either a rule rewrote, moved or dropped
 * one of them, or the normalized inputs are identical overall (then a token can
 * be the unchanged counterpart of tokens a rule moved on the other side).
 */
function resolve(
  tokens: { left: Token[]; right: Token[] },
  snapshots: { left: SideSnapshot; right: SideSnapshot },
  still: { left: Set<number>; right: Set<number> },
  context: { left: Token[]; right: Token[] },
): Resolution {
  const rules = new Set<string>();
  for (const side of ['left', 'right'] as const) {
    for (const t of tokens[side]) {
      if (still[side].has(t.start)) return { resolved: false, rules: [] };
      for (const r of snapshots[side].touched.get(t.start) ?? []) rules.add(r);
    }
  }
  if (rules.size > 0) return { resolved: true, rules: [...rules] };
  if (still.left.size + still.right.size > 0) return { resolved: false, rules: [] };
  // Identical after normalization: credit the rules applied in the surrounding statements.
  for (const side of ['left', 'right'] as const) {
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

/**
 * Compare two SQL inputs (PLAN §5.5).
 *
 * 1. Token diff of the originals: whitespace / comment / keyword-case changes
 *    are `formatting`; everything else is a candidate change.
 * 2. Both sides are normalized (L1 + L2, plus L3 when aggressive). A candidate
 *    change that disappears after normalization is `structural` (`formatting`
 *    if only L1 rules explain it), with the rules that resolved it.
 * 3. What remains is potentially `semantic` (`unknown` inside statements that
 *    couldn't be parsed). At L2, an L3 dry run adds a hint to semantic changes
 *    that aggressive normalization would resolve.
 */
export function compare(
  left: string,
  right: string,
  options: CompareOptions,
  parser: ParserAdapter | null = null,
): ComparisonResult {
  const errors: ParseIssue[] = [];
  const analyzed = {
    left: analyzeSide('left', left, options, parser, errors),
    right: analyzeSide('right', right, options, parser, errors),
  };
  const statements = {
    left: analyzed.left.map((a) => a.info),
    right: analyzed.right.map((a) => a.info),
  };

  const normalizeOptions = {
    dialect: options.dialect,
    level: options.level,
    disabledRules: new Set(options.disabledRules ?? []),
    caseInsensitiveTables: options.caseInsensitiveTables ?? false,
  };
  const normalizers = {
    left: createNormalizer('left', left, analyzed.left, normalizeOptions, parser),
    right: createNormalizer('right', right, analyzed.right, normalizeOptions, parser),
  };
  const level = options.level >= 3 ? 3 : 2;
  const snapshots = {
    left: normalizers.left.snapshot(level),
    right: normalizers.right.snapshot(level),
  };

  let differences: Difference[] = left === right ? [] : tokenDiff(left, right, options.dialect);

  const candidates = differences.filter((d) => d.class === 'semantic');
  if (candidates.length > 0) {
    const significant = {
      left: tokenize(left, options.dialect).filter((t) => !isTrivia(t)),
      right: tokenize(right, options.dialect).filter((t) => !isTrivia(t)),
    };
    const hunkTokens = (d: Difference) => ({
      left: tokensIn(significant.left, d.left),
      right: tokensIn(significant.right, d.right),
    });
    /** Tokens of the statements a difference falls in. */
    const statementTokens = (d: Difference) => {
      const inStatements = (side: Side, range: SourceRange | undefined) => {
        const spans = overlapping(statements[side], range);
        return significant[side].filter((t) =>
          spans.some((s) => t.start >= s.start && t.end <= s.end),
        );
      };
      return { left: inStatements('left', d.left), right: inStatements('right', d.right) };
    };

    const still = residual(snapshots.left, snapshots.right, options.dialect);
    differences = differences.map((d) => {
      if (d.class !== 'semantic') return d;
      const { resolved, rules } = resolve(hunkTokens(d), snapshots, still, statementTokens(d));
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

    // Guard: if the normalized inputs still differ, something must stay semantic.
    const stillDiffers = still.left.size + still.right.size > 0;
    if (stillDiffers && !differences.some((d) => d.class === 'semantic')) {
      const original = new Map(candidates.map((c) => [c.id, c]));
      differences = differences.map((d) => original.get(d.id) ?? d);
    }

    // L3 dry run: hint at changes aggressive normalization would resolve.
    if (level === 2 && options.level >= 2 && differences.some((d) => d.class === 'semantic')) {
      const dry = { left: normalizers.left.snapshot(3), right: normalizers.right.snapshot(3) };
      const stillAtL3 = residual(dry.left, dry.right, options.dialect);
      differences = differences.map((d) => {
        if (d.class !== 'semantic') return d;
        const { resolved, rules } = resolve(hunkTokens(d), dry, stillAtL3, statementTokens(d));
        const l3 = rules.filter((r) => RULE_LEVEL.get(r) === 3);
        if (!resolved || l3.length === 0) return d;
        return {
          ...d,
          l3Hint: `May be structural under aggressive normalization (${l3.map((r) => RULE_TITLE.get(r)).join(', ')})`,
        };
      });
    }
  }

  differences = differences.map((d) => {
    const l = overlapping(statements.left, d.left);
    const r = overlapping(statements.right, d.right);
    const statementPair = l[0]?.index ?? r[0]?.index ?? 0;
    const unanalyzable = [...l, ...r].some((s) => UNANALYZABLE.has(s.status));
    return {
      ...d,
      statementPair,
      class: d.class === 'semantic' && unanalyzable ? 'unknown' : d.class,
    };
  });

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
    parser: parser?.name ?? null,
    views: {
      left: { original: left, normalized: snapshots.left.text },
      right: { original: right, normalized: snapshots.right.text },
    },
  };
}
