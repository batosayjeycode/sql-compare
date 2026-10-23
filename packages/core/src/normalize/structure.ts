import type { NormToken } from './types.js';

/**
 * Lightweight structure over a statement's significant tokens: parentheses,
 * clause boundaries, and top-level splitting of boolean expressions. Rules use
 * it to propose rewrites; the dialect parser verifies every one of them.
 */

export const word = (t: NormToken | undefined): string =>
  t && t.type === 'word' ? t.text.toUpperCase() : '';

export const isPunct = (t: NormToken | undefined, text: string) =>
  t !== undefined && (t.type === 'punctuation' || t.type === 'operator') && t.text === text;

/** For each `(`, the index of its matching `)` (and vice versa). Null if unbalanced. */
export function matchParens(tokens: NormToken[]): Map<number, number> | null {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((t, i) => {
    if (isPunct(t, '(')) stack.push(i);
    else if (isPunct(t, ')')) {
      const open = stack.pop();
      if (open === undefined) return;
      pairs.set(open, i);
      pairs.set(i, open);
    }
  });
  return stack.length === 0 ? pairs : null;
}

/** Keywords that end an expression, list or clause at the same nesting level. */
export const CLAUSE_END: ReadonlySet<string> = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP',
  'HAVING',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'FETCH',
  'FOR',
  'WINDOW',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'RETURNING',
  'ON',
  'USING',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'CROSS',
  'NATURAL',
  'STRAIGHT_JOIN',
  'SET',
  'VALUES',
  'INTO',
  'QUALIFY',
  'LOCK',
]);

/**
 * End (exclusive) of the clause body starting at `from`: the next clause
 * keyword at the same depth, the `)` closing the enclosing group, `;`, or the end.
 */
export function clauseEnd(
  tokens: NormToken[],
  from: number,
  parens: Map<number, number>,
  extraEnds: ReadonlySet<string> = new Set(),
): number {
  let i = from;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (isPunct(t, '(')) {
      i = (parens.get(i) ?? i) + 1;
      continue;
    }
    if (isPunct(t, ')') || isPunct(t, ';')) return i;
    const w = word(t);
    if (w === 'CASE') {
      i = caseEnd(tokens, i) + 1;
      continue;
    }
    // `IS [NOT] DISTINCT FROM` is an operator, not a FROM clause.
    if (w === 'FROM' && word(tokens[i - 1]) === 'DISTINCT') {
      i++;
      continue;
    }
    if (i > from && (CLAUSE_END.has(w) || extraEnds.has(w))) return i;
    i++;
  }
  return i;
}

/** Index of the END matching the CASE at `i` (or the last token if unterminated). */
export function caseEnd(tokens: NormToken[], i: number): number {
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    const w = word(tokens[j]);
    if (w === 'CASE') depth++;
    else if (w === 'END' && --depth === 0) return j;
  }
  return tokens.length - 1;
}

export interface Range {
  start: number;
  end: number;
}

/**
 * Split [start, end) on a top-level separator: `AND`, `OR` or `,`. Skips
 * parentheses and CASE…END, and for AND the one belonging to BETWEEN.
 * Returns operand ranges (one range when there is no top-level separator).
 */
export function splitTopLevel(
  tokens: NormToken[],
  range: Range,
  separator: 'AND' | 'OR' | ',',
  parens: Map<number, number>,
): Range[] {
  const parts: Range[] = [];
  let partStart = range.start;
  let pendingBetween = 0;
  for (let i = range.start; i < range.end; i++) {
    const t = tokens[i]!;
    if (isPunct(t, '(')) {
      i = parens.get(i) ?? i;
      continue;
    }
    const w = word(t);
    if (w === 'CASE') {
      i = caseEnd(tokens, i);
      continue;
    }
    if (w === 'BETWEEN') pendingBetween++;
    const isSeparator = separator === ',' ? isPunct(t, ',') : w === separator;
    if (!isSeparator) continue;
    if (separator === 'AND' && pendingBetween > 0) {
      pendingBetween--;
      continue;
    }
    parts.push({ start: partStart, end: i });
    partStart = i + 1;
  }
  parts.push({ start: partStart, end: range.end });
  return parts;
}

