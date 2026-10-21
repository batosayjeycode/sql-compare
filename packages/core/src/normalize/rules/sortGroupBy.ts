import { clauseEnd, word } from '../structure.js';
import type { NormalizationRule } from '../types.js';
import { sortLists } from './sortList.js';
import { diffResult } from './util.js';

const NOT_SORTABLE = new Set([
  'ROLLUP',
  'CUBE',
  'GROUPING',
  'SETS',
  'WITH',
  'ASC',
  'DESC',
  'ALL',
  'DISTINCT',
]);

export const sortGroupBy: NormalizationRule = {
  id: 'sort-group-by',
  level: 3,
  title: 'Sort GROUP BY items',
  description:
    'Grouping ignores the order of the keys. ROLLUP, CUBE, GROUPING SETS and WITH ROLLUP are never reordered.',
  example: ['GROUP BY b, a', 'GROUP BY a, b'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: { commutative: true },
  apply(tokens) {
    const after = sortLists(tokens, (toks, parens) =>
      toks.flatMap((t, i) => {
        if (word(t) !== 'GROUP' || word(toks[i + 1]) !== 'BY') return [];
        const range = { start: i + 2, end: clauseEnd(toks, i + 2, parens) };
        const items = toks.slice(range.start, range.end);
        return items.some((x) => NOT_SORTABLE.has(word(x))) ? [] : [range];
      }),
    );
    return diffResult(tokens, after);
  },
};
