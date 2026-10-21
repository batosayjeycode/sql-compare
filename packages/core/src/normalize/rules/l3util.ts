import { conditionRanges, isPure, matchParens, rangeKey, splice } from '../structure.js';
import { rewriteCondition, type ConditionVisitor } from '../condition.js';
import type { NormToken } from '../types.js';

/** Apply a condition visitor to every WHERE / HAVING / ON condition (innermost first). */
export function rewriteConditions(tokens: NormToken[], visitor: ConditionVisitor): NormToken[] {
  const parens = matchParens(tokens);
  if (!parens) return tokens;
  // Back to front, so a condition nested in a subquery is rewritten before the
  // outer condition containing it (the outer pass leaves subqueries alone).
  // Rewrites can change length (parentheses removed): shift later ends.
  const done: Array<{ start: number; delta: number }> = [];
  let out = tokens;
  for (const range of conditionRanges(tokens, parens).sort((a, b) => b.start - a.start)) {
    const shift = done
      .filter((d) => d.start >= range.start && d.start < range.end)
      .reduce((sum, d) => sum + d.delta, 0);
    const end = range.end + shift;
    const rewritten = rewriteCondition(out.slice(range.start, end), visitor);
    out = splice(out, { start: range.start, end }, rewritten);
    done.push({ start: range.start, delta: rewritten.length - (end - range.start) });
  }
  return out;
}

/** Sort token groups by canonical text when every group is pure. */
export function sortIfPure(groups: NormToken[][]): NormToken[][] {
  const all = { start: 0, end: 0 };
  if (!groups.every((g) => isPure(g, { ...all, end: g.length }))) return groups;
  return [...groups].sort((a, b) => {
    const ka = rangeKey(a, { start: 0, end: a.length });
    const kb = rangeKey(b, { start: 0, end: b.length });
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** Rebuild a list from items and their (unchanged) separators. */
export function joinWith(items: NormToken[][], separators: NormToken[]): NormToken[] {
  return items.flatMap((item, i) => (i < separators.length ? [...item, separators[i]!] : item));
}
