// Kept apart from format.ts so importing the options doesn't load the formatter.

export type KeywordCase = 'preserve' | 'upper' | 'lower';

/** User-facing formatter options (FR-2). Keyword case also applies to data types and built-in functions. */
export interface FormatOptions {
  keywordCase: KeywordCase;
  indentWidth: number;
  useTabs: boolean;
  /** Max characters for a parenthesized expression to stay on one line. */
  lineWidth: number;
  logicalOperatorNewline: 'before' | 'after';
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  keywordCase: 'upper',
  indentWidth: 2,
  useTabs: false,
  lineWidth: 50,
  logicalOperatorNewline: 'before',
};
