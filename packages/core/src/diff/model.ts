import {
  caseEnd,
  isPunct,
  isWrapped,
  matchParens,
  splitTopLevel,
  word,
  type Range,
} from '../normalize/structure.js';
import type { NormToken } from '../normalize/types.js';

/**
 * Clause model of one statement (PLAN §5.5 step 3.4), built from the
 * normalized tokens of a statement the dialect parser accepted. Both parsers
 * produce very different ASTs; this model is dialect-neutral and keeps token
 * ranges, so every difference maps back to exact source positions.
 *
 * All ranges are token index ranges into the statement's tokens.
 */

export interface Item {
  /** Match key: normalized text (keywords upper-cased). */
  key: string;
  span: Range;
  /** Secondary match key and display name: alias, column or constraint name. */
  name?: string;
  /** Token holding `name`, so it can be shown with its original spelling. */
  nameAt?: number;
  /** Named sub-ranges compared individually (expression, alias, join, type, …). */
  parts: Partial<Record<ItemPart, Range>>;
  /** Nested query: CTE body, derived table. */
  query?: QueryModel;
  /** Nested items: join condition predicates, VALUES row values, column constraints. */
  children?: Item[];
  /** Definitions: what this item defines. */
  role?: 'column' | 'constraint';
}

export type ItemPart =
  'expr' | 'alias' | 'join' | 'table' | 'condition' | 'direction' | 'column' | 'value' | 'type';

export type ClauseKind =
  /** SELECT list / RETURNING: expressions with optional aliases. */
  | 'select-list'
  /** FROM / USING: tables and joins. */
  | 'from'
  /** WHERE / HAVING / QUALIFY: AND-ed predicates. */
  | 'predicates'
  /** GROUP BY, index columns: plain expressions. */
  | 'list'
  | 'order-by'
  /** LIMIT, OFFSET, table options…: compared as a whole. */
  | 'value'
  /** SET a = 1, b = 2. */
  | 'assignments'
  /** INSERT column list. */
  | 'columns'
  /** VALUES rows. */
  | 'rows'
  /** CREATE TABLE column and constraint definitions. */
  | 'definitions'
  /** ALTER TABLE actions. */
  | 'actions'
  /** WITH: common table expressions. */
  | 'ctes'
  /** INSERT … SELECT, CREATE … AS SELECT. */
  | 'query';

export interface Clause {
  /** Display name and path segment: "SELECT", "GROUP BY", "ON CONFLICT", … */
  name: string;
  kind: ClauseKind;
  /** Whole clause, including its head. */
  span: Range;
  /** Head: keyword(s) and modifiers, e.g. `SELECT DISTINCT`. */
  head: Range;
  items: Item[];
  query?: QueryModel;
}

export interface Branch {
  /** Set operator before this branch (`UNION ALL`, …); empty for the first branch. */
  op: Range;
  query: QueryModel;
}

export interface QueryModel {
  /** Statement kind: "SELECT", "INSERT", "CREATE TABLE", … */
  kind: string;
  span: Range;
  /** Statement head compared as a whole, e.g. `CREATE TEMP TABLE IF NOT EXISTS`. */
  head?: Range;
  /** Target object of DML/DDL statements. */
  target?: Item;
  clauses: Clause[];
  /** Set operation branches (UNION / INTERSECT / EXCEPT). */
  branches?: Branch[];
}

const SET_OPERATORS = new Set(['UNION', 'INTERSECT', 'EXCEPT', 'MINUS']);
const TRAILING = new Set(['ORDER', 'LIMIT', 'OFFSET', 'FETCH']);
const SELECT_MODIFIERS = new Set([
  'ALL',
  'DISTINCT',
  'DISTINCTROW',
  'HIGH_PRIORITY',
  'STRAIGHT_JOIN',
  'SQL_SMALL_RESULT',
  'SQL_BIG_RESULT',
  'SQL_BUFFER_RESULT',
  'SQL_NO_CACHE',
  'SQL_CACHE',
  'SQL_CALC_FOUND_ROWS',
]);
const DML_MODIFIERS = new Set(['LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY', 'IGNORE', 'QUICK']);
const JOIN_WORDS = new Set([
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'OUTER',
  'CROSS',
  'NATURAL',
  'STRAIGHT_JOIN',
]);
const COMPARISON = new Set([
  '=',
  '<>',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '<=>',
  '~',
  '~*',
  '!~',
  '!~*',
  '@>',
  '<@',
  '&&',
]);
const COMPARISON_WORDS = new Set([
  'LIKE',
  'ILIKE',
  'IN',
  'IS',
  'BETWEEN',
  'SIMILAR',
  'REGEXP',
  'RLIKE',
  'NOT',
]);
const ORDER_SUFFIX = new Set(['ASC', 'DESC', 'NULLS', 'FIRST', 'LAST']);
/** Words that end a column type in a column definition. */
const COLUMN_CONSTRAINT = new Set([
  'NOT',
  'NULL',
  'DEFAULT',
  'PRIMARY',
  'UNIQUE',
  'REFERENCES',
  'CHECK',
  'CONSTRAINT',
  'COLLATE',
  'GENERATED',
  'AUTO_INCREMENT',
  'AUTOINCREMENT',
  'COMMENT',
  'ON',
  'AS',
  'CHARACTER',
  'CHARSET',
  'VISIBLE',
  'INVISIBLE',
  'STORAGE',
  'COMPRESSION',
  'COLUMN_FORMAT',
  'SRID',
]);
const TABLE_CONSTRAINT = new Set([
  'CONSTRAINT',
  'PRIMARY',
  'UNIQUE',
  'FOREIGN',
  'CHECK',
  'KEY',
  'INDEX',
  'FULLTEXT',
  'SPATIAL',
  'EXCLUDE',
  'LIKE',
  'PERIOD',
]);
const ALTER_OBJECTS = new Set([
  'CONSTRAINT',
  'INDEX',
  'KEY',
  'UNIQUE',
  'PRIMARY',
  'FOREIGN',
  'CHECK',
  'PARTITION',
  'COLUMN',
]);
/** Words that can't be an alias written without AS. */
const NOT_ALIAS = new Set([
  'NULL',
  'TRUE',
  'FALSE',
  'END',
  'ASC',
  'DESC',
  'AND',
  'OR',
  'NOT',
  'LATERAL',
  'ONLY',
  'UNKNOWN',
]);

