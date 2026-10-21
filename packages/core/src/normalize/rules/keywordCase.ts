import type { NormalizationRule } from '../types.js';
import { diffResult } from './util.js';

export const keywordCase: NormalizationRule = {
  id: 'keyword-case',
  level: 2,
  title: 'Uppercase keywords',
  description: 'Keywords, data types and built-in function names are upper-cased.',
  example: ['select count(*) from t', 'SELECT COUNT(*) FROM t'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  // Some keywords are also column names (`status`, `name`); MySQL column names
  // are case-insensitive. Table names are not, so uppercasing one is rejected.
  canonical: { caseInsensitiveColumns: true },
  apply(tokens, ctx) {
    const after = tokens.map((t) => {
      if (t.type !== 'word') return t;
      const upper = t.text.toUpperCase();
      return ctx.keywords.has(upper) && upper !== t.text ? { ...t, text: upper } : t;
    });
    return diffResult(tokens, after);
  },
};
