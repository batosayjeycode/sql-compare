import { isTrivia, tokenize, type Token } from './tokenize.js';
import type { Dialect } from './types.js';

/**
 * Maps positions between a side's original SQL (where every result range
 * points) and the text shown for it: the formatted view (same significant
 * tokens, in the same order) or the normalized view (tokens with known source
 * positions, possibly reordered). Lets highlights and navigation work in all
 * three views (PLAN §5.5 step 3.5).
 */
export interface ViewMapper {
  /** Display range for a source range (an empty range maps to an insertion point). */
  toDisplay(range: { start: number; end: number }): { from: number; to: number };
  /** Source offset of the token at a display position, or null between tokens. */
  toSource(pos: number): number | null;
}

export type ViewSource =
  | { kind: 'original' }
  | { kind: 'formatted' }
  /** Source start of each significant display token (null for synthetic tokens). */
  | { kind: 'normalized'; sources: ReadonlyArray<number | null> };

const significant = (text: string, dialect: Dialect) =>
  tokenize(text, dialect).filter((t) => !isTrivia(t));

/**
 * Create a mapper, or null when the display text doesn't line up with the
 * source (e.g. a stale view); callers then skip highlights in that view.
 */
export function createViewMapper(
  original: string,
  display: string,
  dialect: Dialect,
  source: ViewSource,
): ViewMapper | null {
  if (source.kind === 'original') {
    if (display !== original) return null;
    return {
      toDisplay: (r) => ({ from: r.start, to: r.end }),
      toSource: (pos) => pos,
    };
  }
  const src = significant(original, dialect);
  const shown = significant(display, dialect);
  let starts: Array<number | null>;
  if (source.kind === 'formatted') {
    if (src.length !== shown.length) return null;
    starts = src.map((t) => t.start);
  } else {
    if (source.sources.length !== shown.length) return null;
    starts = [...source.sources];
  }
  return mapperFor(src, shown, starts);
}

function mapperFor(src: Token[], shown: Token[], starts: Array<number | null>): ViewMapper {
  /** Display token index by source start. */
  const byStart = new Map<number, number>();
  starts.forEach((s, i) => {
    if (s !== null && !byStart.has(s)) byStart.set(s, i);
  });
  const end = shown.length > 0 ? shown[shown.length - 1]!.end : 0;

  return {
    toDisplay({ start, end: stop }) {
      let from = Infinity;
      let to = -Infinity;
      if (stop > start) {
        for (const t of src) {
          if (t.start < start || t.start >= stop) continue;
          const i = byStart.get(t.start);
          if (i === undefined) continue;
          from = Math.min(from, shown[i]!.start);
          to = Math.max(to, shown[i]!.end);
        }
      }
      if (from <= to) return { from, to };
      // Insertion point (or only dropped tokens): right after the token that
      // ends before it when that one is shown, else before the next shown token.
      let previous: Token | undefined;
      for (const t of src) {
        if (t.end > start) break;
        previous = t;
      }
      const p = previous && byStart.get(previous.start);
      if (p !== undefined) return { from: shown[p]!.end, to: shown[p]!.end };
      for (const t of src) {
        if (t.start < start) continue;
        const i = byStart.get(t.start);
        if (i !== undefined) return { from: shown[i]!.start, to: shown[i]!.start };
      }
      return { from: end, to: end };
    },
    toSource(pos) {
      // Binary search for the display token containing pos.
      let lo = 0;
      let hi = shown.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = shown[mid]!;
        if (pos < t.start) hi = mid - 1;
        else if (pos >= t.end) lo = mid + 1;
        else return starts[mid] ?? null;
      }
      return null;
    },
  };
}
