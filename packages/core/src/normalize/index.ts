import { caseInsensitiveWords } from '../keywords.js';
import type { CanonicalMode, ParserAdapter } from '../parse.js';
import type { Statement } from '../split.js';
import { isTrivia, tokenize } from '../tokenize.js';
import type {
  Dialect,
  NormalizationIssue,
  NormalizationLevel,
  StatementStatus,
  Transformation,
} from '../types.js';
import { RULES } from './rules/index.js';
import type { NormalizationRule, NormToken, RuleContext, RuleResult } from './types.js';

export { RULES } from './rules/index.js';
export type { NormalizationRule, NormToken } from './types.js';

/**
 * Normalization pipeline (PLAN §5.4).
 *
 * L1 works on the token stream and is always safe. L2 and L3 rules rewrite a
 * statement's tokens too, but every rewrite is re-parsed with the dialect
 * parser and kept only if the new AST equals the original AST modulo what the
 * rule is meant to change. A group of rules is verified together; if that
 * fails, rules are retried one by one and only the failing ones are rolled
 * back (and reported) for that statement. Statements that can't be parsed get
 * L1 only.
 */

export interface NormalizeOptions {
  dialect: Dialect;
  level: NormalizationLevel;
  disabledRules: ReadonlySet<string>;
  caseInsensitiveTables: boolean;
}

/** A statement as analyzed by compare(): its parse status and AST. */
export interface AnalyzedStatement {
  statement: Statement;
  status: StatementStatus;
  ast?: unknown;
}

/** One side normalized up to some level. */
export interface SideSnapshot {
  /** Normalized significant tokens of the whole input, in output order. */
  tokens: NormToken[];
  /** Rule ids that rewrote, moved or dropped each source token (by source start). */
  touched: Map<number, Set<string>>;
  transformations: Transformation[];
  issues: NormalizationIssue[];
  /** Normalized SQL: one statement per line. */
  text: string;
  /**
   * Source start of each significant token of `text`, in order (null for the
   * `;` added after each statement), so positions map between the views.
   */
  sources: Array<number | null>;
}

export function rulesFor(dialect: Dialect, level: number, disabled: ReadonlySet<string>) {
  return RULES.filter(
    (r) =>
      r.level === level && r.dialects.includes(dialect) && !(r.toggleable && disabled.has(r.id)),
  );
}

const NO_SPACE_BEFORE = new Set([')', ',', ';', '.']);
const NO_SPACE_AFTER = new Set(['(', '.']);

/**
 * Statement SQL from tokens. Tokens that touched in the source stay touching
 * (`count(*)`, `a.b`, `x::int`); otherwise conventional spacing applies.
 */
export function printTokens(tokens: NormToken[]): string {
  return tokens
    .map((t, i) => {
      const prev = tokens[i - 1];
      if (!prev) return t.text;
      const tight =
        prev.end === t.start ||
        (t.type === 'punctuation' && NO_SPACE_BEFORE.has(t.text)) ||
        (prev.type === 'punctuation' && NO_SPACE_AFTER.has(prev.text));
      return (tight ? '' : ' ') + t.text;
    })
    .join('');
}

const MAX_SNIPPET = 80;
const MAX_EXAMPLE_TOKENS = 6;
const clip = (s: string) => (s.length > MAX_SNIPPET ? `${s.slice(0, MAX_SNIPPET - 1)}…` : s);

/** The changed part of a rewrite (with a token of context), for the "Transformations applied" panel. */
function changedRegion(before: NormToken[], after: NormToken[]) {
  const same = (a: NormToken | undefined, b: NormToken | undefined) =>
    a !== undefined && b !== undefined && a.start === b.start && a.text === b.text;
  let head = 0;
  while (same(before[head], after[head])) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    same(before[before.length - 1 - tail], after[after.length - 1 - tail])
  ) {
    tail++;
  }
  // One unchanged token of context on each side reads better: `a != 1` → `a <> 1`.
  // Scattered edits (keyword case everywhere) are cut to the first few tokens.
  head = Math.max(0, head - 1);
  tail = Math.max(0, tail - 1);
  const excerpt = (tokens: NormToken[]) => {
    const region = tokens.slice(head, tokens.length - tail);
    return region.length > MAX_EXAMPLE_TOKENS
      ? `${printTokens(region.slice(0, MAX_EXAMPLE_TOKENS))} …`
      : clip(printTokens(region));
  };
  return { before: excerpt(before), after: excerpt(after) };
}

