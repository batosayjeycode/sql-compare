import type { NormalizationRule } from '../types.js';
import { diffResult } from './util.js';

const PG_PLAIN = /^"([a-z_][a-z0-9_$]*)"$/;
const MYSQL_PLAIN = /^`([A-Za-z_][A-Za-z0-9_$]*)`$/;

export const redundantQuotes: NormalizationRule = {
  id: 'redundant-quotes',
  level: 2,
  title: 'Remove redundant identifier quotes',
  description:
    'Quotes are removed when the identifier is not a keyword and quoting changes nothing: lower case in PostgreSQL ("users" → users, but "Users" stays), any case for MySQL backticks.',
  example: ['SELECT "id" FROM `orders`', 'SELECT id FROM orders'],
  safety: 'dialect-dependent',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: {},
  apply(tokens, ctx) {
    const pattern = ctx.dialect === 'mysql' ? MYSQL_PLAIN : PG_PLAIN;
    const after = tokens.map((t) => {
      if (t.type !== 'quoted-identifier') return t;
      const name = pattern.exec(t.text)?.[1];
      if (!name || name.length > 63 || ctx.keywords.has(name.toUpperCase())) return t;
      return { ...t, type: 'word' as const, text: name };
    });
    return diffResult(tokens, after);
  },
};
