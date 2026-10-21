import { matchParens, splitTopLevel } from '../structure.js';
import type { NormalizationRule } from '../types.js';
import { rewriteConditions } from './l3util.js';
import { diffResult } from './util.js';

export const stripParens: NormalizationRule = {
  id: 'strip-parens',
  level: 3,
  title: 'Remove redundant parentheses',
  description:
    'Parentheses that cannot change precedence are removed: around a whole condition, around an AND operand without a top-level OR, around any OR operand, and doubled parentheses. Verified against the parse tree.',
  example: ['WHERE ((a = 1) AND (b = 2 AND c = 3))', 'WHERE a = 1 AND b = 2 AND c = 3'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: {},
  apply(tokens) {
    const after = rewriteConditions(tokens, {
      wrapped(inner, context) {
        if (context !== 'AND') return 'unwrap';
        const parens = matchParens(inner);
        if (!parens) return 'keep';
        const hasOr =
          splitTopLevel(inner, { start: 0, end: inner.length }, 'OR', parens).length > 1;
        return hasOr ? 'keep' : 'unwrap';
      },
    });
    return diffResult(tokens, after);
  },
};