const NO_MODE: CanonicalMode = {
  commutative: false,
  caseInsensitiveColumns: false,
  caseInsensitiveTables: false,
};

interface StatementState {
  analyzed: AnalyzedStatement;
  tokens: NormToken[];
  /** Canonical flags accumulated from rules applied so far. */
  mode: CanonicalMode;
}

/**
 * Normalizes one side lazily: `snapshot(2)` gives L1+L2, `snapshot(3)` adds L3
 * on top (used for aggressive mode, and as a dry run for L3 hints).
 */
export function createNormalizer(
  side: 'left' | 'right',
  text: string,
  statements: AnalyzedStatement[],
  options: NormalizeOptions,
  parser: ParserAdapter | null,
) {
  const ctx: RuleContext = {
    dialect: options.dialect,
    keywords: caseInsensitiveWords(options.dialect),
    caseInsensitiveTables: options.caseInsensitiveTables,
  };
  const raw = tokenize(text, options.dialect);
  const significant = raw.filter((t) => !isTrivia(t));
  const asNorm = (t: (typeof raw)[number]): NormToken => ({
    type: t.type,
    text: t.text,
    start: t.start,
    end: t.end,
  });

  const touched = new Map<number, Set<string>>();
  const transformations: Transformation[] = [];
  const issues: NormalizationIssue[] = [];
  const touch = (start: number, rule: string) => {
    let set = touched.get(start);
    if (!set) touched.set(start, (set = new Set()));
    set.add(rule);
  };

  // --- L1 -------------------------------------------------------------------
  const l1 = new Set(rulesFor(options.dialect, 1, options.disabledRules).map((r) => r.id));
  const active = options.level >= 1;
  const terminatorStarts = new Set<number>();
  for (const { statement: s } of statements) {
    if (!s.terminator) continue;
    const at = text.indexOf(s.terminator, s.end);
    if (at === -1) continue;
    for (const t of significant) {
      if (t.start >= at && t.start < at + s.terminator.length) terminatorStarts.add(t.start);
    }
  }
  const outside: NormToken[] = [];
  for (const t of significant) {
    const inStatement = statements.some(({ statement: s }) => t.start >= s.start && t.end <= s.end);
    if (inStatement) continue;
    if (active && l1.has('terminators') && terminatorStarts.has(t.start))
      touch(t.start, 'terminators');
    else outside.push(asNorm(t));
  }

  const states: StatementState[] = statements.map((analyzed) => {
    const { start, end, index } = analyzed.statement;
    const inside = raw.filter((t) => t.start >= start && t.end <= end);
    if (active) {
      const spaces = inside.filter((t) => t.type === 'whitespace' && t.text !== ' ');
      if (spaces.length > 0 && l1.has('whitespace')) {
        transformations.push({
          rule: 'whitespace',
          side,
          statementIndex: index,
          count: spaces.length,
          before: JSON.stringify(spaces[0]!.text),
          after: '" "',
        });
      }
      const notes = inside.filter((t) => t.type === 'line-comment' || t.type === 'block-comment');
      if (notes.length > 0 && l1.has('comments')) {
        transformations.push({
          rule: 'comments',
          side,
          statementIndex: index,
          count: notes.length,
          before: clip(notes[0]!.text.trim()),
          after: '',
        });
      }
    }
    return {
      analyzed,
      tokens: inside.filter((t) => !isTrivia(t)).map(asNorm),
      mode: { ...NO_MODE },
    };
  });
  if (active && l1.has('terminators') && terminatorStarts.size > 0) {
    transformations.push({
      rule: 'terminators',
      side,
      statementIndex: -1,
      count: terminatorStarts.size,
      before: ';',
      after: '',
    });
  }

  // --- L2 / L3 (verified) ---------------------------------------------------
  const canonicalCache = new Map<string, string>();
  const originalCanonical = (state: StatementState, mode: CanonicalMode) => {
    const key = `${state.analyzed.statement.index}:${JSON.stringify(mode)}`;
    let value = canonicalCache.get(key);
    if (value === undefined) {
      value = parser!.canonical(state.analyzed.ast, mode);
      canonicalCache.set(key, value);
    }
    return value;
  };

  const verify = (state: StatementState, tokens: NormToken[], mode: CanonicalMode) => {
    const reparsed = parser!.parse({
      ...state.analyzed.statement,
      text: printTokens(tokens),
      opaque: null,
    });
    return (
      reparsed.status === 'parsed' &&
      parser!.canonical(reparsed.ast, mode) === originalCanonical(state, mode)
    );
  };

  const merge = (mode: CanonicalMode, rule: NormalizationRule): CanonicalMode => ({
    commutative: mode.commutative || rule.canonical.commutative === true,
    caseInsensitiveColumns:
      mode.caseInsensitiveColumns || rule.canonical.caseInsensitiveColumns === true,
    caseInsensitiveTables:
      mode.caseInsensitiveTables ||
      (rule.canonical.caseInsensitiveColumns === true && ctx.caseInsensitiveTables),
  });

  const accept = (
    state: StatementState,
    rule: NormalizationRule,
    before: NormToken[],
    result: RuleResult,
  ) => {
    for (const start of result.touched) touch(start, rule.id);
    transformations.push({
      rule: rule.id,
      side,
      statementIndex: state.analyzed.statement.index,
      count: result.edits,
      ...changedRegion(before, result.tokens),
    });
    state.tokens = result.tokens;
    state.mode = merge(state.mode, rule);
  };

  const applyLevel = (level: 2 | 3) => {
    const rules = rulesFor(options.dialect, level, options.disabledRules);
    if (!parser || rules.length === 0) return;
    for (const state of states) {
      if (state.analyzed.status !== 'parsed') continue;
      // Try the whole group with a single re-parse.
      const steps: Array<{ rule: NormalizationRule; before: NormToken[]; result: RuleResult }> = [];
      let tokens = state.tokens;
      let mode = state.mode;
      for (const rule of rules) {
        const result = rule.apply(tokens, ctx);
        if (!result) continue;
        steps.push({ rule, before: tokens, result });
        tokens = result.tokens;
        mode = merge(mode, rule);
      }
      if (steps.length === 0) continue;
      if (verify(state, tokens, mode)) {
        for (const step of steps) accept(state, step.rule, step.before, step.result);
        continue;
      }
      // Something in the group changed the meaning (or the parse): find it.
      for (const rule of rules) {
        const result = rule.apply(state.tokens, ctx);
        if (!result) continue;
        if (verify(state, result.tokens, merge(state.mode, rule))) {
          accept(state, rule, state.tokens, result);
        } else {
          issues.push({
            rule: rule.id,
            side,
            statementIndex: state.analyzed.statement.index,
            message: `${rule.title} was not applied to statement ${state.analyzed.statement.index + 1}: the result did not parse to an equivalent statement.`,
          });
        }
      }
    }
  };

  const terminate = (p: { statement: boolean }) => p.statement && l1.has('terminators');
  const snapshotNow = (): SideSnapshot => {
    const pieces: Array<{ at: number; tokens: NormToken[]; statement: boolean }> = [
      ...states.map((s) => ({ at: s.analyzed.statement.start, tokens: s.tokens, statement: true })),
      ...outside.map((t) => ({ at: t.start, tokens: [t], statement: false })),
    ].sort((a, b) => a.at - b.at);
    return {
      tokens: pieces.flatMap((p) => p.tokens),
      touched: new Map([...touched].map(([k, v]) => [k, new Set(v)])),
      transformations: [...transformations],
      issues: [...issues],
      text: pieces.map((p) => printTokens(p.tokens) + (terminate(p) ? ';' : '')).join('\n'),
      sources: pieces.flatMap((p) => [
        ...p.tokens.map((t) => t.start),
        ...(terminate(p) ? [null] : []),
      ]),
    };
  };

  const snapshots = new Map<number, SideSnapshot>();
  return {
    /** Normalized up to `level` (2 = default, 3 = aggressive). */
    snapshot(level: 2 | 3): SideSnapshot {
      // Below L2 (level 0/1) only L1 applies.
      const target = options.level < 2 ? 1 : level;
      if (target === 1 && !snapshots.has(1)) snapshots.set(1, snapshotNow());
      for (let l = 2; l <= target; l++) {
        if (snapshots.has(l)) continue;
        applyLevel(l as 2 | 3);
        snapshots.set(l, snapshotNow());
      }
      return snapshots.get(target)!;
    },
  };
}
