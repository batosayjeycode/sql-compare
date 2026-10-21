import { formatDialect } from 'sql-formatter';
import { caseInsensitiveWords, FORMATTER_DIALECTS, tokenKey } from './keywords.js';
import { tokenize } from './tokenize.js';
import type { Dialect } from './types.js';

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

export type FormatResult =
  { ok: true; text: string } | { ok: false; reason: 'error' | 'tokens-changed'; message: string };

/**
 * Non-whitespace token keys, i.e. everything that must survive formatting.
 * Comments are kept (moving them is fine; changing them is not).
 */
export function significantKeys(sql: string, dialect: Dialect): string[] {
  const keywords = caseInsensitiveWords(dialect);
  return tokenize(sql, dialect)
    .filter((t) => t.type !== 'whitespace')
    .map((t) => tokenKey(t, keywords));
}

/** Index of the first differing key, or -1 if the sequences are equal. */
function firstMismatch(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/**
 * Pretty-print SQL. The output is verified to contain exactly the input's
 * tokens (modulo whitespace and keyword case, FR-2.1); otherwise it is
 * discarded and an error is returned instead.
 */
export function formatSql(
  sql: string,
  dialect: Dialect,
  options: FormatOptions = DEFAULT_FORMAT_OPTIONS,
): FormatResult {
  if (sql.trim() === '') return { ok: true, text: sql };

  let text: string;
  try {
    text = formatDialect(sql, {
      dialect: FORMATTER_DIALECTS[dialect],
      keywordCase: options.keywordCase,
      dataTypeCase: options.keywordCase,
      functionCase: options.keywordCase,
      identifierCase: 'preserve',
      tabWidth: options.indentWidth,
      useTabs: options.useTabs,
      expressionWidth: options.lineWidth,
      logicalOperatorNewline: options.logicalOperatorNewline,
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? (err.message.split('\n')[0] ?? err.message) : String(err),
    };
  }

  const before = significantKeys(sql, dialect);
  const after = significantKeys(text, dialect);
  const mismatch = firstMismatch(before, after);
  if (mismatch !== -1) {
    return {
      ok: false,
      reason: 'tokens-changed',
      message: `The formatter changed the query's tokens (near token ${mismatch + 1}), so its output was discarded.`,
    };
  }
  // Keep the input's trailing newline convention.
  if (sql.endsWith('\n') && !text.endsWith('\n')) text += '\n';
  return { ok: true, text };
}
