import { clauseEnd, isPunct, word } from '../structure.js';
import type { NormalizationRule, NormToken } from '../types.js';
import { sortLists } from './sortList.js';
import { diffResult } from './util.js';

const JOINISH = new Set(['JOIN', 'ON', 'USING', 'LATERAL', 'STRAIGHT_JOIN', 'NATURAL', 'CROSS']);
const JOIN_START = new Set([
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'CROSS',
  'NATURAL',
  'STRAIGHT_JOIN',
]);

/**
 * The SELECT list feeding FROM at `from` (same depth). Null when there isn't one.
 * `SELECT *` / `t.*` output columns follow FROM order, so those lists can't be sorted.
 */
function selectListHasStar(tokens: NormToken[], from: number, parens: Map<number, number>) {
  for (let j = from - 1; j >= 0; j--) {
    if (isPunct(tokens[j], ')')) {
      j = parens.get(j) ?? j;
      continue;
    }
    if (isPunct(tokens[j], '(')) return null;
    if (word(tokens[j]) === 'SELECT') {
      return tokens.slice(j + 1, from).some((t, k, list) => {
        if (!(t.type === 'operator' && t.text === '*')) return false;
        const prev = k === 0 ? tokens[j] : list[k - 1];
        return (
          word(prev) === 'SELECT' ||
          word(prev) === 'DISTINCT' ||
          isPunct(prev, ',') ||
          isPunct(prev, '.')
        );
      });
    }
  }
  return null;
}

export const sortFromList: NormalizationRule = {
  id: 'sort-from-list',
  level: 3,
  title: 'Sort comma-joined tables',
  description:
    'In `FROM a, b` (a cross join filtered by WHERE) the table order does not matter. Only when the FROM clause has no JOIN or LATERAL at all, and the query does not SELECT *, whose column order would change.',
  example: ['SELECT o.id FROM users u, orders o', 'SELECT o.id FROM orders o, users u'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: { commutative: true },
  apply(tokens) {
    const after = sortLists(tokens, (toks, parens) =>
      toks.flatMap((t, i) => {
        if (word(t) !== 'FROM' || word(toks[i - 1]) === 'DISTINCT') return [];
        if (selectListHasStar(toks, i, parens) !== false) return [];
        const range = { start: i + 1, end: clauseEnd(toks, i + 1, parens) };
        const items = toks.slice(range.start, range.end);
        if (items.some((x) => JOINISH.has(word(x)) || isPunct(x, '('))) return [];
        // `FROM a, b JOIN c` joins only b: moving b would change what is joined.
        if (JOIN_START.has(word(toks[range.end]))) return [];
        return [range];
      }),
    );
    return diffResult(tokens, after);
  },
};
