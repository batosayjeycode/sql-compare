/**
 * Core types shared between the comparison engine and the UI.
 * See PLAN.md §5.6. Refined milestone by milestone (M5 adds AST paths/severity).
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
  statementPair: number;
  path: string[];
  kind: DiffKind;
  class: DiffClass;
  severity: Severity;
  description: string;
  /** Normalization rule id that resolved this diff (structural diffs). */
  resolvedBy?: string;
  /** Set on semantic diffs that L3 would resolve when aggressive mode is off. */
  l3Hint?: string;
  left?: SourceRange;
  right?: SourceRange;
}

export interface Transformation {
  rule: string;
  statementIndex: number;
  before: string;
  after: string;
  location?: SourceRange;
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

export interface SideViews {
  original: string;
  formatted?: string;
  normalized?: string;
}

export interface CompareOptions {
  dialect: Dialect;
  level: NormalizationLevel;
}

export interface ComparisonResult {
  verdict: Verdict;
  stats: Record<DiffClass, number>;
  differences: Difference[];
  transformations: Transformation[];
  errors: ParseIssue[];
  statements: { left: StatementInfo[]; right: StatementInfo[] };
  /** Parser used for structural analysis, or null (Generic mode / parser unavailable). */
  parser: string | null;
  views: { left: SideViews; right: SideViews };
}
