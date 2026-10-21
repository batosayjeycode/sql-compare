import type { NormalizationRule } from '../types.js';
import { rewriteConditions, sortIfPure } from './l3util.js';
import { diffResult } from './util.js';

export const sortBoolean: NormalizationRule = {
  id: 'sort-boolean',
  level: 3,
  title: 'Sort AND / OR operands',
  description:
    'Operands of an AND or OR chain are put in a canonical order. Only when every operand is pure: chains with function calls or subqueries are left alone, since reordering can change which errors or side effects happen (short-circuit evaluation).',
  example: ['WHERE y = 2 AND x = 1', 'WHERE x = 1 AND y = 2'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: { commutative: true },
  apply(tokens) {
    const after = rewriteConditions(tokens, { chain: (operands) => sortIfPure(operands) });
    return diffResult(tokens, after);
  },
};
