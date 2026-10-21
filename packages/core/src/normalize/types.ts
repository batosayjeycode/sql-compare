import type { Dialect } from '../types.js';
import type { CanonicalMode } from '../parse.js';
import type { TokenType } from '../tokenize.js';

export type { CanonicalMode };

/**
 * A token in a normalized statement. Normalization rewrites, drops and
 * reorders tokens but never merges or splits them, so every normalized token
 * maps back to exactly one source token (`start`/`end`).
 */
export interface NormToken {
  type: TokenType;
  /** Normalized text (may differ from the source, e.g. case or quotes). */
  text: string;
  /** Source range in the side's full input. */
  start: number;
  end: number;
}

export type RuleLevel = 1 | 2 | 3;

export interface RuleContext {
  dialect: Dialect;
  /** Upper-cased keywords, data types and built-in function names. */
  keywords: ReadonlySet<string>;
  /** MySQL: treat table names as case-insensitive (lower_case_table_names). */
  caseInsensitiveTables: boolean;
}

export interface RuleResult {
  tokens: NormToken[];
  /** Number of individual edits made. */
  edits: number;
  /** Source starts of every token the rule changed, moved or dropped. */
  touched: number[];
}

export interface NormalizationRule {
  id: string;
  level: RuleLevel;
  title: string;
  description: string;
  /** Before → after, shown in the UI. */
  example: [string, string];
  /** `dialect-dependent` rules run only for the dialects listed. */
  safety: 'safe' | 'dialect-dependent';
  dialects: readonly Dialect[];
  /** L1 whitespace/comments define "formatting" and can't be turned off. */
  toggleable: boolean;
  /** What the AST comparison must ignore when verifying this rule. */
  canonical: Partial<CanonicalMode>;
  /** Rewrite one statement's significant tokens. Returns null when nothing changes. */
  apply(tokens: NormToken[], ctx: RuleContext): RuleResult | null;
}
