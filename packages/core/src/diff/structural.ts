import { printTokens } from '../normalize/print.js';
import type { Range } from '../normalize/structure.js';
import type { NormToken } from '../normalize/types.js';
import type { DiffKind, Severity } from '../types.js';
import { keyOf, type Clause, type Item, type QueryModel } from './model.js';
import { severityOf, type Aspect } from './severity.js';
import { code } from './text.js';
import { symmetricDiff } from './token.js';

/**
 * Clause-aware differ (PLAN §5.5 step 3.4). Compares the clause models of two
 * aligned statements and describes each difference: select items match by
 * expression or alias, tables by name or alias, joins by target table,
 * predicates by canonical text, assignments and column definitions by column.
 *
 * It only describes; whether a difference is semantic at all is decided by
 * normalization (compare.ts keeps only changes that touch tokens still
 * different after normalizing).
 */

export interface Change {
  path: string[];
  kind: DiffKind;
  aspect: Aspect;
  severity: Severity;
  description: string;
  /** Token ranges in each statement's normalized tokens; null if the side has none. */
  left: Range | null;
  right: Range | null;
  /** Insertion point (token index) on a side with no range. */
  leftAt: number;
  rightAt: number;
  /** Whole items involved (`left`/`right` may be narrowed to the differing tokens). */
  scope: { left: Range | null; right: Range | null };
}

export interface DiffSide {
  tokens: NormToken[];
  /** The side's full input (tokens point into it). */
  source: string;
  /** Token indices that still differ after normalization (decides which items moved). */
  residual?: ReadonlySet<number>;
}

type Side = 'left' | 'right';

const MAX_SNIPPET = 60;
const OUTER_JOINS = new Set(['LEFT', 'RIGHT', 'FULL']);

interface Match {
  pairs: Array<[number, number]>;
  removed: number[];
  added: number[];
  /** Pairs of identical items (same key): the only ones that can be reported as moved. */
  identical: Array<[number, number]>;
}

/**
 * Match items in passes (each pass pairs still-unmatched items with equal
 * values, in order). With `pairLeftovers`, items left over on both sides are
 * then paired positionally when there are as many on each side.
 */
function match(
  left: Item[],
  right: Item[],
  passes: Array<(item: Item) => string | undefined>,
  pairLeftovers: boolean,
): Match {
  const l2r = new Map<number, number>();
  const r2l = new Map<number, number>();
  for (const value of passes) {
    const queue = new Map<string, number[]>();
    right.forEach((item, j) => {
      const v = value(item);
      if (r2l.has(j) || v === undefined) return;
      queue.set(v, [...(queue.get(v) ?? []), j]);
    });
    left.forEach((item, i) => {
      const v = value(item);
      if (l2r.has(i) || v === undefined) return;
      const j = queue.get(v)?.shift();
      if (j === undefined) return;
      l2r.set(i, j);
      r2l.set(j, i);
    });
  }
  const identical = [...l2r]
    .filter(([i, j]) => left[i]!.key === right[j]!.key)
    .sort((a, b) => a[0] - b[0]);
  let removed = left.map((_, i) => i).filter((i) => !l2r.has(i));
  let added = right.map((_, j) => j).filter((j) => !r2l.has(j));
  if (pairLeftovers && removed.length > 0 && removed.length === added.length) {
    removed.forEach((i, k) => {
      l2r.set(i, added[k]!);
      r2l.set(added[k]!, i);
    });
    removed = [];
    added = [];
  }
  return { pairs: [...l2r].sort((a, b) => a[0] - b[0]), removed, added, identical };
}

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