export interface ModelContext {
  /** Upper-cased keywords, data types and built-in functions (dialect). */
  keywords: ReadonlySet<string>;
}

/** Comparison key of a token range: keywords upper-cased, everything else verbatim. */
export function keyOf(tokens: NormToken[], range: Range, keywords: ReadonlySet<string>): string {
  const out: string[] = [];
  for (let i = range.start; i < range.end; i++) {
    const t = tokens[i]!;
    const upper = t.type === 'word' ? t.text.toUpperCase() : '';
    out.push(upper && keywords.has(upper) ? upper : t.text);
  }
  return out.join(' ');
}

/** Build the clause model of a statement's normalized tokens. */
export function buildModel(tokens: NormToken[], kind: string, ctx: ModelContext): QueryModel {
  const parens = matchParens(tokens);
  const all: Range = { start: 0, end: tokens.length };
  if (!parens) return { kind, span: all, clauses: [] };
  return new Builder(tokens, parens, ctx).statement(all, kind);
}

class Builder {
  constructor(
    private readonly tokens: NormToken[],
    private readonly parens: Map<number, number>,
    private readonly ctx: ModelContext,
  ) {}

  // --- helpers -------------------------------------------------------------

  w(i: number): string {
    return word(this.tokens[i]);
  }

  key(range: Range): string {
    return keyOf(this.tokens, range, this.ctx.keywords);
  }

  /** Indices of top-level tokens in `range` (parenthesized groups and CASE…END skipped). */
  top(range: Range): number[] {
    const out: number[] = [];
    for (let i = range.start; i < range.end; i++) {
      out.push(i);
      if (isPunct(this.tokens[i], '(')) i = this.parens.get(i) ?? i;
      else if (this.w(i) === 'CASE') i = Math.min(caseEnd(this.tokens, i), range.end - 1);
    }
    return out;
  }

  trim(range: Range): Range {
    let { start, end } = range;
    while (start < end && isPunct(this.tokens[start], ';')) start++;
    while (end > start && isPunct(this.tokens[end - 1], ';')) end--;
    return { start, end };
  }

  unwrap(range: Range): Range {
    let r = range;
    while (isWrapped(r, this.parens, this.tokens)) r = { start: r.start + 1, end: r.end - 1 };
    return r;
  }

  isName(i: number): boolean {
    const t = this.tokens[i];
    return t !== undefined && (t.type === 'word' || t.type === 'quoted-identifier');
  }

  /** End of a (possibly qualified) object name starting at `i`. */
  nameEnd(i: number, end: number): number {
    if (!this.isName(i)) return i;
    let j = i + 1;
    while (j + 1 < end && isPunct(this.tokens[j], '.') && this.isName(j + 1)) j += 2;
    return j;
  }

  item(span: Range, extra: Partial<Item> = {}): Item {
    return { key: this.key(span), span, parts: {}, ...extra };
  }

  /** Split [range] on top-level commas, dropping empty parts. */
  commaList(range: Range): Range[] {
    if (range.end <= range.start) return [];
    return splitTopLevel(this.tokens, range, ',', this.parens).filter((r) => r.end > r.start);
  }

  /**
   * Split a range into clauses at top-level keywords. `starts(i)` returns the
   * clause name and head length when token `i` begins a clause.
   */
  clauses(
    range: Range,
    starts: (i: number) => { name: string; head: number } | null,
  ): { preamble: Range; found: Array<{ name: string; span: Range; head: Range; body: Range }> } {
    const marks: Array<{ name: string; at: number; head: number }> = [];
    for (const i of this.top(range)) {
      const s = starts(i);
      if (s) marks.push({ name: s.name, at: i, head: s.head });
    }
    const found = marks.map((m, k) => {
      const end = marks[k + 1]?.at ?? range.end;
      const headEnd = Math.min(m.at + m.head, end);
      return {
        name: m.name,
        span: { start: m.at, end },
        head: { start: m.at, end: headEnd },
        body: { start: headEnd, end },
      };
    });
    return { preamble: { start: range.start, end: marks[0]?.at ?? range.end }, found };
  }

  // --- statements ----------------------------------------------------------

