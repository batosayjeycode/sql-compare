import { clauseEnd, isPunct, word } from '../structure.js';
import type { NormalizationRule, NormToken } from '../types.js';
import { sortLists } from './sortList.js';
import { diffResult } from './util.js';

const FRAME = new Set(['ROWS', 'RANGE', 'GROUPS']);

/** Is the PARTITION BY at `i` inside a window definition: OVER ( … ) or WINDOW w AS ( … )? */
function inWindow(tokens: NormToken[], i: number, parens: Map<number, number>): boolean {
  for (let j = i - 1; j >= 0; j--) {
    if (isPunct(tokens[j], ')')) {
      j = parens.get(j) ?? j;
      continue;
    }
    if (isPunct(tokens[j], '(')) {
      const before = word(tokens[j - 1]);
      return before === 'OVER' || before === 'AS';
    }
  }
  return false;
}

export const sortPartitionBy: NormalizationRule = {
  id: 'sort-partition-by',
  level: 3,
  title: 'Sort window PARTITION BY items',
  description:
    'A window partition ignores the order of its keys. The window ORDER BY is never reordered.',
  example: ['OVER (PARTITION BY b, a ORDER BY ts)', 'OVER (PARTITION BY a, b ORDER BY ts)'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: { commutative: true },
  apply(tokens) {
    const after = sortLists(tokens, (toks, parens) =>
      toks.flatMap((t, i) => {
        if (word(t) !== 'PARTITION' || word(toks[i + 1]) !== 'BY' || !inWindow(toks, i, parens))
          return [];
        return [{ start: i + 2, end: clauseEnd(toks, i + 2, parens, FRAME) }];
      }),
    );
    return diffResult(tokens, after);
  },
};
