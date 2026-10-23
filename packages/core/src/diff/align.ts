import { symmetricDiff } from './token.js';

/**
 * Statement alignment (PLAN §5.5 step 2).
 *
 * 1. Statements are aligned by similarity (same kind; same target object, or
 *    token-bigram Jaccard) with an order-preserving weighted LCS. Large inputs
 *    first anchor statements identical after normalization (LCS over their
 *    keys) and run the similarity alignment between anchors only.
 * 2. Leftovers identical or similar to a leftover on the other side are paired
 *    as moved.
 */

export interface StatementSignature {
  /** "SELECT", "CREATE TABLE", … */
  kind: string;
  /** Target object (table, view, index), if any. */
  target: string;
  /** Normalized token keys. */
  keys: string[];
}

export interface Alignment {
  /** Pairs in display order (a moved statement appears once, at its new position). */
  pairs: Array<{ left: number | null; right: number | null; moved: boolean }>;
  /**
   * The same statements as an order-preserving sequence on both sides: a moved
   * statement appears twice, as removed at its old and added at its new position.
   */
  steps: Array<{ left: number | null; right: number | null }>;
}

/** Below this similarity, two statements are not considered the same statement. */
const MIN_SIMILARITY = 0.3;
/** Statements this similar in different places are one statement, moved and edited. */
const MIN_MOVED_SIMILARITY = 0.5;
/** Larger gaps fall back to pairing by kind and target only. */
const MAX_DP_CELLS = 40_000;

function bigrams(keys: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < keys.length; i++) out.add(`${keys[i]}\u0000${keys[i + 1]}`);
  if (keys.length === 1) out.add(keys[0]!);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return common / (a.size + b.size - common);
}

export function similarity(
  a: StatementSignature,
  b: StatementSignature,
  grams: { a: Set<string>; b: Set<string> },
): number {
  if (a.kind !== b.kind) return 0;
  const shared = jaccard(grams.a, grams.b);
  // Same statement on the same object (ALTER TABLE users …) is a strong hint.
  return a.target !== '' && a.target === b.target ? Math.max(shared, 0.6) : shared;
}

type Step = { left: number | null; right: number | null };

/** Order-preserving alignment of one gap, maximizing total similarity. */
function alignGap(
  left: StatementSignature[],
  right: StatementSignature[],
  l0: number,
  r0: number,
): Step[] {
  const n = left.length;
  const m = right.length;
  if (n === 0 || m === 0) {
    return [
      ...left.map((_, i) => ({ left: l0 + i, right: null })),
      ...right.map((_, j) => ({ left: null, right: r0 + j })),
    ];
  }
  // A single statement replaced by a single statement: compare them directly.
  if (n === 1 && m === 1) return [{ left: l0, right: r0 }];

  if (n * m > MAX_DP_CELLS) {
    // Too big for similarity scoring: pair statements with the same kind and target, in order.
    const steps: Step[] = [];
    let a = 0;
    let b = 0;
    const id = (s: StatementSignature) => `${s.kind}\u0000${s.target}`;
    for (const c of symmetricDiff(left.map(id), right.map(id))) {
      for (let k = 0; k < c.count; k++) {
        if (c.removed) steps.push({ left: l0 + a++, right: null });
        else if (c.added) steps.push({ left: null, right: r0 + b++ });
        else steps.push({ left: l0 + a++, right: r0 + b++ });
      }
    }
    return steps;
  }

  const lg = left.map((s) => bigrams(s.keys));
  const rg = right.map((s) => bigrams(s.keys));
  const score: number[][] = left.map((a, i) =>
    right.map((b, j) => {
      const s = similarity(a, b, { a: lg[i]!, b: rg[j]! });
      return s >= MIN_SIMILARITY ? s : -1;
    }),
  );
  // dp[i][j]: best total for left[i..] and right[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = score[i]![j]!;
      dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!, s >= 0 ? s + dp[i + 1]![j + 1]! : -1);
    }
  }
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = score[i]![j]!;
    if (s >= 0 && dp[i]![j] === s + dp[i + 1]![j + 1]!) {
      steps.push({ left: l0 + i++, right: r0 + j++ });
    } else if (dp[i]![j] === dp[i + 1]![j]) {
      steps.push({ left: l0 + i++, right: null });
    } else {
      steps.push({ left: null, right: r0 + j++ });
    }
  }
  while (i < n) steps.push({ left: l0 + i++, right: null });
  while (j < m) steps.push({ left: null, right: r0 + j++ });

  return pairInPlace(steps, left, right, l0, r0);
}

/**
 * Between two aligned statements (or the ends), unmatched statements with as
 * many on each side and the same kinds in the same order were most likely
 * edited in place (`SELECT 2` → `SELECT 20`): pair them.
 */
