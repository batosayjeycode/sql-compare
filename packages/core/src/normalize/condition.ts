import {
  isSubqueryOrTuple,
  isWrapped,
  matchParens,
  splitTopLevel,
  word,
  type Range,
} from './structure.js';
import type { NormToken } from './types.js';

/**
 * Rewrites a boolean condition (WHERE / HAVING / ON) bottom-up:
 * - `wrapped(inner, context)` decides what to do with a fully parenthesized
 *   expression (keep or unwrap); default keeps it.
 * - `chain(operands, op)` may reorder the operands of an AND / OR chain.
 * - `atom(tokens)` may rewrite a leaf (e.g. `a = b`).
 * Parenthesized groups inside a leaf (not function calls) are visited too.
 */
export interface ConditionVisitor {
  wrapped?(inner: NormToken[], context: Context): 'keep' | 'unwrap';
  chain?(operands: NormToken[][], op: 'AND' | 'OR'): NormToken[][];
  atom?(tokens: NormToken[]): NormToken[];
}

/** Where an expression sits: a whole condition, or an operand of AND / OR. */
export type Context = 'top' | 'AND' | 'OR';

export function rewriteCondition(
  tokens: NormToken[],
  visitor: ConditionVisitor,
  context: Context = 'top',
): NormToken[] {
  const parens = matchParens(tokens);
  if (!parens || tokens.length === 0) return tokens;
  const whole: Range = { start: 0, end: tokens.length };

  if (isWrapped(whole, parens, tokens)) {
    const inner = tokens.slice(1, -1);
    const innerRange = { start: 1, end: tokens.length - 1 };
    if (isSubqueryOrTuple(tokens, innerRange, parens)) return tokens;
    if (visitor.wrapped?.(inner, context) === 'unwrap') {
      return rewriteCondition(inner, visitor, context);
    }
    return [tokens[0]!, ...rewriteCondition(inner, visitor, 'top'), tokens[tokens.length - 1]!];
  }

  for (const op of ['OR', 'AND'] as const) {
    const parts = splitTopLevel(tokens, whole, op, parens);
    if (parts.length < 2) continue;
    let operands = parts.map((p) => rewriteCondition(tokens.slice(p.start, p.end), visitor, op));
    if (visitor.chain) operands = visitor.chain(operands, op);
    // Separators stay where they were; only the operands between them move.
    const separators = parts.slice(0, -1).map((p) => tokens[p.end]!);
    return operands.flatMap((o, i) => (i < separators.length ? [...o, separators[i]!] : o));
  }

  const leaf = visitor.atom ? visitor.atom(tokens) : tokens;
  return rewriteGroups(leaf, visitor);
}

/** Visit parenthesized sub-expressions inside a leaf, e.g. `NOT (a OR b)`. */
function rewriteGroups(tokens: NormToken[], visitor: ConditionVisitor): NormToken[] {
  const parens = matchParens(tokens);
  if (!parens) return tokens;
  const out: NormToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const close = parens.get(i);
    const prev = tokens[i - 1];
    const isCall =
      prev !== undefined && (prev.type === 'word' || prev.type === 'quoted-identifier');
    const opensGroup = t.text === '(' && close !== undefined && close > i;
    if (!opensGroup || (isCall && word(prev) !== 'NOT')) {
      out.push(t);
      continue;
    }
    const innerRange = { start: i + 1, end: close };
    if (isSubqueryOrTuple(tokens, innerRange, parens)) {
      out.push(...tokens.slice(i, close + 1));
    } else {
      out.push(t, ...rewriteCondition(tokens.slice(i + 1, close), visitor, 'top'), tokens[close]!);
    }
    i = close;
  }
  return out;
}
