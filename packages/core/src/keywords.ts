import { mysql, postgresql, sql, type DialectOptions } from 'sql-formatter';
import type { Token } from './tokenize.js';
import type { Dialect } from './types.js';

export const FORMATTER_DIALECTS: Record<Dialect, DialectOptions> = {
  postgresql,
  mysql,
  generic: sql,
};

const cache = new Map<Dialect, ReadonlySet<string>>();

/**
 * Words whose case never matters: reserved keywords, data types and built-in
 * function names, taken from the formatter's own dialect definition so the
 * token check and the formatter agree on what a "keyword" is.
 */
export function caseInsensitiveWords(dialect: Dialect): ReadonlySet<string> {
  let words = cache.get(dialect);
  if (!words) {
    const o = FORMATTER_DIALECTS[dialect].tokenizerOptions;
    const lists = [
      o.reservedSelect,
      o.reservedClauses,
      o.reservedSetOperations,
      o.reservedJoins,
      o.reservedKeywordPhrases ?? [],
      o.reservedDataTypePhrases ?? [],
      o.reservedFunctionNames,
      o.reservedDataTypes,
      o.reservedKeywords,
    ];
    // Words the formatter's tokenizer recognizes regardless of dialect lists.
    const set = new Set<string>(['CASE', 'END', 'BETWEEN', 'WHEN', 'ELSE', 'THEN', 'AND', 'OR']);
    if (o.supportsXor) set.add('XOR');
    // Phrase entries look like "LEFT [OUTER] JOIN" or "{ROWS | RANGE} BETWEEN".
    for (const list of lists) {
      for (const entry of list) {
        for (const word of entry.toUpperCase().match(/[A-Z_][A-Z0-9_$]*/g) ?? []) set.add(word);
      }
    }
    words = set;
    cache.set(dialect, words);
  }
  return words;
}

/**
 * Comparison key for a token: equal keys mean the tokens differ at most in
 * keyword case.
 */
export function tokenKey(token: Token, keywords: ReadonlySet<string>): string {
  if (token.type === 'word') {
    const upper = token.text.toUpperCase();
    return keywords.has(upper) ? `k:${upper}` : `w:${token.text}`;
  }
  if (token.type === 'line-comment' || token.type === 'block-comment') {
    // Re-indenting a multi-line comment only changes whitespace.
    return `c:${token.text.trim().replace(/\s+/g, ' ')}`;
  }
  return `${token.type}:${token.text}`;
}
