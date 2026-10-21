import { isPunct } from '../structure.js';
import type { NormalizationRule, NormToken } from '../types.js';
import { rewriteConditions } from './l3util.js';
import { diffResult } from './util.js';

/** A column reference (`a`, `t.a`, `"t"."a"`), literal or bind parameter. */
function isSimple(tokens: NormToken[]): boolean {
  if (tokens.length === 1) {
    const t = tokens[0]!;
    return ['word', 'quoted-identifier', 'number', 'string', 'variable'].includes(t.type);
  }
  return tokens.every((t, i) =>
    i % 2 === 1 ? isPunct(t, '.') : t.type === 'word' || t.type === 'quoted-identifier',
  );
}

/** Column references sort before literals, so `x = 1` stays as written. */
const key = (tokens: NormToken[]) =>
  (tokens.length === 1 && tokens[0]!.type !== 'word' && tokens[0]!.type !== 'quoted-identifier'
    ? '1'
    : '0') + tokens.map((t) => t.text).join('');

export const sortEquality: NormalizationRule = {
  id: 'sort-equality',
  level: 3,
  title: 'Sort = operands',
  description:
    '`a = b` and `b = a` are the same comparison; simple operands are put in a canonical order.',
  example: ['ON u.id = o.user_id', 'ON o.user_id = u.id'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: { commutative: true },
  apply(tokens) {
    const after = rewriteConditions(tokens, {
      atom(atom) {
        const eq = atom.findIndex((t) => t.type === 'operator' && t.text === '=');
        if (eq <= 0) return atom;
        const left = atom.slice(0, eq);
        const right = atom.slice(eq + 1);
        if (!isSimple(left) || !isSimple(right) || key(right) >= key(left)) return atom;
        return [...right, atom[eq]!, ...left];
      },
    });
    return diffResult(tokens, after);
  },
};