/** Pair items of two ordered sequences (VALUES rows, set operation branches). */
function sequencePairs(left: string[], right: string[]): Match {
  const pairs: Array<[number, number]> = [];
  const removed: number[] = [];
  const added: number[] = [];
  let a = 0;
  let b = 0;
  let pendingRemoved: number[] = [];
  let pendingAdded: number[] = [];
  const flush = () => {
    const n = Math.min(pendingRemoved.length, pendingAdded.length);
    for (let k = 0; k < n; k++) pairs.push([pendingRemoved[k]!, pendingAdded[k]!]);
    removed.push(...pendingRemoved.slice(n));
    added.push(...pendingAdded.slice(n));
    pendingRemoved = [];
    pendingAdded = [];
  };
  for (const change of symmetricDiff(left, right)) {
    if (change.removed) {
      for (let k = 0; k < change.count; k++) pendingRemoved.push(a++);
    } else if (change.added) {
      for (let k = 0; k < change.count; k++) pendingAdded.push(b++);
    } else {
      flush();
      for (let k = 0; k < change.count; k++) pairs.push([a++, b++]);
    }
  }
  flush();
  return { pairs, removed, added, identical: [] };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ordinal = (i: number) => `position ${i + 1}`;
const empty = (r: Range | undefined) => !r || r.end <= r.start;

export function diffStatements(
  left: QueryModel,
  right: QueryModel,
  sides: { left: DiffSide; right: DiffSide },
  keywords: ReadonlySet<string>,
): Change[] {
  const differ = new Differ(sides, keywords);
  differ.query(left, right, [left.kind || 'Statement']);
  return differ.changes;
}

class Differ {
  readonly changes: Change[] = [];

  constructor(
    private readonly sides: { left: DiffSide; right: DiffSide },
    private readonly keywords: ReadonlySet<string>,
  ) {}

  // --- helpers -------------------------------------------------------------

  key(side: Side, range: Range | undefined): string {
    return range ? keyOf(this.sides[side].tokens, range, this.keywords) : '';
  }

  /** Source text of a range (normalized token order, original spelling), clipped. */
  show(side: Side, range: Range | undefined): string {
    if (!range) return '';
    const { tokens, source } = this.sides[side];
    const text = printTokens(
      tokens
        .slice(range.start, range.end)
        .map((t) => ({ ...t, text: source.slice(t.start, t.end) })),
    );
    return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET - 1)}…` : text;
  }

  /** An item's name as written in the source (e.g. `status`, not the normalized `STATUS`). */
  display(side: Side, item: Item | undefined): string | undefined {
    if (!item) return undefined;
    return item.nameAt !== undefined
      ? this.show(side, { start: item.nameAt, end: item.nameAt + 1 })
      : item.name;
  }

  /** `code` span for descriptions. */
  q(side: Side, range: Range | undefined): string {
    return `${code(this.show(side, range))}`;
  }

  /** Trim the common leading/trailing tokens of two ranges (for precise highlights). */
  narrow(l: Range, r: Range): { left: Range; right: Range } {
    const lt = this.sides.left.tokens;
    const rt = this.sides.right.tokens;
    const same = (i: number, j: number) => lt[i]!.text === rt[j]!.text;
    let { start: ls, end: le } = l;
    let { start: rs, end: re } = r;
    while (ls < le && rs < re && same(ls, rs)) {
      ls++;
      rs++;
    }
    while (le > ls && re > rs && same(le - 1, re - 1)) {
      le--;
      re--;
    }
    if (ls === le && rs === re) return { left: l, right: r };
    return { left: { start: ls, end: le }, right: { start: rs, end: re } };
  }

  /** Literal-only change (and whether it only changes a number's spelling). */
  literalChange(l: Range, r: Range): 'numeric-form' | 'literal' | null {
    const lt = this.sides.left.tokens.slice(l.start, l.end);
    const rt = this.sides.right.tokens.slice(r.start, r.end);
    if (lt.length === 0 || rt.length === 0) return null;
    const literal = (t: NormToken) => t.type === 'number' || t.type === 'string';
    if (!lt.every(literal) || !rt.every(literal)) return null;
    const [a] = lt;
    const [b] = rt;
    if (lt.length === 1 && rt.length === 1 && a!.type === 'number' && b!.type === 'number') {
      if (Number(a!.text) === Number(b!.text)) return 'numeric-form';
    }
    return 'literal';
  }

  add(change: {
    path: string[];
    kind: DiffKind;
    aspect: Aspect;
    description: string;
    left?: Range | null;
    right?: Range | null;
    leftAt?: number;
    rightAt?: number;
    scope?: { left: Range | null; right: Range | null };
  }) {
    const left = change.left && !empty(change.left) ? change.left : null;
    const right = change.right && !empty(change.right) ? change.right : null;
    this.changes.push({
      scope: change.scope ?? { left, right },
      path: change.path,
      kind: change.kind,
      aspect: change.aspect,
      severity: severityOf(change.aspect),
      description: change.description,
      left,
      right,
      leftAt: left ? left.start : (change.leftAt ?? change.left?.start ?? 0),
      rightAt: right ? right.start : (change.rightAt ?? change.right?.start ?? 0),
    });
  }

  /** A changed pair of ranges, narrowed to the differing tokens. */
  changed(path: string[], aspect: Aspect, description: string, l: Range, r: Range) {
    const n = this.narrow(l, r);
    this.add({
      path,
      kind: 'changed',
      aspect,
      description,
      left: n.left,
      right: n.right,
      scope: { left: l, right: r },
    });
  }

  /**
   * Identical items whose order changed. Any item outside one longest common
   * order would do; prefer the ones whose tokens the normalized token diff
   * also marks as different, so A→B and B→A report the same items.
   */
  moved(m: Match, l: Item[], r: Item[]): Array<[number, number]> {
    const stable = longestIncreasing(m.identical.map(([, j]) => j));
    const outside = m.identical.filter((_, k) => !stable.has(k));
    if (outside.length === 0) return [];
    const differs = (side: Side, span: Range) => {
      const residual = this.sides[side].residual;
      if (!residual) return false;
      for (let i = span.start; i < span.end; i++) if (residual.has(i)) return true;
      return false;
    };
    const preferred = m.identical.filter(
      ([i, j]) => differs('left', l[i]!.span) || differs('right', r[j]!.span),
    );
    return preferred.length > 0 && preferred.length <= outside.length ? preferred : outside;
  }

  /** Insertion point in `items` for an item matched to nothing on the other side. */
  anchor(
    index: number,
    partners: Map<number, number>,
    others: Array<{ span: Range }>,
    fallback: number,
  ): number {
    for (let k = index - 1; k >= 0; k--) {
      const p = partners.get(k);
      if (p !== undefined) return others[p]!.span.end;
    }
    return fallback;
  }

  /**
   * Report added, removed and moved items of a matched list. `describe`
   * gives each description; pairs are handled by the caller.
   */
  items(
    m: Match,
    l: Item[],
    r: Item[],
    path: string[],
    fallback: { left: number; right: number },
    describe: {
      added: (item: Item) => string;
      removed: (item: Item) => string;
      moved: (item: Item, from: number, to: number) => string;
      aspect: Aspect | ((item: Item, kind: 'added' | 'removed') => Aspect);
      movedAspect: Aspect;
    },
  ) {
    const r2l = new Map(m.pairs.map(([i, j]) => [j, i]));
    const l2r = new Map(m.pairs);
    const aspect = (item: Item, kind: 'added' | 'removed') =>
      typeof describe.aspect === 'function' ? describe.aspect(item, kind) : describe.aspect;
    for (const i of m.removed) {
      this.add({
        path,
        kind: 'removed',
        aspect: aspect(l[i]!, 'removed'),
        description: describe.removed(l[i]!),
        left: l[i]!.span,
        rightAt: this.anchor(i, l2r, r, fallback.right),
      });
    }
    for (const j of m.added) {
      this.add({
        path,
        kind: 'added',
        aspect: aspect(r[j]!, 'added'),
        description: describe.added(r[j]!),
        right: r[j]!.span,
        leftAt: this.anchor(j, r2l, l, fallback.left),
      });
    }
    // A reorder shifts tokens all over the list: the move accounts for the whole list.
    const region = (items: Item[]): Range | null =>
      items.length === 0
        ? null
        : { start: items[0]!.span.start, end: items[items.length - 1]!.span.end };
    for (const [i, j] of this.moved(m, l, r)) {
      this.add({
        path,
        kind: 'moved',
        aspect: describe.movedAspect,
        description: describe.moved(l[i]!, i, j),
        left: l[i]!.span,
        right: r[j]!.span,
        scope: { left: region(l), right: region(r) },
      });
    }
  }

  // --- statements ----------------------------------------------------------

  query(l: QueryModel, r: QueryModel, path: string[]) {
    if (l.kind !== r.kind) {
      this.add({
        path,
        kind: 'changed',
        aspect: 'statement.kind',
        description: `Statement changed from ${l.kind || 'unknown'} to ${r.kind || 'unknown'}`,
        left: l.span,
        right: r.span,
      });
      return;
    }
    this.target(l, r, path);
    if (l.head && r.head && this.key('left', l.head) !== this.key('right', r.head)) {
      this.changed(
        path,
        'statement.modifier',
        `${this.q('left', l.head)} changed to ${this.q('right', r.head)}`,
        l.head,
        r.head,
      );
    }
    if (l.branches || r.branches) {
      this.branches(l, r, path);
      return;
    }
    this.clauses(l.clauses, r.clauses, path, l, r);
  }

  target(l: QueryModel, r: QueryModel, path: string[]) {
    const lt = l.target;
    const rt = r.target;
    if (!lt && !rt) return;
    const noun =
      l.kind === 'CREATE INDEX' ? 'Index name' : l.kind === 'CREATE VIEW' ? 'View name' : 'Table';
    if (!lt || !rt) {
      this.add({
        path: [...path, 'target'],
        kind: lt ? 'removed' : 'added',
        aspect: 'statement.target',
        description: lt
          ? `Removed ${noun.toLowerCase()} ${this.q('left', lt.span)}`
          : `Added ${noun.toLowerCase()} ${this.q('right', rt!.span)}`,
        left: lt?.span ?? null,
        right: rt?.span ?? null,
        leftAt: l.span.start,
        rightAt: r.span.start,
      });
      return;
    }
    const lTable = lt.parts.table ?? lt.span;
    const rTable = rt.parts.table ?? rt.span;
    if (this.key('left', lTable) !== this.key('right', rTable)) {
      this.changed(
        [...path, 'target'],
        'statement.target',
        `${noun} changed from ${this.q('left', lTable)} to ${this.q('right', rTable)}`,
        lTable,
        rTable,
      );
    }
    this.alias(lt, rt, [...path, 'target'], this.show('right', rTable), lTable, rTable);
  }

  /** Alias added, removed or renamed. */
  alias(
    li: Item,
    ri: Item,
    path: string[],
    label: string,
    lAt: Range,
    rAt: Range,
    aspect: Aspect = 'from.alias',
  ) {
    const la = li.parts.alias;
    const ra = ri.parts.alias;
    const lName = la ? this.key('left', la) : '';
    const rName = ra ? this.key('right', ra) : '';
    if (lName === rName) return;
    const description =
      la && ra
        ? `Alias of ${code(label)} changed from ${this.q('left', la)} to ${this.q('right', ra)}`
        : ra
          ? `Alias ${this.q('right', ra)} added to ${code(label)}`
          : `Alias ${this.q('left', la)} removed from ${code(label)}`;
    this.add({
      path,
      kind: la && ra ? 'changed' : ra ? 'added' : 'removed',
      aspect,
      description,
      left: la ?? null,
      right: ra ?? null,
      leftAt: lAt.end,
      rightAt: rAt.end,
    });
  }

  branches(l: QueryModel, r: QueryModel, path: string[]) {
    const lb = l.branches ?? [{ op: { start: l.span.start, end: l.span.start }, query: l }];
    const rb = r.branches ?? [{ op: { start: r.span.start, end: r.span.start }, query: r }];
    const m = sequencePairs(
      lb.map((b) => this.key('left', b.query.span)),
      rb.map((b) => this.key('right', b.query.span)),
    );
    for (const [i, j] of m.pairs) {
      const lop = lb[i]!.op;
      const rop = rb[j]!.op;
      const branchPath = [...path, `branch ${j + 1}`];
      if (i > 0 && j > 0 && this.key('left', lop) !== this.key('right', rop)) {
        this.changed(
          branchPath,
          'set.operator',
          `${this.q('left', lop)} changed to ${this.q('right', rop)}`,
          lop,
          rop,
        );
      }
      this.query(lb[i]!.query, rb[j]!.query, branchPath);
    }
    // The same branch removed in one place and added in another: moved.
    const added = new Map<string, number[]>();
    for (const j of m.added) {
      const key = this.key('right', rb[j]!.query.span);
      added.set(key, [...(added.get(key) ?? []), j]);
    }
    for (const i of [...m.removed]) {
      const j = added.get(this.key('left', lb[i]!.query.span))?.shift();
      if (j === undefined) continue;
      m.removed.splice(m.removed.indexOf(i), 1);
      m.added.splice(m.added.indexOf(j), 1);
      this.add({
        path,
        kind: 'moved',
        aspect: 'set.moved',
        description: `Branch ${this.q('left', lb[i]!.query.span)} moved from ${ordinal(i)} to ${j + 1}`,
        left: lb[i]!.query.span,
        right: rb[j]!.query.span,
      });
    }
    const op = (b: { op: Range }, side: Side) =>
      empty(b.op) ? 'set operation' : this.show(side, b.op);
    for (const i of m.removed) {
      this.add({
        path,
        kind: 'removed',
        aspect: 'set.branch',
        description: `Removed ${op(lb[i]!, 'left')} branch ${this.q('left', lb[i]!.query.span)}`,
        left: { start: lb[i]!.op.start, end: lb[i]!.query.span.end },
        rightAt: r.span.end,
      });
    }
    for (const j of m.added) {
      this.add({
        path,
        kind: 'added',
        aspect: 'set.branch',
        description: `Added ${op(rb[j]!, 'right')} branch ${this.q('right', rb[j]!.query.span)}`,
        right: { start: rb[j]!.op.start, end: rb[j]!.query.span.end },
        leftAt: l.span.end,
      });
    }
    // ORDER BY / LIMIT of the whole set operation.
    this.clauses(l.branches ? l.clauses : [], r.branches ? r.clauses : [], path, l, r);
  }

  // --- clauses -------------------------------------------------------------

  clauses(lc: Clause[], rc: Clause[], path: string[], l: QueryModel, r: QueryModel) {
    const used = new Set<number>();
    const pairs: Array<[number, number]> = [];
    lc.forEach((c, i) => {
      const j = rc.findIndex((d, k) => !used.has(k) && d.name === c.name);
      if (j === -1) return;
      used.add(j);
      pairs.push([i, j]);
    });
    const l2r = new Map(pairs);
    const r2l = new Map(pairs.map(([i, j]) => [j, i]));
    const limited = [...lc, ...rc].some((c) => ['LIMIT', 'OFFSET', 'FETCH'].includes(c.name));
    const label = (c: Clause, side: Side) =>
      empty(c.head)
        ? `${CLAUSE_LABELS[c.name] ?? c.name} ${this.q(side, c.span)}`
        : `clause ${this.q(side, c.span)}`;
    const aspectOf = (c: Clause): Aspect =>
      c.name === 'ORDER BY'
        ? limited
          ? 'order.limited'
          : 'order.item'
        : c.name === 'options'
          ? 'ddl.options'
          : c.name === 'RETURNING'
            ? 'returning'
            : c.name === 'WITH'
              ? 'cte.added'
              : 'clause.added';
    lc.forEach((c, i) => {
      if (l2r.has(i)) return;
      const aspect = aspectOf(c);
      this.add({
        path: [...path, c.name],
        kind: 'removed',
        aspect:
          aspect === 'clause.added'
            ? 'clause.removed'
            : aspect === 'cte.added'
              ? 'cte.removed'
              : aspect,
        description: `Removed ${label(c, 'left')}`,
        left: c.span,
        rightAt: this.anchor(i, l2r, rc, r.span.start),
      });
    });
    rc.forEach((c, j) => {
      if (r2l.has(j)) return;
      this.add({
        path: [...path, c.name],
        kind: 'added',
        aspect: aspectOf(c),
        description: `Added ${label(c, 'right')}`,
        right: c.span,
        leftAt: this.anchor(j, r2l, lc, l.span.start),
      });
    });
    for (const [i, j] of pairs) this.clause(lc[i]!, rc[j]!, [...path, lc[i]!.name], limited, l, r);
  }

  clause(lc: Clause, rc: Clause, path: string[], limited: boolean, l: QueryModel, r: QueryModel) {
    if (this.key('left', lc.head) !== this.key('right', rc.head)) {
      const n = this.narrow(lc.head, rc.head);
      const hints = [
        ...this.sides.left.tokens.slice(n.left.start, n.left.end),
        ...this.sides.right.tokens.slice(n.right.start, n.right.end),
      ].every((t) => t.type === 'hint');
      this.add({
        path,
        kind: hints && empty(n.left) ? 'added' : hints && empty(n.right) ? 'removed' : 'changed',
        aspect: hints ? 'hint' : lc.name === 'SELECT' ? 'select.distinct' : 'clause.head',
        description: hints
          ? empty(n.left)
            ? `Added optimizer hint ${this.q('right', n.right)}`
            : empty(n.right)
              ? `Removed optimizer hint ${this.q('left', n.left)}`
              : `Optimizer hint changed: ${this.q('left', n.left)} → ${this.q('right', n.right)}`
          : `${this.q('left', lc.head)} changed to ${this.q('right', rc.head)}`,
        left: n.left,
        right: n.right,
        scope: { left: lc.head, right: rc.head },
      });
    }
    const fallback = { left: lc.head.end, right: rc.head.end };
    switch (lc.kind) {
      case 'select-list':
        return this.selectList(lc, rc, path, fallback);
      case 'from':
        return this.from(lc.items, rc.items, path, fallback);
      case 'predicates':
        return this.predicates(
          lc.items,
          rc.items,
          path,
          `${lc.name} predicate`,
          'predicate',
          fallback,
        );
      case 'list':
        return this.list(
          lc.items,
          rc.items,
          path,
          fallback,
          `${lc.name} item`,
          'group.item',
          'group.moved',
        );
      case 'columns': {
        const noun = l.kind === 'CREATE VIEW' ? 'view column' : `${l.kind} column`;
        return this.list(lc.items, rc.items, path, fallback, noun, 'insert.column', 'insert.moved');
      }
      case 'order-by':
        return this.orderBy(
          lc,
          rc,
          path,
          fallback,
          l.kind === 'CREATE INDEX' ? 'index.column' : limited ? 'order.limited' : 'order.item',
        );
      case 'value':
        return this.value(lc, rc, path, l);
      case 'assignments':
        return this.assignments(lc, rc, path, fallback);
      case 'rows':
        return this.rows(lc, rc, path, fallback, l, r);
      case 'definitions':
        return this.definitions(lc.items, rc.items, path, fallback);
      case 'actions':
        return this.actions(lc.items, rc.items, path, fallback);
      case 'ctes':
        return this.ctes(lc.items, rc.items, path, fallback);
      case 'query':
        if (lc.query && rc.query) this.query(lc.query, rc.query, path);
        return;
    }
  }

  // --- item lists ------------------------------------------------------------

  selectList(lc: Clause, rc: Clause, path: string[], fallback: { left: number; right: number }) {
    const returning = lc.name === 'RETURNING';
    const noun = returning ? 'RETURNING column' : 'column';
    const where = returning ? 'RETURNING' : 'SELECT';
    const l = lc.items;
    const r = rc.items;
    const m = match(
      l,
      r,
      [(it) => `${it.key}\u0000${it.name ?? ''}`, (it) => it.key, (it) => it.name],
      true,
    );
    for (const [i, j] of m.pairs) {
      const li = l[i]!;
      const ri = r[j]!;
      const le = li.parts.expr ?? li.span;
      const re = ri.parts.expr ?? ri.span;
      const label = this.display('right', ri) ?? this.display('left', li);
      if (li.key !== ri.key) {
        const n = this.narrow(le, re);
        const literal = this.literalChange(n.left, n.right);
        const aspect: Aspect = returning
          ? 'returning'
          : literal === 'numeric-form'
            ? 'numeric-form'
            : literal
              ? 'select.literal'
              : 'select.expression';
        const sameName = (li.name ?? '') === (ri.name ?? '');
        const description = sameName
          ? `${capitalize(noun)}${label ? ` ${code(label)}` : ''} changed: ${this.q('left', le)} → ${this.q('right', re)}`
          : `${capitalize(noun)} changed: ${this.q('left', li.span)} → ${this.q('right', ri.span)}`;
        // When the alias changed too, the description shows both.
        this.add({
          path,
          kind: 'changed',
          aspect,
          description,
          left: n.left,
          right: n.right,
          scope: { left: li.span, right: ri.span },
        });
        continue;
      }
      this.alias(
        li,
        ri,
        path,
        this.show('right', re),
        le,
        re,
        returning ? 'returning' : 'select.alias',
      );
    }
    this.items(m, l, r, path, fallback, {
      aspect: returning ? 'returning' : 'select.column',
      movedAspect: returning ? 'returning' : 'select.moved',
      removed: (it) => `Removed ${noun} ${this.q('left', it.span)} from ${where}`,
      added: (it) => `Added ${noun} ${this.q('right', it.span)} to ${where}`,
      moved: (it, from, to) =>
        `${capitalize(noun)} ${this.q('left', it.span)} moved from ${ordinal(from)} to ${to + 1} in ${where}`,
    });
  }

  joinType(side: Side, item: Item): string {
    const join = item.parts.join;
    if (empty(join)) return 'FROM';
    const words = this.key(side, join)
      .split(' ')
      .filter((w) => w !== 'OUTER' && w !== 'JOIN');
    if (words[0] === ',') return 'comma';
    if (words.length === 0 || (words.length === 1 && words[0] === 'INNER')) return 'INNER';
    return words.join(' ');
  }

  tableLabel(side: Side, item: Item): string {
    if (item.query) return this.display(side, item) ?? 'subquery';
    return this.show(side, item.parts.table ?? item.span);
  }

  from(l: Item[], r: Item[], path: string[], fallback: { left: number; right: number }) {
    const m = match(
      l,
      r,
      [(it) => `${it.key}\u0000${it.name ?? ''}`, (it) => it.key, (it) => it.name],
      true,
    );
    const outer = [
      ...l.map((it) => this.joinType('left', it)),
      ...r.map((it) => this.joinType('right', it)),
    ].some((t) => OUTER_JOINS.has(t.split(' ').find((w) => OUTER_JOINS.has(w)) ?? ''));
    for (const [i, j] of m.pairs) {
      const li = l[i]!;
      const ri = r[j]!;
      const label = this.tableLabel('right', ri);
      const itemPath = [...path, label];
      const lTable = li.parts.table ?? li.span;
      const rTable = ri.parts.table ?? ri.span;
      if (li.key !== ri.key && !(li.query && ri.query)) {
        this.changed(
          itemPath,
          'from.table',
          `Table changed from ${this.q('left', lTable)} to ${this.q('right', rTable)}`,
          lTable,
          rTable,
        );
      }
      const lj = this.joinType('left', li);
      const rj = this.joinType('right', ri);
      if (lj !== rj && lj !== 'FROM' && rj !== 'FROM') {
        this.changed(
          [...itemPath, 'join type'],
          'from.join-type',
          `JOIN ${code(label)} changed from ${lj} to ${rj}`,
          li.parts.join!,
          ri.parts.join!,
        );
      }
      this.alias(li, ri, itemPath, label, lTable, rTable);
      const lc = li.children;
      const rc = ri.children;
      if (lc && rc) {
        this.predicates(
          lc,
          rc,
          [...itemPath, 'ON'],
          `JOIN ${code(label)} condition`,
          'from.condition',
          {
            left: li.parts.condition!.start,
            right: ri.parts.condition!.start,
          },
        );
      } else if (lc || rc) {
        this.add({
          path: [...itemPath, 'ON'],
          kind: lc ? 'removed' : 'added',
          aspect: 'from.condition',
          description: lc
            ? `Removed JOIN ${code(label)} condition ${this.q('left', li.parts.condition)}`
            : `Added JOIN ${code(label)} condition ${this.q('right', ri.parts.condition)}`,
          left: li.parts.condition ?? null,
          right: ri.parts.condition ?? null,
          leftAt: li.span.end,
          rightAt: ri.span.end,
        });
      }
      if (li.query && ri.query) this.query(li.query, ri.query, [...path, `subquery ${label}`]);
    }
    const joinWord = (side: Side, it: Item) => {
      const t = this.joinType(side, it);
      return t === 'FROM' || t === 'comma' ? 'table' : `${t} JOIN`;
    };
    this.items(m, l, r, path, fallback, {
      aspect: 'from.table',
      movedAspect: outer ? 'from.moved-outer' : 'from.moved',
      removed: (it) => `Removed ${joinWord('left', it)} ${code(this.tableLabel('left', it))}`,
      added: (it) => `Added ${joinWord('right', it)} ${code(this.tableLabel('right', it))}`,
      moved: (it, from, to) =>
        `Table ${code(this.tableLabel('left', it))} moved from ${ordinal(from)} to ${to + 1} in FROM`,
    });
  }

  predicates(
    l: Item[],
    r: Item[],
    path: string[],
    noun: string,
    aspect: Aspect,
    fallback: { left: number; right: number },
  ) {
    const m = match(l, r, [(it) => it.key, (it) => it.name], true);
    for (const [i, j] of m.pairs) {
      const li = l[i]!;
      const ri = r[j]!;
      if (li.key === ri.key) continue;
      const n = this.narrow(li.span, ri.span);
      const numeric = this.literalChange(n.left, n.right) === 'numeric-form';
      this.add({
        path,
        kind: 'changed',
        aspect: numeric ? 'numeric-form' : aspect,
        description: `${capitalize(noun)} changed: ${this.q('left', li.span)} → ${this.q('right', ri.span)}`,
        left: n.left,
        right: n.right,
        scope: { left: li.span, right: ri.span },
      });
    }
    this.items(m, l, r, path, fallback, {
      aspect,
      movedAspect: 'predicate.moved',
      removed: (it) => `Removed ${noun} ${this.q('left', it.span)}`,
      added: (it) => `Added ${noun} ${this.q('right', it.span)}`,
      moved: (it, from, to) =>
        `${capitalize(noun)} ${this.q('left', it.span)} moved from ${ordinal(from)} to ${to + 1}`,
    });
  }

  list(
    l: Item[],
    r: Item[],
    path: string[],
    fallback: { left: number; right: number },
    noun: string,
    aspect: Aspect,
    movedAspect: Aspect,
  ) {
    const m = match(l, r, [(it) => it.key], true);
    for (const [i, j] of m.pairs) {
      const li = l[i]!;
      const ri = r[j]!;
      if (li.key === ri.key) continue;
      this.changed(
        path,
        aspect,
        `${capitalize(noun)} changed: ${this.q('left', li.span)} → ${this.q('right', ri.span)}`,
        li.span,
        ri.span,
      );
    }
    this.items(m, l, r, path, fallback, {
      aspect,
      movedAspect,
      removed: (it) => `Removed ${noun} ${this.q('left', it.span)}`,
      added: (it) => `Added ${noun} ${this.q('right', it.span)}`,
      moved: (it, from, to) =>
        `${capitalize(noun)} ${this.q('left', it.span)} moved from ${ordinal(from)} to ${to + 1}`,
    });
  }

  direction(side: Side, item: Item): string {
    const words = this.key(side, item.parts.direction).split(' ').filter(Boolean);
    const dir = words.includes('DESC') ? 'DESC' : 'ASC';
    const nulls = words.indexOf('NULLS');
    return nulls === -1 ? dir : `${dir} NULLS ${words[nulls + 1] ?? ''}`;
  }

  orderBy(
    lc: Clause,
    rc: Clause,
    path: string[],
    fallback: { left: number; right: number },
    aspect: Aspect,
  ) {
    const l = lc.items;
    const r = rc.items;
    const noun = aspect === 'index.column' ? 'index column' : 'ORDER BY item';
    const m = match(l, r, [(it) => it.key], true);
    for (const [i, j] of m.pairs) {
      const li = l[i]!;
      const ri = r[j]!;
      if (li.key !== ri.key) {
        this.changed(
          path,
          aspect,
          `${capitalize(noun)} changed: ${this.q('left', li.span)} → ${this.q('right', ri.span)}`,
          li.span,
          ri.span,
        );
        continue;
      }
      const ld = this.direction('left', li);
      const rd = this.direction('right', ri);
      if (ld !== rd) {
        const expr = this.q('right', ri.parts.expr);
        this.add({
          path,
          kind: 'changed',
          aspect,
          description:
            aspect === 'index.column'
              ? `Index column ${expr} changed from ${ld} to ${rd}`
              : `ORDER BY ${expr} changed from ${ld} to ${rd}`,
          left: empty(li.parts.direction) ? null : li.parts.direction!,
          right: empty(ri.parts.direction) ? null : ri.parts.direction!,
          leftAt: li.span.end,
          rightAt: ri.span.end,
        });
      }
    }
    this.items(m, l, r, path, fallback, {
      aspect,
      movedAspect: aspect,
      removed: (it) => `Removed ${noun} ${this.q('left', it.span)}`,
      added: (it) => `Added ${noun} ${this.q('right', it.span)}`,
      moved: (it, from, to) =>
        `${capitalize(noun)} ${this.q('left', it.span)} moved from ${ordinal(from)} to ${to + 1}`,
    });
  }

  value(lc: Clause, rc: Clause, path: string[], model: QueryModel) {
    const li = lc.items[0];
    const ri = rc.items[0];
    const aspect: Aspect =
      lc.name === 'options'
        ? 'ddl.options'
        : model.kind === 'CREATE INDEX' && lc.name === 'ON'
          ? 'statement.target'
          : 'value';
    const name =
      lc.name === 'options'
        ? 'Options'
        : model.kind === 'CREATE INDEX' && lc.name === 'ON'
          ? 'Indexed table'
          : lc.name;
    if (li && ri) {
      if (li.key === ri.key) return;
      const n = this.narrow(li.span, ri.span);
      const numeric = this.literalChange(n.left, n.right) === 'numeric-form';
      this.add({
        path,
        kind: 'changed',
        aspect: numeric ? 'numeric-form' : aspect,
        description: `${name} changed from ${this.q('left', li.span)} to ${this.q('right', ri.span)}`,
        left: n.left,
        right: n.right,
        scope: { left: li.span, right: ri.span },
      });
    } else if (li || ri) {
      this.add({
        path,
        kind: li ? 'removed' : 'added',
        aspect,
        description: li
          ? `Removed ${name} value ${this.q('left', li.span)}`
          : `Added ${name} value ${this.q('right', ri!.span)}`,
        left: li?.span ?? null,
        right: ri?.span ?? null,
        leftAt: lc.span.end,
        rightAt: rc.span.end,
      });
    }
  }

  assignments(lc: Clause, rc: Clause, path: string[], fallback: { left: number; right: number }) {
    const l = lc.items;
    const r = rc.items;
    const m = match(l, r, [(it) => it.key], false);
    for (const [i, j] of m.pairs) {
      const li = l[i]!;
      const ri = r[j]!;
      const lv = li.parts.value!;
      const rv = ri.parts.value!;
      if (this.key('left', lv) === this.key('right', rv)) continue;
      this.changed(
        path,
        'assignment',
        `${lc.name} ${this.q('right', ri.parts.column)} changed: ${this.q('left', lv)} → ${this.q('right', rv)}`,
        lv,
        rv,
      );
    }
    this.items(m, l, r, path, fallback, {
      aspect: 'assignment',
      movedAspect: 'assignment.moved',
      removed: (it) => `Removed assignment ${this.q('left', it.span)} from ${lc.name}`,
      added: (it) => `Added assignment ${this.q('right', it.span)} to ${rc.name}`,
      moved: (it, from, to) =>
        `Assignment ${this.q('left', it.span)} moved from ${ordinal(from)} to ${to + 1} in ${lc.name}`,
    });
  }

  rows(
    lc: Clause,
    rc: Clause,
    path: string[],
    fallback: { left: number; right: number },
    l: QueryModel,
    r: QueryModel,
  ) {
    const columns = (model: QueryModel) =>
      model.clauses.find((c) => c.name === 'columns')?.items.map((it) => it.name ?? it.key) ?? [];
    const lcols = columns(l);
    const rcols = columns(r);
    const m = sequencePairs(
      lc.items.map((it) => it.key),
      rc.items.map((it) => it.key),
    );
    for (const [i, j] of m.pairs) {
      const lrow = lc.items[i]!;
      const rrow = rc.items[j]!;
      if (lrow.key === rrow.key) continue;
      const lv = lrow.children ?? [];
      const rv = rrow.children ?? [];
      const rowPath = [...path, `row ${j + 1}`];
      for (let k = 0; k < Math.max(lv.length, rv.length); k++) {
        const a = lv[k];
        const b = rv[k];
        const column = rcols[k] ?? lcols[k];
        const where = `VALUES row ${j + 1}${column ? `, ${code(column)}` : `, value ${k + 1}`}`;
        if (a && b) {
          if (a.key === b.key) continue;
          const n = this.narrow(a.span, b.span);
          const numeric = this.literalChange(n.left, n.right) === 'numeric-form';
          this.add({
            path: rowPath,
            kind: 'changed',
            aspect: numeric ? 'numeric-form' : 'insert.value',
            description: `${where} changed: ${this.q('left', a.span)} → ${this.q('right', b.span)}`,
            left: n.left,
            right: n.right,
            scope: { left: a.span, right: b.span },
          });
        } else {
          this.add({
            path: rowPath,
            kind: a ? 'removed' : 'added',
            aspect: 'insert.value',
            description: a
              ? `${where}: removed value ${this.q('left', a.span)}`
              : `${where}: added value ${this.q('right', b!.span)}`,
            left: a?.span ?? null,
            right: b?.span ?? null,
            leftAt: lrow.span.end - 1,
            rightAt: rrow.span.end - 1,
          });
        }
      }
    }
    this.items(m, lc.items, rc.items, path, fallback, {
      aspect: 'insert.row',
      movedAspect: 'insert.row',
      removed: (it) => `Removed VALUES row ${this.q('left', it.span)}`,
      added: (it) => `Added VALUES row ${this.q('right', it.span)}`,
      moved: (it) => `VALUES row ${this.q('left', it.span)} moved`,
    });
  }

  definitions(l: Item[], r: Item[], path: string[], fallback: { left: number; right: number }) {
    const m = match(l, r, [(it) => it.key], false);
    // A single column dropped and another added in its place: a rename.
    if (m.removed.length === 1 && m.added.length === 1) {
      const li = l[m.removed[0]!]!;
      const ri = r[m.added[0]!]!;
      if (
        li.role === 'column' &&
        ri.role === 'column' &&
        this.key('left', li.parts.type) === this.key('right', ri.parts.type)
      ) {
        m.pairs.push([m.removed[0]!, m.added[0]!]);
        m.pairs.sort((a, b) => a[0] - b[0]);
        m.removed = [];
        m.added = [];
      }
    }
    for (const [i, j] of m.pairs) {
      const li = l[i]!;
      const ri = r[j]!;
      if (li.role === 'column' && ri.role === 'column') {
        this.column(li, ri, [...path, `column ${this.display('right', ri) ?? ''}`]);
      } else if (this.key('left', li.span) !== this.key('right', ri.span)) {
        this.changed(
          path,
          'ddl.constraint',
          `Constraint${ri.name ? ` ${code(this.display('right', ri)!)}` : ''} changed: ${this.q('left', li.span)} → ${this.q('right', ri.span)}`,
          li.span,
          ri.span,
        );
      }
    }
    const noun = (it: Item) => (it.role === 'column' ? 'column' : 'constraint');
    this.items(m, l, r, path, fallback, {
      aspect: (it) => (it.role === 'column' ? 'ddl.column' : 'ddl.constraint'),
      movedAspect: 'ddl.moved',
      removed: (it) => `Removed ${noun(it)} ${this.q('left', it.span)}`,
      added: (it) => `Added ${noun(it)} ${this.q('right', it.span)}`,
      moved: (it, from, to) =>
        `${capitalize(noun(it))} ${code(this.display('left', it) ?? this.show('left', it.span))} moved from ${ordinal(from)} to ${to + 1}`,
    });
  }

  column(li: Item, ri: Item, path: string[]) {
    const name = this.display('right', ri) ?? '';
    if (li.name !== ri.name) {
      this.changed(
        path,
        'ddl.column',
        `Column ${code(this.display('left', li) ?? '')} renamed to ${code(name)}`,
        li.parts.column!,
        ri.parts.column!,
      );
    }
    const lt = li.parts.type!;
    const rt = ri.parts.type!;
    if (this.key('left', lt) !== this.key('right', rt)) {
      this.changed(
        path,
        'ddl.type',
        `Column ${code(name)} type changed from ${this.q('left', lt)} to ${this.q('right', rt)}`,
        lt,
        rt,
      );
    }
    const l = li.children ?? [];
    const r = ri.children ?? [];
    const m = match(l, r, [(it) => it.key, (it) => it.name], false);
    const aspectOf = (it: Item): Aspect =>
      it.name === 'DEFAULT'
        ? 'ddl.default'
        : it.name === 'COMMENT'
          ? 'ddl.comment'
          : 'ddl.constraint';
    for (const [i, j] of m.pairs) {
      const a = l[i]!;
      const b = r[j]!;
      if (a.key === b.key) continue;
      const description =
        a.name === 'nullability'
          ? `Column ${code(name)} changed from ${this.show('left', a.span)} to ${this.show('right', b.span)}`
          : a.name === 'DEFAULT' || a.name === 'COMMENT'
            ? `Column ${code(name)} ${a.name} changed: ${this.q('left', a.span)} → ${this.q('right', b.span)}`
            : `Column ${code(name)} constraint changed: ${this.q('left', a.span)} → ${this.q('right', b.span)}`;
      this.changed(path, aspectOf(a), description, a.span, b.span);
    }
    this.items(
      m,
      l,
      r,
      path,
      { left: lt.end, right: rt.end },
      {
        aspect: aspectOf,
        movedAspect: 'ddl.moved',
        removed: (it) => `Column ${code(name)}: removed ${this.q('left', it.span)}`,
        added: (it) => `Column ${code(name)}: added ${this.q('right', it.span)}`,
        moved: (it) => `Column ${code(name)}: ${this.q('left', it.span)} moved`,
      },
    );
  }

  actions(l: Item[], r: Item[], path: string[], fallback: { left: number; right: number }) {
    const m = match(l, r, [(it) => it.key], false);
    for (const [i, j] of m.pairs) {
      const li = l[i]!;
      const ri = r[j]!;
      if (this.key('left', li.span) === this.key('right', ri.span)) continue;
      this.changed(
        path,
        'ddl.action',
        `Action changed: ${this.q('left', li.span)} → ${this.q('right', ri.span)}`,
        li.span,
        ri.span,
      );
    }
    this.items(m, l, r, path, fallback, {
      aspect: 'ddl.action',
      movedAspect: 'ddl.action-moved',
      removed: (it) => `Removed action ${this.q('left', it.span)}`,
      added: (it) => `Added action ${this.q('right', it.span)}`,
      moved: (it, from, to) =>
        `Action ${this.q('left', it.span)} moved from ${ordinal(from)} to ${to + 1}`,
    });
  }

  ctes(l: Item[], r: Item[], path: string[], fallback: { left: number; right: number }) {
    const m = match(l, r, [(it) => it.key, (it) => it.name], false);
    for (const [i, j] of m.pairs) {
      const li = l[i]!;
      const ri = r[j]!;
      const cte = [...path, `CTE ${this.display('right', ri) ?? ''}`];
      if (li.key !== ri.key) {
        this.changed(
          cte,
          'cte.changed',
          `CTE ${code(this.display('right', ri) ?? '')} header changed: ${code(li.key)} → ${code(ri.key)}`,
          { start: li.span.start, end: li.parts.expr!.start },
          { start: ri.span.start, end: ri.parts.expr!.start },
        );
      }
      if (li.query && ri.query) this.query(li.query, ri.query, cte);
    }
    this.items(m, l, r, path, fallback, {
      aspect: (_, kind) => (kind === 'added' ? 'cte.added' : 'cte.removed'),
      movedAspect: 'cte.moved',
      removed: (it) => `Removed CTE ${code(this.display('left', it) ?? '')}`,
      added: (it) => `Added CTE ${code(this.display('right', it) ?? '')}`,
      moved: (it, from, to) =>
        `CTE ${code(this.display('left', it) ?? '')} moved from ${ordinal(from)} to ${to + 1}`,
    });
  }
}

/** Labels of clauses that have no keyword of their own. */
const CLAUSE_LABELS: Record<string, string> = {
  columns: 'column list',
  options: 'options',
  tables: 'tables',
  actions: 'actions',
};
