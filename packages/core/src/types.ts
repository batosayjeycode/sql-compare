/**
 * Core types shared between the comparison engine and the UI.
 * See PLAN.md §5.6.
 */

export type Dialect = 'postgresql' | 'mysql' | 'generic';

/** Normalization level. L2 is the default; L3 is the opt-in "aggressive" level. */
export type NormalizationLevel = 0 | 1 | 2 | 3;

export type DiffKind = 'added' | 'removed' | 'changed' | 'moved';

/**
 * Every difference gets exactly one class:
 * - formatting: whitespace / comments / keyword case
 * - structural: different arrangement, proven equivalent by active normalization rules
 * - semantic:   potential change in meaning
 * - unknown:    could not parse; treated as potentially semantic
 */
export type DiffClass = 'formatting' | 'structural' | 'semantic' | 'unknown';

export type Severity = 'info' | 'minor' | 'major';

export type Verdict =
  'identical' | 'formatting-only' | 'structural-only' | 'potentially-semantic' | 'unknown';

export interface SourceRange {
  side: 'left' | 'right';
  start: number;
  end: number;
}

export interface Difference {
  id: string;
  /** Index into `ComparisonResult.pairs`. */
  statementPair: number;
  /** Where the difference is, e.g. ['SELECT', 'FROM', 'orders', 'join type']. */
  path: string[];
  kind: DiffKind;
  class: DiffClass;
  severity: Severity;
  description: string;
  /** Ids of the normalization rules that resolved this diff (comma-separated). */
  resolvedBy?: string;
  /** Set on semantic diffs that L3 would resolve when aggressive mode is off. */
  l3Hint?: string;
  left?: SourceRange;
  right?: SourceRange;
}

/** One normalization rule applied to one statement (PLAN §5.4 guardrail 3). */
export interface Transformation {
  rule: string;
  side: 'left' | 'right';
  /** Statement index, or -1 for input-wide rules (terminators). */
  statementIndex: number;
  /** Number of individual edits. */
  count: number;
  /** The changed part, before and after. */
  before: string;
  after: string;
}

/** A rule that was rolled back because re-parsing didn't confirm equivalence. */
export interface NormalizationIssue {
  rule: string;
  side: 'left' | 'right';
  statementIndex: number;
  message: string;
}

export interface ParseIssue {
  side: 'left' | 'right';
  statementIndex: number;
  message: string;
  /** 1-based line and column of the error in the side's full input. */
  line: number;
  column: number;
  /** Character offset of the error in the side's full input. */
  offset: number;
}

/**
 * How far a statement could be analyzed:
 * - parsed:      the dialect parser accepted it
 * - error:       the parser rejected it (see `message` / ParseIssue)
 * - unsupported: syntax the parser doesn't handle (procedural blocks, client
 *                commands, vendor extensions); compared as text only
 * - skipped:     no parser for this dialect (Generic mode)
 */
export type StatementStatus = 'parsed' | 'error' | 'unsupported' | 'skipped';

export interface StatementInfo {
  index: number;
  /** Character range of the statement, excluding its terminator. */
  start: number;
  end: number;
  /** Leading keyword(s), e.g. "SELECT" or "CREATE TABLE". */
  kind: string;
  status: StatementStatus;
  /** Parser error message, or why the statement is unsupported. */
  message?: string;
}

/**
 * Statements aligned across the two inputs (PLAN §5.5 step 2):
 * - unchanged: identical text
 * - changed:   aligned, with differences of any class
 * - added / removed: no counterpart on the other side
 * - moved:     identical after normalization, at a different position
 */
export type PairStatus = 'unchanged' | 'changed' | 'added' | 'removed' | 'moved';

export interface StatementPair {
  index: number;
  /** Statement indices (into `statements.left/right`), null when missing on that side. */
  left: number | null;
  right: number | null;
  status: PairStatus;
  /** Statement kind ("SELECT", "CREATE TABLE", …). */
  kind: string;
}

export interface SideViews {
  original: string;
  formatted?: string;
  normalized?: string;
}

export interface CompareOptions {
  dialect: Dialect;
  /** 2 = default; 3 = aggressive (L3 rules on). */
  level: NormalizationLevel;
  /** Ids of rules the user turned off. */
  disabledRules?: readonly string[];
  /** MySQL: table names are case-insensitive (server runs with lower_case_table_names). */
  caseInsensitiveTables?: boolean;
}

export interface ComparisonResult {
  verdict: Verdict;
  stats: Record<DiffClass, number>;
  differences: Difference[];
  transformations: Transformation[];
  /** Rules rolled back for a statement because verification failed. */
  normalizationIssues: NormalizationIssue[];
  errors: ParseIssue[];
  statements: { left: StatementInfo[]; right: StatementInfo[] };
  /** Aligned statement pairs, in display order. */
  pairs: StatementPair[];
  /** Parser used for structural analysis, or null (Generic mode / parser unavailable). */
  parser: string | null;
  views: { left: SideViews; right: SideViews };
}
