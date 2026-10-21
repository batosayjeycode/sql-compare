import { isPunct, word } from '../structure.js';
import type { NormalizationRule, NormToken } from '../types.js';
import { diffResult, isIdentifierWord } from './util.js';

/** Words that start a list of table names (MySQL table names are case-sensitive). */
const TABLE_START = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO', 'TABLE', 'STRAIGHT_JOIN']);
const TABLE_END = new Set([
  'ON',
  'USING',
  'WHERE',
  'SET',
  'GROUP',
  'ORDER',
  'LIMIT',
  'HAVING',
  'WINDOW',
  'UNION',
  'SELECT',
  'VALUES',
  'PARTITION',
]);

/** Source starts of MySQL words that name (or alias) tables, which must keep their case. */
function mysqlTableWords(tokens: NormToken[]): Set<number> {
  const keep = new Set<number>();
  let inTables = false;
  tokens.forEach((t, i) => {
    const w = word(t);
    if (TABLE_START.has(w)) inTables = true;
    else if (TABLE_END.has(w) || isPunct(t, '(') || isPunct(t, ')') || isPunct(t, ';'))
      inTables = false;
    else if (inTables && t.type === 'word') keep.add(t.start);
    // Qualifiers (`alias.column`, `db.table`) may be table names or aliases.
    if (isPunct(tokens[i + 1], '.')) keep.add(t.start);
  });
  return keep;
}

/** Lowercase ASCII letters only, as PostgreSQL does when folding identifiers. */
const foldAscii = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

export const identifierCase: NormalizationRule = {
  id: 'identifier-case',
  level: 2,
  title: 'Lowercase unquoted identifiers',
  description:
    'PostgreSQL folds unquoted identifiers to lower case. MySQL: column names, aliases and functions only; table names keep their case unless "Table names are case-insensitive" is on.',
  example: ['SELECT UserId FROM Orders', 'SELECT userid FROM orders'],
  safety: 'dialect-dependent',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: { caseInsensitiveColumns: true },
  apply(tokens, ctx) {
    const keep =
      ctx.dialect === 'mysql' && !ctx.caseInsensitiveTables
        ? mysqlTableWords(tokens)
        : new Set<number>();
    const after = tokens.map((t) => {
      if (!isIdentifierWord(t, ctx.keywords) || keep.has(t.start)) return t;
      const lower = foldAscii(t.text);
      return lower === t.text ? t : { ...t, text: lower };
    });
    return diffResult(tokens, after);
  },
};
