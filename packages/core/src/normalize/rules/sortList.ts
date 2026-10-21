import { matchParens, splitTopLevel, type Range } from '../structure.js';
import type { NormToken } from '../types.js';
import { joinWith, sortIfPure } from './l3util.js';

/**
 * Sort the comma-separated list in each range returned by `find` (pure items
 * only). Sorting permutes tokens without changing length, so ranges found up
 * front stay valid; back to front, an inner list is sorted before an outer one.
 */
export function sortLists(
  tokens: NormToken[],
  find: (tokens: NormToken[], parens: Map<number, number>) => Range[],
): NormToken[] {
  const parens = matchParens(tokens);
  if (!parens) return tokens;
  let out = tokens;
  for (const range of find(tokens, parens).sort((a, b) => b.start - a.start)) {
    const current = matchParens(out);
    if (!current) return tokens;
    const items = splitTopLevel(out, range, ',', current);
    if (items.length < 2 || items.some((r) => r.end <= r.start)) continue;
    const groups = items.map((r) => out.slice(r.start, r.end));
    const commas = items.slice(0, -1).map((r) => out[r.end]!);
    out = [
      ...out.slice(0, range.start),
      ...joinWith(sortIfPure(groups), commas),
      ...out.slice(range.end),
    ];
  }
  return out;
}