  statement(range: Range, kind: string): QueryModel {
    const r = this.unwrap(this.trim(range));
    const first = this.w(r.start);
    if (first === 'WITH') return this.withQuery(r);
    if (
      first === 'SELECT' ||
      first === 'VALUES' ||
      first === 'TABLE' ||
      isPunct(this.tokens[r.start], '(')
    )
      return this.query(r);
    if (first === 'INSERT' || first === 'REPLACE') return this.insert(r, first);
    if (first === 'UPDATE') return this.update(r);
    if (first === 'DELETE') return this.delete(r);
    if (kind === 'CREATE TABLE') return this.createTable(r);
    if (kind === 'CREATE VIEW') return this.createView(r);
    if (kind === 'CREATE INDEX') return this.createIndex(r);
    if (kind === 'ALTER TABLE') return this.alterTable(r);
    return { kind, span: r, clauses: [] };
  }

  withQuery(range: Range): QueryModel {
    // WITH [RECURSIVE] name [(cols)] AS [[NOT] MATERIALIZED] (query), … main
    let i = range.start + 1;
    if (this.w(i) === 'RECURSIVE') i++;
    const head: Range = { start: range.start, end: i };
    const items: Item[] = [];
    while (i < range.end && this.isName(i)) {
      const start = i;
      i++;
      if (isPunct(this.tokens[i], '(')) i = (this.parens.get(i) ?? i) + 1;
      if (this.w(i) !== 'AS') break;
      i++;
      if (this.w(i) === 'NOT') i++;
      if (this.w(i) === 'MATERIALIZED') i++;
      if (!isPunct(this.tokens[i], '(')) break;
      const close = this.parens.get(i) ?? i;
      const body: Range = { start: i + 1, end: close };
      const span: Range = { start, end: close + 1 };
      items.push({
        key: this.key({ start, end: i }),
        name: this.tokens[start]!.text,
        nameAt: start,
        span,
        parts: { expr: body },
        query: this.statement(body, ''),
      });
      i = close + 1;
      if (!isPunct(this.tokens[i], ',')) break;
      i++;
    }
    const main = this.statement({ start: i, end: range.end }, '');
    const clause: Clause = {
      name: 'WITH',
      kind: 'ctes',
      span: { start: range.start, end: i },
      head,
      items,
    };
    return { ...main, span: range, clauses: [clause, ...main.clauses] };
  }

  /** SELECT, possibly combined with set operators. */
  query(range: Range): QueryModel {
    const ops = this.top(range).filter((i) => SET_OPERATORS.has(this.w(i)));
    if (ops.length === 0) return this.simpleSelect(range);
    const branches: Branch[] = [];
    let start = range.start;
    let op: Range = { start, end: start };
    for (const at of ops) {
      branches.push({ op, query: this.branch({ start, end: at }) });
      let end = at + 1;
      if (this.w(end) === 'ALL' || this.w(end) === 'DISTINCT') end++;
      op = { start: at, end };
      start = end;
    }
    // ORDER BY / LIMIT after the last branch apply to the whole set operation.
    let lastEnd = range.end;
    if (!isPunct(this.tokens[start], '(')) {
      const trailing = this.top({ start, end: range.end }).find(
        (i) => TRAILING.has(this.w(i)) && this.isClauseStart(i),
      );
      if (trailing !== undefined) lastEnd = trailing;
    } else {
      lastEnd = (this.parens.get(start) ?? range.end - 1) + 1;
    }
    branches.push({ op, query: this.branch({ start, end: lastEnd }) });
    const tail = this.selectClauses({ start: lastEnd, end: range.end });
    return { kind: 'SELECT', span: range, clauses: tail, branches };
  }

  branch(range: Range): QueryModel {
    const inner = this.unwrap(range);
    return inner.start !== range.start ? this.query(inner) : this.simpleSelect(range);
  }

  isClauseStart(i: number): boolean {
    const w = this.w(i);
    if (w === 'ORDER' || w === 'GROUP') return this.w(i + 1) === 'BY';
    if (w === 'FROM') return this.w(i - 1) !== 'DISTINCT';
    if (w === 'LOCK') return this.w(i + 1) === 'IN';
    return true;
  }

  simpleSelect(range: Range): QueryModel {
    if (this.w(range.start) === 'VALUES') {
      return {
        kind: 'SELECT',
        span: range,
        clauses: [this.rowsClause('VALUES', range, { start: range.start, end: range.start + 1 })],
      };
    }
    return { kind: 'SELECT', span: range, clauses: this.selectClauses(range) };
  }

  selectStart = (i: number): { name: string; head: number } | null => {
    const w = this.w(i);
    if (!this.isClauseStart(i)) return null;
    switch (w) {
      case 'SELECT': {
        let j = i + 1;
        while (SELECT_MODIFIERS.has(this.w(j)) || this.tokens[j]?.type === 'hint') {
          const distinctOn = this.w(j) === 'DISTINCT' && this.w(j + 1) === 'ON';
          j += distinctOn ? 2 : 1;
          if (distinctOn && isPunct(this.tokens[j], '(')) j = (this.parens.get(j) ?? j) + 1;
        }
        return { name: 'SELECT', head: j - i };
      }
      case 'GROUP': {
        const modifier = this.w(i + 2) === 'ALL' || this.w(i + 2) === 'DISTINCT';
        return { name: 'GROUP BY', head: modifier ? 3 : 2 };
      }
      case 'ORDER':
        return { name: 'ORDER BY', head: 2 };
      case 'LOCK':
        return { name: 'LOCK', head: 1 };
      case 'INTO':
      case 'FROM':
      case 'WHERE':
      case 'HAVING':
      case 'WINDOW':
      case 'QUALIFY':
      case 'LIMIT':
      case 'OFFSET':
      case 'FETCH':
      case 'FOR':
      case 'RETURNING':
        return { name: w, head: 1 };
      default:
        return null;
    }
  };

