import { isPunct, matchParens, splitTopLevel, word } from '../structure.js';
import type { NormalizationRule, NormToken } from '../types.js';
import { diffResult } from './util.js';

const LITERAL = new Set(['number', 'string']);

export const sortInList: NormalizationRule = {
  id: 'sort-in-list',
  level: 3,
  title: 'Sort IN (…) lists',
  description: 'Set membership ignores order: a list of literals after IN is sorted.',
  example: ["status IN ('b', 'a')", "status IN ('a', 'b')"],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: { commutative: true },
  apply(tokens) {
    const parens = matchParens(tokens);
    if (!parens) return null;
    let after: NormToken[] = tokens;
    // Back to front, so earlier indices stay valid.
    for (let i = tokens.length - 1; i > 0; i--) {
      if (!isPunct(tokens[i], '(') || word(tokens[i - 1]) !== 'IN') continue;
      const close = parens.get(i)!;
      const items = splitTopLevel(tokens, { start: i + 1, end: close }, ',', parens);
      if (
        items.length < 2 ||
        !items.every((r) => r.end - r.start === 1 && LITERAL.has(tokens[r.start]!.type))
      ) {
        continue;
      }
      const values = items.map((r) => tokens[r.start]!);
      const sorted = [...values].sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
      const commas = items.slice(0, -1).map((r) => tokens[r.end]!);
      const rebuilt = sorted.flatMap((v, k) => (k < commas.length ? [v, commas[k]!] : [v]));
      after = [...after.slice(0, i + 1), ...rebuilt, ...after.slice(close)];
    }
    return diffResult(tokens, after);
  },
};
