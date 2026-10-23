import type { NormToken } from './types.js';

const NO_SPACE_BEFORE = new Set([')', ',', ';', '.']);
const NO_SPACE_AFTER = new Set(['(', '.']);

/**
 * Statement SQL from tokens. Tokens that touched in the source stay touching
 * (`count(*)`, `a.b`, `x::int`); otherwise conventional spacing applies.
 */
export function printTokens(tokens: NormToken[]): string {
  return tokens
    .map((t, i) => {
      const prev = tokens[i - 1];
      if (!prev) return t.text;
      const tight =
        prev.end === t.start ||
        (t.type === 'punctuation' && NO_SPACE_BEFORE.has(t.text)) ||
        (prev.type === 'punctuation' && NO_SPACE_AFTER.has(prev.text));
      return (tight ? '' : ' ') + t.text;
    })
    .join('');
}