  selectClauses(range: Range): Clause[] {
    return this.clauses(range, this.selectStart).found.map((c) =>
      this.clause(c.name, c.span, c.head, c.body),
    );
  }

  /** Build a SELECT-family clause from its name. */
  clause(name: string, span: Range, head: Range, body: Range): Clause {
    const base = { name, span, head };
    switch (name) {
      case 'SELECT':
      case 'RETURNING':
        return { ...base, kind: 'select-list', items: this.selectItems(body) };
      case 'FROM':
      case 'USING':
        return { ...base, kind: 'from', items: this.fromItems(body) };
      case 'WHERE':
      case 'HAVING':
      case 'QUALIFY':
        return { ...base, kind: 'predicates', items: this.predicates(body) };
      case 'GROUP BY':
        return { ...base, kind: 'list', items: this.commaList(body).map((r) => this.item(r)) };
      case 'ORDER BY':
        return { ...base, kind: 'order-by', items: this.orderItems(body) };
      case 'SET':
        return { ...base, kind: 'assignments', items: this.assignments(body) };
      default:
        return { ...base, kind: 'value', items: body.end > body.start ? [this.item(body)] : [] };
    }
  }

  // --- items -----------------------------------------------------------------

  /** Split `expr [AS] alias`. */
  alias(range: Range): { expr: Range; alias?: Range } {
    const { start, end } = range;
    const last = end - 1;
    if (end - start < 2 || !this.isName(last)) return { expr: range };
    const t = this.tokens[last]!;
    const prev = this.tokens[last - 1]!;
    if (word(prev) === 'AS') {
      return end - start >= 3
        ? { expr: { start, end: last - 1 }, alias: { start: last, end } }
        : { expr: range };
    }
    const upper = t.type === 'word' ? t.text.toUpperCase() : '';
    if (NOT_ALIAS.has(upper)) return { expr: range };
    const prevEndsExpr =
      prev.type === 'word' ||
      prev.type === 'quoted-identifier' ||
      prev.type === 'number' ||
      prev.type === 'string' ||
      isPunct(prev, ')') ||
      (prev.type === 'operator' && prev.text === '*');
    if (!prevEndsExpr) return { expr: range };
    const prevUpper = prev.type === 'word' ? prev.text.toUpperCase() : '';
    // `timestamp with time zone`, `x IS NULL`, `CASE … END`: keywords on both sides.
    if (prevUpper && this.ctx.keywords.has(prevUpper) && this.ctx.keywords.has(upper)) {
      return { expr: range };
    }
    if (
      prevUpper &&
      (COMPARISON_WORDS.has(prevUpper) || prevUpper === 'DISTINCT' || prevUpper === 'INTERVAL')
    ) {
      return { expr: range };
    }
    // `*` is only an expression end in `t.*` / `count(*)`, not as a multiplication.
    if (isPunct(prev, '*') && !isPunct(this.tokens[last - 2], '.')) return { expr: range };
    return { expr: { start, end: last }, alias: { start: last, end } };
  }

  /** Display name of a column expression: `t.col` → `col`. */
  columnName(expr: Range): string | undefined {
    const end = this.nameEnd(expr.start, expr.end);
    if (end !== expr.end) return undefined;
    return this.tokens[end - 1]!.text;
  }

  selectItems(body: Range): Item[] {
    return this.commaList(body).map((span) => {
      const { expr, alias } = this.alias(span);
      const name = alias ? this.tokens[alias.start]!.text : this.columnName(expr);
      return {
        key: this.key(expr),
        span,
        ...(name !== undefined ? { name, nameAt: alias ? alias.start : expr.end - 1 } : {}),
        parts: { expr, ...(alias ? { alias } : {}) },
      };
    });
  }