/** True if [start, end) is exactly one parenthesized group. */
export function isWrapped(range: Range, parens: Map<number, number>, tokens: NormToken[]) {
  return (
    range.end - range.start >= 2 &&
    isPunct(tokens[range.start], '(') &&
    parens.get(range.start) === range.end - 1
  );
}

/** A parenthesized group that holds a subquery or a row/tuple rather than an expression. */
export function isSubqueryOrTuple(
  tokens: NormToken[],
  inner: Range,
  parens: Map<number, number>,
): boolean {
  const first = word(tokens[inner.start]);
  if (first === 'SELECT' || first === 'WITH' || first === 'VALUES' || first === 'TABLE')
    return true;
  return splitTopLevel(tokens, inner, ',', parens).length > 1;
}

/**
 * Pure, deterministic operand: no function calls and no subqueries. Reordering
 * operands that call functions could change errors or side effects
 * (short-circuit evaluation), so those are never sorted.
 */
export function isPure(tokens: NormToken[], range: Range): boolean {
  for (let i = range.start; i < range.end; i++) {
    const t = tokens[i]!;
    const w = word(t);
    if (w === 'SELECT' || w === 'EXISTS') return false;
    if (t.type === 'variable' && t.text.startsWith('@')) return false;
    const next = tokens[i + 1];
    const calls = (t.type === 'word' || t.type === 'quoted-identifier') && isPunct(next, '(');
    if (calls && w !== 'IN') return false;
  }
  return true;
}

/** Canonical sort key of a token range. */
export function rangeKey(tokens: NormToken[], range: Range): string {
  return tokens
    .slice(range.start, range.end)
    .map((t) => (t.type === 'word' ? t.text.toUpperCase() : t.text))
    .join(' ');
}

/** Ranges of WHERE / HAVING / join ON conditions, at every nesting level. */
export function conditionRanges(tokens: NormToken[], parens: Map<number, number>): Range[] {
  const ranges: Range[] = [];
  tokens.forEach((t, i) => {
    const w = word(t);
    if (w !== 'WHERE' && w !== 'HAVING' && w !== 'ON') return;
    if (w === 'ON' && !isJoinOn(tokens, i, parens)) return;
    // WHERE CURRENT OF cursor
    if (w === 'WHERE' && word(tokens[i + 1]) === 'CURRENT') return;
    const end = clauseEnd(tokens, i + 1, parens);
    if (end > i + 1) ranges.push({ start: i + 1, end });
  });
  return ranges;
}

/** ON that introduces a join condition (not ON CONFLICT, ON DELETE, GRANT … ON, …). */
function isJoinOn(tokens: NormToken[], i: number, parens: Map<number, number>): boolean {
  const next = word(tokens[i + 1]);
  if (next === 'CONFLICT' || next === 'DUPLICATE' || next === 'DELETE' || next === 'UPDATE') {
    return false;
  }
  // Walk back at the same depth to the previous JOIN or clause keyword.
  for (let j = i - 1; j >= 0; j--) {
    const t = tokens[j]!;
    if (isPunct(t, ')')) {
      j = parens.get(j) ?? j;
      continue;
    }
    if (isPunct(t, '(')) return false;
    const w = word(t);
    if (w === 'JOIN') return true;
    if (w === 'ON' || w === 'FROM' || w === 'SELECT' || w === 'WHERE' || w === 'GRANT') {
      return false;
    }
  }
  return false;
}

/** Replace [range.start, range.end) with `replacement`. */
export function splice(tokens: NormToken[], range: Range, replacement: NormToken[]) {
  return [...tokens.slice(0, range.start), ...replacement, ...tokens.slice(range.end)];
}
