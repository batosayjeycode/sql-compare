import { CLAUSE_END, isPunct, matchParens, word } from '../structure.js';
import type { NormalizationRule, NormToken } from '../types.js';
import { diffResult, isIdentifierWord } from './util.js';

const CAST_FUNCTIONS = new Set(['CAST', 'CONVERT', 'TRY_CAST']);

/** Is token `i` inside CAST( … ) / CONVERT( … ), where AS introduces a type? */
function insideCast(tokens: NormToken[], i: number, parens: Map<number, number>): boolean {
  for (let j = i - 1; j >= 0; j--) {
    if (isPunct(tokens[j], ')')) {
      j = parens.get(j) ?? j;
      continue;
    }
    if (isPunct(tokens[j], '(')) return CAST_FUNCTIONS.has(word(tokens[j - 1]));
  }
  return false;
}

export const aliasAs: NormalizationRule = {
  id: 'alias-as',
  level: 2,
  title: 'Optional AS before aliases',
  description: '`expr AS alias` and `expr alias` are the same; the optional AS is dropped.',
  example: ['SELECT a AS total FROM t AS x', 'SELECT a total FROM t x'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: {},
  apply(tokens, ctx) {
    const parens = matchParens(tokens);
    if (!parens) return null;
    const after = tokens.filter((t, i) => {
      if (word(t) !== 'AS' || i === 0) return true;
      const alias = tokens[i + 1];
      const isAlias = isIdentifierWord(alias, ctx.keywords) || alias?.type === 'quoted-identifier';
      if (!isAlias) return true;
      const next = tokens[i + 2];
      const endsAlias =
        next === undefined ||
        isPunct(next, ',') ||
        isPunct(next, ')') ||
        isPunct(next, '(') ||
        CLAUSE_END.has(word(next));
      return !(endsAlias && !insideCast(tokens, i, parens));
    });
    return diffResult(tokens, after);
  },
};