  fromItems(body: Range): Item[] {
    const items: Item[] = [];
    const top = this.top(body);
    let k = 0;
    let join: Range = { start: body.start, end: body.start };
    while (k < top.length) {
      // Table expression: up to ON / USING / the next join or comma.
      const tableStart = top[k]!;
      while (
        k < top.length &&
        !isPunct(this.tokens[top[k]!], ',') &&
        !this.joinStart(top[k]!) &&
        this.w(top[k]!) !== 'ON' &&
        !(this.w(top[k]!) === 'USING' && isPunct(this.tokens[top[k]! + 1], '('))
      ) {
        k++;
      }
      const tableEnd = top[k] ?? body.end;
      let condition: Range | undefined;
      let children: Item[] | undefined;
      if (k < top.length && (this.w(top[k]!) === 'ON' || this.w(top[k]!) === 'USING')) {
        const isOn = this.w(top[k]!) === 'ON';
        const condStart = top[k]! + 1;
        k++;
        while (k < top.length && !isPunct(this.tokens[top[k]!], ',') && !this.joinStart(top[k]!))
          k++;
        condition = { start: condStart, end: top[k] ?? body.end };
        children = isOn ? this.predicates(condition) : [this.item(condition)];
      }
      const end = top[k] ?? body.end;
      const table: Range = { start: tableStart, end: tableEnd };
      const { expr, alias } = this.alias(table);
      const inner = this.unwrap(expr);
      const subquery =
        inner.start !== expr.start && ['SELECT', 'WITH', 'VALUES'].includes(this.w(inner.start));
      const aliasName = alias ? this.tokens[alias.start]!.text : undefined;
      items.push({
        key: subquery ? `(subquery) ${aliasName ?? ''}` : this.key(expr),
        // A JOIN item includes its join keywords; a comma-joined one doesn't include the comma.
        span: {
          start:
            join.end > join.start && !isPunct(this.tokens[join.start], ',')
              ? join.start
              : tableStart,
          end,
        },
        ...(aliasName !== undefined ? { name: aliasName, nameAt: alias!.start } : {}),
        parts: {
          join,
          table: expr,
          ...(alias ? { alias } : {}),
          ...(condition ? { condition } : {}),
        },
        ...(subquery ? { query: this.statement(inner, '') } : {}),
        ...(children ? { children } : {}),
      });
      if (k >= top.length) break;
      // Join operator: `,` or [NATURAL] [LEFT|RIGHT|FULL] [OUTER] [INNER|CROSS] JOIN.
      const opStart = top[k]!;
      let opEnd = opStart + 1;
      if (!isPunct(this.tokens[opStart], ',')) {
        while (
          opEnd < body.end &&
          JOIN_WORDS.has(this.w(opEnd - 1)) &&
          this.w(opEnd - 1) !== 'JOIN' &&
          this.w(opEnd - 1) !== 'STRAIGHT_JOIN'
        ) {
          opEnd++;
        }
      }
      join = { start: opStart, end: opEnd };
      while (k < top.length && top[k]! < opEnd) k++;
      if (k >= top.length) break;
    }
    return items;
  }

  joinStart(i: number): boolean {
    const w = this.w(i);
    if (!JOIN_WORDS.has(w)) return false;
    // A join operator always ends with JOIN / STRAIGHT_JOIN.
    for (let j = i; j < this.tokens.length && JOIN_WORDS.has(this.w(j)); j++) {
      if (this.w(j) === 'JOIN' || this.w(j) === 'STRAIGHT_JOIN') return true;
    }
    return false;
  }

  /** AND-ed predicates; each keyed by its text, named by its left operand. */
  predicates(body: Range): Item[] {
    if (body.end <= body.start) return [];
    return splitTopLevel(this.tokens, body, 'AND', this.parens)
      .filter((r) => r.end > r.start)
      .map((span) => {
        const subjectEnd = this.top(span).find((i) => {
          const t = this.tokens[i]!;
          return (
            (t.type === 'operator' && COMPARISON.has(t.text)) || COMPARISON_WORDS.has(this.w(i))
          );
        });
        const name =
          subjectEnd !== undefined && subjectEnd > span.start
            ? this.key({ start: span.start, end: subjectEnd })
            : undefined;
        return { key: this.key(span), span, ...(name ? { name } : {}), parts: {} };
      });
  }

  orderItems(body: Range): Item[] {
    return this.commaList(body).map((span) => {
      let end = span.end;
      while (end > span.start + 1 && ORDER_SUFFIX.has(this.w(end - 1))) end--;
      // USING operator (PostgreSQL)
      if (end - 2 > span.start && this.w(end - 2) === 'USING') end -= 2;
      const expr: Range = { start: span.start, end };
      const direction: Range = { start: end, end: span.end };
      return {
        key: this.key(expr),
        span,
        parts: { expr, direction },
        ...(this.columnName(expr) ? { name: this.columnName(expr)! } : {}),
      };
    });
  }

  assignments(body: Range): Item[] {
    return this.commaList(body).map((span) => {
      const eq = this.top(span).find((i) => isPunct(this.tokens[i], '='));
      const column: Range = { start: span.start, end: eq ?? span.end };
      const value: Range = { start: eq === undefined ? span.end : eq + 1, end: span.end };
      return {
        key: this.key(column),
        name: this.key(column),
        span,
        parts: { column, value },
      };
    });
  }

  rowsClause(name: string, span: Range, head: Range): Clause {
    const rows = this.commaList({ start: head.end, end: span.end }).map((row) => {
      let inner = row;
      if (this.w(inner.start) === 'ROW') inner = { start: inner.start + 1, end: inner.end };
      const values = isWrapped(inner, this.parens, this.tokens)
        ? this.commaList({ start: inner.start + 1, end: inner.end - 1 }).map((v) => this.item(v))
        : [this.item(inner)];
      return this.item(row, { children: values });
    });
    return { name, kind: 'rows', span, head, items: rows };
  }

  /** Target table: qualified name plus optional alias. */
  target(range: Range): Item | undefined {
    if (range.end <= range.start) return undefined;
    const { expr, alias } = this.alias(range);
    const name = this.key(expr);
    return {
      key: name,
      name,
      span: range,
      parts: { table: expr, ...(alias ? { alias } : {}) },
    };
  }

  // --- DML -------------------------------------------------------------------