function pairInPlace(
  steps: Step[],
  left: StatementSignature[],
  right: StatementSignature[],
  l0: number,
  r0: number,
): Step[] {
  const out: Step[] = [];
  let run: Step[] = [];
  const flush = () => {
    const ls = run.flatMap((s) => (s.left !== null ? [s.left] : []));
    const rs = run.flatMap((s) => (s.right !== null ? [s.right] : []));
    const sameShape =
      ls.length === rs.length &&
      ls.every((l, k) => left[l - l0]!.kind === right[rs[k]! - r0]!.kind);
    if (ls.length > 0 && sameShape) {
      out.push(...ls.map((l, k) => ({ left: l, right: rs[k]! })));
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (const step of steps) {
    if (step.left !== null && step.right !== null) {
      flush();
      out.push(step);
    } else {
      run.push(step);
    }
  }
  flush();
  return out;
}

export function alignStatements(
  left: StatementSignature[],
  right: StatementSignature[],
): Alignment {
  const key = (s: StatementSignature) => s.keys.join('\u0001');
  const steps: Step[] = [];
  // Small inputs: one similarity alignment over everything, so edited
  // statements can anchor too ([a, b, c] → [c, a', b] keeps a and b in place).
  if (left.length * right.length <= MAX_DP_CELLS) {
    steps.push(...alignGap(left, right, 0, 0));
    return withMoves(steps, left, right, key);
  }
  let a = 0;
  let b = 0;
  let gap = { l0: 0, r0: 0, l1: 0, r1: 0 };
  const flushGap = () => {
    steps.push(
      ...alignGap(left.slice(gap.l0, gap.l1), right.slice(gap.r0, gap.r1), gap.l0, gap.r0),
    );
  };
  for (const c of symmetricDiff(left.map(key), right.map(key))) {
    if (c.removed) {
      a += c.count;
      gap.l1 = a;
    } else if (c.added) {
      b += c.count;
      gap.r1 = b;
    } else {
      flushGap();
      for (let k = 0; k < c.count; k++) steps.push({ left: a++, right: b++ });
      gap = { l0: a, r0: b, l1: a, r1: b };
    }
  }
  flushGap();
  return withMoves(steps, left, right, key);
}

/** Pair leftovers that are the same statement at another position. */
function withMoves(
  steps: Step[],
  left: StatementSignature[],
  right: StatementSignature[],
  key: (s: StatementSignature) => string,
): Alignment {
  // Moved statements: leftovers identical to a leftover on the other side.
  const removed = new Map<string, number[]>();
  for (const s of steps) {
    if (s.left !== null && s.right === null) {
      const k = key(left[s.left]!);
      removed.set(k, [...(removed.get(k) ?? []), s.left]);
    }
  }
  const movedTo = new Map<number, number>();
  for (const s of steps) {
    if (s.right === null || s.left !== null) continue;
    const from = removed.get(key(right[s.right]!))?.shift();
    if (from !== undefined) movedTo.set(from, s.right);
  }
  // Leftovers similar to a leftover elsewhere: moved and edited.
  const leftovers = {
    left: steps.flatMap((s) =>
      s.left !== null && s.right === null && !movedTo.has(s.left) ? [s.left] : [],
    ),
    right: steps.flatMap((s) =>
      s.right !== null && s.left === null && ![...movedTo.values()].includes(s.right)
        ? [s.right]
        : [],
    ),
  };
  if (leftovers.left.length * leftovers.right.length <= MAX_DP_CELLS) {
    const candidates: Array<{ l: number; r: number; score: number }> = [];
    for (const l of leftovers.left) {
      for (const r of leftovers.right) {
        const a = left[l]!;
        const b = right[r]!;
        const score = similarity(a, b, { a: bigrams(a.keys), b: bigrams(b.keys) });
        if (score >= MIN_MOVED_SIMILARITY) candidates.push({ l, r, score });
      }
    }
    candidates.sort((x, y) => y.score - x.score || x.l - y.l || x.r - y.r);
    const usedRight = new Set<number>();
    for (const c of candidates) {
      if (movedTo.has(c.l) || usedRight.has(c.r)) continue;
      movedTo.set(c.l, c.r);
      usedRight.add(c.r);
    }
  }
  const movedFrom = new Map([...movedTo].map(([l, r]) => [r, l]));

  const pairs: Alignment['pairs'] = [];
  for (const s of steps) {
    if (s.left !== null && s.right === null && movedTo.has(s.left)) continue;
    if (s.right !== null && s.left === null && movedFrom.has(s.right)) {
      pairs.push({ left: movedFrom.get(s.right)!, right: s.right, moved: true });
      continue;
    }
    pairs.push({ ...s, moved: false });
  }
  return { pairs, steps };
}
