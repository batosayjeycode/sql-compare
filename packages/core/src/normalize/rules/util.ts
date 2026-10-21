import type { NormToken, RuleResult } from '../types.js';

/** Indices (into `seq`) of one longest strictly increasing subsequence. */
function longestIncreasing(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  seq.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails[tails.length - 1] ?? -1; i !== -1; i = prev[i]!) keep.add(i);
  return keep;
}

/**
 * Build a rule result from before/after token arrays (null when unchanged).
 * Touched = dropped, rewritten, or moved relative to the other tokens (a drop
 * shifts later tokens but doesn't move them).
 */
export function diffResult(
  before: NormToken[],
  after: NormToken[],
  edits?: number,
): RuleResult | null {
  const touched = new Set<number>();
  const order = new Map(before.map((t, i) => [t.start, { t, i }]));
  const afterStarts = new Set(after.map((t) => t.start));
  for (const t of before) if (!afterStarts.has(t.start)) touched.add(t.start);
  const kept = longestIncreasing(after.map((t) => order.get(t.start)?.i ?? -1));
  after.forEach((t, i) => {
    const old = order.get(t.start);
    if (!old || old.t.text !== t.text || !kept.has(i)) touched.add(t.start);
  });
  if (touched.size === 0) return null;
  return { tokens: after, edits: edits ?? touched.size, touched: [...touched] };
}

export const isIdentifierWord = (t: NormToken | undefined, keywords: ReadonlySet<string>) =>
  t !== undefined && t.type === 'word' && !keywords.has(t.text.toUpperCase());