  insert(range: Range, verb: string): QueryModel {
    let i = range.start + 1;
    while (DML_MODIFIERS.has(this.w(i))) i++;
    if (this.w(i) === 'INTO') i++;
    const head: Range = { start: range.start, end: i };
    const nameEnd = this.nameEnd(i, range.end);
    let j = nameEnd;
    // PostgreSQL `INSERT INTO t AS alias`
    if (this.w(j) === 'AS' && this.isName(j + 1)) j += 2;
    const target = this.target({ start: i, end: j });
    const clauses: Clause[] = [];
    if (isPunct(this.tokens[j], '(')) {
      const close = this.parens.get(j) ?? j;
      const inner: Range = { start: j + 1, end: close };
      if (!['SELECT', 'WITH', 'VALUES'].includes(this.w(inner.start))) {
        clauses.push({
          name: 'columns',
          kind: 'columns',
          span: { start: j, end: close + 1 },
          head: { start: j, end: j },
          items: this.commaList(inner).map((r) => this.item(r, { name: this.key(r) })),
        });
        j = close + 1;
      }
    }
    const rest = this.clauses({ start: j, end: range.end }, (k) => {
      const w = this.w(k);
      if (k === j && w !== 'ON' && w !== 'RETURNING') {
        if (w === 'VALUES' || w === 'VALUE') return { name: 'VALUES', head: 1 };
        if (w === 'SET') return { name: 'SET', head: 1 };
        if (w === 'DEFAULT') return { name: 'DEFAULT VALUES', head: 2 };
        return { name: 'SELECT', head: 0 };
      }
      if (w === 'ON' && this.w(k + 1) === 'CONFLICT') {
        const doAt = this.top({ start: k, end: range.end }).find((x) => this.w(x) === 'DO');
        const set =
          doAt !== undefined && this.w(doAt + 1) === 'UPDATE' && this.w(doAt + 2) === 'SET';
        return { name: 'ON CONFLICT', head: (set ? doAt + 3 : (doAt ?? k) + 2) - k };
      }
      if (w === 'ON' && this.w(k + 1) === 'DUPLICATE')
        return { name: 'ON DUPLICATE KEY UPDATE', head: 4 };
      if (w === 'RETURNING') return { name: 'RETURNING', head: 1 };
      return null;
    });
    for (const c of rest.found) {
      if (c.name === 'VALUES') clauses.push(this.rowsClause('VALUES', c.span, c.head));
      else if (c.name === 'SELECT') {
        clauses.push({
          name: 'SELECT',
          kind: 'query',
          span: c.span,
          head: c.head,
          items: [],
          query: this.statement(c.body, ''),
        });
      } else if (
        c.name === 'ON CONFLICT' ||
        c.name === 'ON DUPLICATE KEY UPDATE' ||
        c.name === 'SET'
      ) {
        clauses.push({
          name: c.name,
          kind: 'assignments',
          span: c.span,
          head: c.head,
          items: this.assignments(c.body),
        });
      } else clauses.push(this.clause(c.name, c.span, c.head, c.body));
    }
    return { kind: verb, span: range, head, ...(target ? { target } : {}), clauses };
  }

  update(range: Range): QueryModel {
    let i = range.start + 1;
    while (DML_MODIFIERS.has(this.w(i))) i++;
    if (this.w(i) === 'ONLY') i++;
    const head: Range = { start: range.start, end: i };
    const { preamble, found } = this.clauses({ start: i, end: range.end }, (k) => {
      const w = this.w(k);
      if (w === 'SET' || w === 'FROM' || w === 'WHERE' || w === 'LIMIT' || w === 'RETURNING')
        return { name: w, head: 1 };
      if (w === 'ORDER' && this.w(k + 1) === 'BY') return { name: 'ORDER BY', head: 2 };
      return null;
    });
    return this.dml('UPDATE', range, head, preamble, found);
  }

  delete(range: Range): QueryModel {
    let i = range.start + 1;
    while (DML_MODIFIERS.has(this.w(i))) i++;
    const multiTable = this.w(i) !== 'FROM';
    if (!multiTable) i++;
    if (this.w(i) === 'ONLY') i++;
    const head: Range = { start: range.start, end: i };
    const { preamble, found } = this.clauses({ start: i, end: range.end }, (k) => {
      const w = this.w(k);
      if (w === 'USING' || w === 'WHERE' || w === 'LIMIT' || w === 'RETURNING')
        return { name: w, head: 1 };
      if (w === 'FROM' && multiTable) return { name: 'FROM', head: 1 };
      if (w === 'ORDER' && this.w(k + 1) === 'BY') return { name: 'ORDER BY', head: 2 };
      return null;
    });
    return this.dml('DELETE', range, head, preamble, found);
  }

  dml(
    kind: string,
    range: Range,
    head: Range,
    preamble: Range,
    found: Array<{ name: string; span: Range; head: Range; body: Range }>,
  ): QueryModel {
    const clauses: Clause[] = [];
    // Multi-table form (MySQL `UPDATE a JOIN b ON … SET`): the target is a FROM list.
    const tables = this.fromItems(preamble);
    let target: Item | undefined;
    if (tables.length > 1) {
      clauses.push({
        name: 'tables',
        kind: 'from',
        span: preamble,
        head: { start: preamble.start, end: preamble.start },
        items: tables,
      });
      const first = tables[0]!;
      target = { ...first, name: this.key(first.parts.table!) };
    } else {
      target = this.target(preamble);
    }
    for (const c of found) clauses.push(this.clause(c.name, c.span, c.head, c.body));
    return { kind, span: range, head, ...(target ? { target } : {}), clauses };
  }

  // --- DDL -------------------------------------------------------------------

