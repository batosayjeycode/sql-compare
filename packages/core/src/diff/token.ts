import { diffArrays } from 'diff';
import { caseInsensitiveWords, tokenKey } from '../keywords.js';
import { isTrivia, tokenize, type Token } from '../tokenize.js';
import type { Dialect, Difference, SourceRange } from '../types.js';

/**
 * Token-level comparison (PLAN §5.5 steps 3.1–3.2).
 *
 * Significant tokens (everything except whitespace and comments) are diffed
 * with keyword-case-insensitive keys. Runs of changed tokens become potential
 * `semantic` differences. Between matched tokens, any change to the
 * surrounding whitespace/comments or to keyword case is a `formatting`
 * difference. Nearby formatting changes are merged into one entry.
 */

type FormattingReason = 'whitespace' | 'comments' | 'keyword case';

interface FormattingEvent {
  /** Position in the matched sequence: gap before pair m = 2m, token m = 2m+1. */
  order: number;
  reason: FormattingReason;
  left: [number, number];
  right: [number, number];
}

interface Hunk {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

const MAX_SNIPPET = 48;

function snippet(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > MAX_SNIPPET ? `${s.slice(0, MAX_SNIPPET - 1)}…` : s;
}

function range(side: SourceRange['side'], start: number, end: number): SourceRange {
  return { side, start, end };
}

function commentKeys(tokens: Token[], from: number, to: number, keywords: ReadonlySet<string>) {
  return tokens
    .filter((t) => t.start >= from && t.end <= to && t.type !== 'whitespace')
    .map((t) => tokenKey(t, keywords))
    .join('\n');
}

/**
 * Myers diff breaks ties by direction, so diff(a, b) and diff(b, a) can align
 * differently. Always diff in a canonical order and flip the result, so
 * comparing B with A mirrors comparing A with B exactly.
 */
export function symmetricDiff(a: string[], b: string[]) {
  const swap = a.length !== b.length ? a.length > b.length : a.join('\u0000') > b.join('\u0000');
  if (!swap) return diffArrays(a, b);
  return diffArrays(b, a).map((c) => ({ ...c, added: c.removed, removed: c.added }));
}

function countNewlines(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

function joinReasons(reasons: FormattingReason[]): string {
  const [first, ...rest] = reasons;
  if (!first) return '';
  const head = first.charAt(0).toUpperCase() + first.slice(1);
  if (rest.length === 0) return head;
  return `${[head, ...rest.slice(0, -1)].join(', ')} and ${rest[rest.length - 1]}`;
}

export function tokenDiff(left: string, right: string, dialect: Dialect): Difference[] {
  const keywords = caseInsensitiveWords(dialect);
  const lt = tokenize(left, dialect);
  const rt = tokenize(right, dialect);
  const ls = lt.filter((t) => !isTrivia(t));
  const rs = rt.filter((t) => !isTrivia(t));
  const lk = ls.map((t) => tokenKey(t, keywords));
  const rk = rs.map((t) => tokenKey(t, keywords));

  // 1. Align significant tokens.
  const pairs: Array<[number, number]> = [];
  const hunks: Hunk[] = [];
  let a = 0;
  let b = 0;
  let open: Hunk | null = null;
  for (const change of symmetricDiff(lk, rk)) {
    if (!change.added && !change.removed) {
      if (open) hunks.push(open);
      open = null;
      for (let k = 0; k < change.count; k++) pairs.push([a + k, b + k]);
      a += change.count;
      b += change.count;
      continue;
    }
    open ??= { a0: a, a1: a, b0: b, b1: b };
    if (change.removed) a = open.a1 += change.count;
    else b = open.b1 += change.count;
  }
  if (open) hunks.push(open);

  const differences: Difference[] = [];
  let nextId = 0;
  const id = () => `d${++nextId}`;

  // 2. Changed token runs → potential semantic differences.
  for (const h of hunks) {
    const leftStart = h.a1 > h.a0 ? ls[h.a0]!.start : h.a0 > 0 ? ls[h.a0 - 1]!.end : 0;
    const leftEnd = h.a1 > h.a0 ? ls[h.a1 - 1]!.end : leftStart;
    const rightStart = h.b1 > h.b0 ? rs[h.b0]!.start : h.b0 > 0 ? rs[h.b0 - 1]!.end : 0;
    const rightEnd = h.b1 > h.b0 ? rs[h.b1 - 1]!.end : rightStart;
    const before = snippet(left.slice(leftStart, leftEnd));
    const after = snippet(right.slice(rightStart, rightEnd));
    const kind = h.a1 === h.a0 ? 'added' : h.b1 === h.b0 ? 'removed' : 'changed';
    differences.push({
      id: id(),
      statementPair: 0,
      path: [],
      kind,
      class: 'semantic',
      severity: 'major',
      description:
        kind === 'added'
          ? `Added \`${after}\``
          : kind === 'removed'
            ? `Removed \`${before}\``
            : `Changed \`${before}\` → \`${after}\``,
      left: range('left', leftStart, leftEnd),
      right: range('right', rightStart, rightEnd),
    });
  }

  // 3. Formatting changes around and within matched tokens.
  const events: FormattingEvent[] = [];
  const gapEvent = (order: number, l0: number, l1: number, r0: number, r1: number) => {
    if (left.slice(l0, l1) === right.slice(r0, r1)) return;
    const commentsChanged = commentKeys(lt, l0, l1, keywords) !== commentKeys(rt, r0, r1, keywords);
    events.push({
      order,
      reason: commentsChanged ? 'comments' : 'whitespace',
      left: [l0, l1],
      right: [r0, r1],
    });
  };

  if (ls.length === 0 && rs.length === 0) {
    gapEvent(0, 0, left.length, 0, right.length);
  }
  // adjacent[m]: no semantic hunk between matched pair m-1 (or the input start) and m.
  const adjacent = pairs.map(([i, j], m) => {
    const prev = pairs[m - 1];
    return prev ? prev[0] === i - 1 && prev[1] === j - 1 : i === 0 && j === 0;
  });
  pairs.forEach(([i, j], m) => {
    const lTok = ls[i]!;
    const rTok = rs[j]!;
    const prev = pairs[m - 1];
    if (adjacent[m]) {
      const l0 = prev ? ls[prev[0]]!.end : 0;
      const r0 = prev ? rs[prev[1]]!.end : 0;
      gapEvent(2 * m, l0, lTok.start, r0, rTok.start);
    }
    if (lTok.text !== rTok.text) {
      events.push({
        order: 2 * m + 1,
        reason: 'keyword case',
        left: [lTok.start, lTok.end],
        right: [rTok.start, rTok.end],
      });
    }
  });
  const last = pairs[pairs.length - 1];
  if (last && last[0] === ls.length - 1 && last[1] === rs.length - 1) {
    gapEvent(2 * pairs.length, ls[last[0]]!.end, left.length, rs[last[1]]!.end, right.length);
  }

  let group: FormattingEvent[] = [];
  const flush = () => {
    const first = group[0];
    const lastEvent = group[group.length - 1];
    if (!first || !lastEvent) return;
    const reasons = (['whitespace', 'comments', 'keyword case'] as const).filter((r) =>
      group.some((e) => e.reason === r),
    );
    differences.push({
      id: id(),
      statementPair: 0,
      path: [],
      kind: 'changed',
      class: 'formatting',
      severity: 'info',
      description:
        reasons.length === 1 && reasons[0] === 'keyword case' && group.length === 1
          ? `Keyword case \`${left.slice(...first.left)}\` → \`${right.slice(...first.right)}\``
          : `${joinReasons(reasons)} changed`,
      left: range('left', first.left[0], lastEvent.left[1]),
      right: range('right', first.right[0], lastEvent.right[1]),
    });
    group = [];
  };
  // Number of semantic hunks before matched pair m (m === pairs.length: end of input).
  const hunksBefore: number[] = [];
  adjacent.forEach((adj, m) => hunksBefore.push((hunksBefore[m - 1] ?? 0) + (adj ? 0 : 1)));
  hunksBefore.push(hunksBefore[pairs.length - 1] ?? 0);
  const hunkIndex = (e: FormattingEvent) => hunksBefore[Math.floor(e.order / 2)];

  // Events on the same or the next line, with no semantic change in between,
  // read as one formatting change (e.g. a whole statement re-indented).
  for (const e of events) {
    const prev = group[group.length - 1];
    if (
      prev &&
      (hunkIndex(prev) !== hunkIndex(e) ||
        countNewlines(left, prev.left[1], e.left[0]) > 1 ||
        countNewlines(right, prev.right[1], e.right[0]) > 1)
    ) {
      flush();
    }
    group.push(e);
  }
  flush();

  return differences.sort(
    (x, y) =>
      (x.left?.start ?? 0) - (y.left?.start ?? 0) || (x.right?.start ?? 0) - (y.right?.start ?? 0),
  );
}
