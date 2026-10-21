/**
 * Core types shared between the comparison engine and the UI.
 * See PLAN.md §5.6. These are a sketch and will be refined in M2–M5.
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
  line: number;
  column: number;
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
  views: { left: SideViews; right: SideViews };
}