  /** Head up to and including `object` (+ IF [NOT] EXISTS), then the object name. */
  ddlHead(range: Range, object: string): { head: Range; target?: Item; next: number } {
    let i = range.start;
    while (i < range.end && this.w(i) !== object) i++;
    i++;
    if (this.w(i) === 'IF') i += this.w(i + 1) === 'NOT' ? 3 : 2;
    if (this.w(i) === 'ONLY') i++;
    const head: Range = { start: range.start, end: i };
    const end = this.nameEnd(i, range.end);
    const target = end > i ? this.target({ start: i, end }) : undefined;
    return { head, ...(target ? { target } : {}), next: end };
  }

  createTable(range: Range): QueryModel {
    const { head, target, next } = this.ddlHead(range, 'TABLE');
    const clauses: Clause[] = [];
    let i = next;
    if (isPunct(this.tokens[i], '(')) {
      const close = this.parens.get(i) ?? i;
      clauses.push({
        name: 'columns',
        kind: 'definitions',
        span: { start: i, end: close + 1 },
        head: { start: i, end: i },
        items: this.commaList({ start: i + 1, end: close }).map((r) => this.definition(r)),
      });
      i = close + 1;
    }
    this.ddlTail({ start: i, end: range.end }, clauses);
    return { kind: 'CREATE TABLE', span: range, head, ...(target ? { target } : {}), clauses };
  }

  /** `AS query` and trailing options of CREATE TABLE / VIEW. */
  ddlTail(range: Range, clauses: Clause[]) {
    let i = range.start;
    const asAt = this.top(range).find((k) => this.w(k) === 'AS');
    if (asAt !== undefined) {
      if (asAt > i) clauses.push(this.optionsClause({ start: i, end: asAt }));
      // `WITH [CASCADED | LOCAL] CHECK OPTION` / `WITH [NO] DATA` after the query.
      const tailAt = this.top({ start: asAt + 1, end: range.end }).find(
        (k) =>
          this.w(k) === 'WITH' &&
          ['CHECK', 'CASCADED', 'LOCAL', 'DATA', 'NO'].includes(this.w(k + 1)),
      );
      const queryEnd = tailAt ?? range.end;
      clauses.push({
        name: 'AS',
        kind: 'query',
        span: { start: asAt, end: queryEnd },
        head: { start: asAt, end: asAt + 1 },
        items: [],
        query: this.statement({ start: asAt + 1, end: queryEnd }, ''),
      });
      i = queryEnd;
    }
    if (i < range.end) clauses.push(this.optionsClause({ start: i, end: range.end }));
  }

  optionsClause(range: Range): Clause {
    return {
      name: 'options',
      kind: 'value',
      span: range,
      head: { start: range.start, end: range.start },
      items: [this.item(range)],
    };
  }

  definition(span: Range): Item {
    const first = this.w(span.start);
    if (TABLE_CONSTRAINT.has(first)) {
      const named = first === 'CONSTRAINT' && this.isName(span.start + 1);
      const name = named ? this.tokens[span.start + 1]!.text : undefined;
      return {
        key: named ? `CONSTRAINT ${name}` : this.key(span),
        span,
        ...(name ? { name, nameAt: span.start + 1 } : {}),
        parts: {},
        role: 'constraint',
      };
    }
    // Column: name type [constraints…]
    const nameTok = this.tokens[span.start]!;
    const top = this.top({ start: span.start + 1, end: span.end });
    const typeEnd = top.find((i) => COLUMN_CONSTRAINT.has(this.w(i))) ?? span.end;
    const type: Range = { start: span.start + 1, end: typeEnd };
    return {
      key: `column ${nameTok.text}`,
      name: nameTok.text,
      nameAt: span.start,
      span,
      parts: { column: { start: span.start, end: span.start + 1 }, type },
      children: this.columnConstraints({ start: typeEnd, end: span.end }),
      role: 'column',
    };
  }

  /** Split column constraints: NOT NULL, DEFAULT x, PRIMARY KEY, REFERENCES t (id) ON DELETE …, … */
  columnConstraints(range: Range): Item[] {
    const starts: number[] = [];
    let current = '';
    for (const i of this.top(range)) {
      const w = this.w(i);
      if (!COLUMN_CONSTRAINT.has(w)) continue;
      const prev = this.w(i - 1);
      if (w === 'NULL' && (prev === 'NOT' || current === 'DEFAULT')) continue;
      // The value right after DEFAULT (`DEFAULT NULL`, `DEFAULT CHARACTER …`) belongs to it.
      if (current === 'DEFAULT' && starts[starts.length - 1] === i - 1) continue;
      // Foreign key actions: REFERENCES t (id) ON DELETE SET NULL / SET DEFAULT.
      if (w === 'ON' && current === 'REFERENCES') continue;
      if ((w === 'NULL' || w === 'DEFAULT') && prev === 'SET') continue;
      if (current === 'CONSTRAINT' && starts[starts.length - 1] === i - 2) continue;
      if (current === 'GENERATED' && w === 'AS') continue;
      starts.push(i);
      current = w;
    }
    return starts.map((s, k) => {
      const span: Range = { start: s, end: starts[k + 1] ?? range.end };
      return this.item(span, { name: this.constraintKey(span) });
    });
  }

  /** What a column constraint sets, so that e.g. `DEFAULT 0` and `DEFAULT 1` match. */
  constraintKey(span: Range): string {
    const w = this.w(span.start);
    if (w === 'NOT' || w === 'NULL') return 'nullability';
    if (w === 'CONSTRAINT') return `CONSTRAINT ${this.tokens[span.start + 1]?.text ?? ''}`;
    if (w === 'CHECK') return this.key(span);
    if (w === 'AS') return 'GENERATED';
    if (w === 'CHARACTER' || w === 'CHARSET') return 'CHARACTER SET';
    if (w === 'ON') return `ON ${this.w(span.start + 1)}`;
    if (w === 'PRIMARY') return 'PRIMARY KEY';
    if (w === 'AUTOINCREMENT') return 'AUTO_INCREMENT';
    return w;
  }

  createView(range: Range): QueryModel {
    const { head, target, next } = this.ddlHead(range, 'VIEW');
    const clauses: Clause[] = [];
    let i = next;
    if (isPunct(this.tokens[i], '(')) {
      const close = this.parens.get(i) ?? i;
      clauses.push({
        name: 'columns',
        kind: 'columns',
        span: { start: i, end: close + 1 },
        head: { start: i, end: i },
        items: this.commaList({ start: i + 1, end: close }).map((r) =>
          this.item(r, { name: this.key(r) }),
        ),
      });
      i = close + 1;
    }
    this.ddlTail({ start: i, end: range.end }, clauses);
    return { kind: 'CREATE VIEW', span: range, head, ...(target ? { target } : {}), clauses };
  }

  createIndex(range: Range): QueryModel {
    // CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] [name] ON [ONLY] table [USING m] (cols) [INCLUDE (…)] [WHERE …]
    let i = range.start;
    while (i < range.end && this.w(i) !== 'INDEX') i++;
    i++;
    if (this.w(i) === 'CONCURRENTLY') i++;
    if (this.w(i) === 'IF') i += 3;
    const head: Range = { start: range.start, end: i };
    const onAt = this.top({ start: i, end: range.end }).find((k) => this.w(k) === 'ON');
    const nameRange: Range = { start: i, end: onAt ?? i };
    const target = this.target(nameRange);
    const clauses: Clause[] = [];
    if (onAt !== undefined) {
      let j = onAt + 1;
      if (this.w(j) === 'ONLY') j++;
      const tableEnd = this.nameEnd(j, range.end);
      clauses.push({
        name: 'ON',
        kind: 'value',
        span: { start: onAt, end: tableEnd },
        head: { start: onAt, end: j },
        items: [this.item({ start: j, end: tableEnd })],
      });
      j = tableEnd;
      if (this.w(j) === 'USING') {
        clauses.push({
          name: 'USING',
          kind: 'value',
          span: { start: j, end: j + 2 },
          head: { start: j, end: j + 1 },
          items: [this.item({ start: j + 1, end: j + 2 })],
        });
        j += 2;
      }
      if (isPunct(this.tokens[j], '(')) {
        const close = this.parens.get(j) ?? j;
        clauses.push({
          name: 'columns',
          kind: 'order-by',
          span: { start: j, end: close + 1 },
          head: { start: j, end: j },
          items: this.orderItems({ start: j + 1, end: close }),
        });
        j = close + 1;
      }
      const whereAt = this.top({ start: j, end: range.end }).find((k) => this.w(k) === 'WHERE');
      if (whereAt !== undefined) {
        if (whereAt > j) clauses.push(this.optionsClause({ start: j, end: whereAt }));
        clauses.push({
          name: 'WHERE',
          kind: 'predicates',
          span: { start: whereAt, end: range.end },
          head: { start: whereAt, end: whereAt + 1 },
          items: this.predicates({ start: whereAt + 1, end: range.end }),
        });
      } else if (j < range.end) clauses.push(this.optionsClause({ start: j, end: range.end }));
    }
    return { kind: 'CREATE INDEX', span: range, head, ...(target ? { target } : {}), clauses };
  }

  alterTable(range: Range): QueryModel {
    const { head, target, next } = this.ddlHead(range, 'TABLE');
    const actions = this.commaList({ start: next, end: range.end }).map((span) => {
      const words: string[] = [];
      let i = span.start;
      const verb = this.w(i);
      words.push(verb);
      i++;
      if (this.w(i) === 'IF') i += this.w(i + 1) === 'NOT' ? 3 : 2;
      let object = ALTER_OBJECTS.has(this.w(i)) ? this.w(i) : '';
      if (object) i++;
      if (object === 'PRIMARY' || object === 'FOREIGN') {
        object += ' KEY';
        if (this.w(i) === 'KEY') i++;
      }
      if (object === 'COLUMN' || object === '') {
        if (this.w(i) === 'IF') i += this.w(i + 1) === 'NOT' ? 3 : 2;
      }
      if (!object && ['ADD', 'DROP', 'ALTER', 'MODIFY', 'CHANGE'].includes(verb)) object = 'COLUMN';
      if (object) words.push(object);
      const named = this.isName(i) && !(verb === 'RENAME' && this.w(i) === 'TO');
      const name = named && object !== 'PRIMARY KEY' ? this.tokens[i]!.text : undefined;
      if (name) words.push(name);
      else if (verb === 'RENAME' || !object) words.push(this.w(i));
      return {
        key: words.filter(Boolean).join(' '),
        ...(name ? { name, nameAt: i } : {}),
        span,
        parts: {},
      };
    });
    const clauses: Clause[] = [
      {
        name: 'actions',
        kind: 'actions',
        span: { start: next, end: range.end },
        head: { start: next, end: next },
        items: actions,
      },
    ];
    return { kind: 'ALTER TABLE', span: range, head, ...(target ? { target } : {}), clauses };
  }
}
