import { hasSqlDetails, loadModule, parseSync } from 'libpg-query';
import { opaqueReason, sortByJson, type CanonicalMode, type ParserAdapter } from '../parse.js';

/**
 * PostgreSQL adapter: libpg-query, the real PostgreSQL 18 parser compiled to
 * WebAssembly. Chosen over node-sql-parser and pgsql-ast-parser in M3 (see
 * docs/parser-evaluation.md).
 */

/** libpg-query reports error positions in characters (code points), not UTF-16 units. */
export function codePointToUtf16(text: string, codePoints: number): number {
  let i = 0;
  for (let n = 0; n < codePoints && i < text.length; n++) {
    const c = text.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < text.length ? 2 : 1;
  }
  return i;
}

export async function createPostgresParser(): Promise<ParserAdapter> {
  await loadModule();
  return {
    name: 'libpg-query (PostgreSQL 18)',
    dialect: 'postgresql',
    parse(statement) {
      const opaque = opaqueReason(statement);
      if (opaque) return { status: 'unsupported', reason: opaque };
      try {
        return { status: 'parsed', ast: parseSync(statement.text) };
      } catch (err) {
        if (hasSqlDetails(err)) {
          const position = err.sqlDetails?.cursorPosition ?? 0;
          return {
            status: 'error',
            message: err.message,
            offset: codePointToUtf16(statement.text, Math.max(0, position)),
          };
        }
        return {
          status: 'error',
          message: err instanceof Error ? err.message : 'The parser failed on this statement.',
          offset: 0,
        };
      }
    },
    canonical: (ast, mode) => JSON.stringify(pgCanonical(ast as Json, mode)),
  };
}

const PG_POSITIONS = new Set([
  'location',
  'stmt_location',
  'stmt_len',
  'rexpr_list_start',
  'rexpr_list_end',
]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const isObj = (v: Json | undefined): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** No function calls or subqueries (they may be volatile or raise errors). */
const pgPure = (node: Json) => !/"(FuncCall|SubLink)"/.test(JSON.stringify(node));

function pgSortIf(items: Json[], ok: boolean): Json[] {
  return ok ? sortByJson(items) : items;
}

/** Canonical libpg-query AST (see CanonicalMode). PostgreSQL already folds identifier case. */
export function pgCanonical(node: Json, mode: CanonicalMode): Json {
  if (Array.isArray(node)) return node.map((n) => pgCanonical(n, mode));
  if (!isObj(node)) return node;
  const out: Obj = {};
  for (const [key, value] of Object.entries(node)) {
    if (!PG_POSITIONS.has(key)) out[key] = pgCanonical(value, mode);
  }

  const bool = out.BoolExpr;
  if (isObj(bool) && Array.isArray(bool.args)) {
    // a AND (b AND c) ≡ a AND b AND c
    const args = bool.args.flatMap((a) =>
      isObj(a) &&
      isObj(a.BoolExpr) &&
      a.BoolExpr.boolop === bool.boolop &&
      bool.boolop !== 'NOT_EXPR'
        ? (a.BoolExpr.args as Json[])
        : [a],
    );
    const sortable = mode.commutative && bool.boolop !== 'NOT_EXPR' && args.every(pgPure);
    out.BoolExpr = { ...bool, args: pgSortIf(args, sortable) };
  }

  const expr = out.A_Expr;
  if (isObj(expr) && mode.commutative) {
    const op = JSON.stringify(expr.name);
    if (
      expr.kind === 'AEXPR_OP' &&
      op === '[{"String":{"sval":"="}}]' &&
      pgPure(expr.lexpr ?? null) &&
      pgPure(expr.rexpr ?? null)
    ) {
      const [l, r] = sortByJson([expr.lexpr ?? null, expr.rexpr ?? null]);
      out.A_Expr = { ...expr, lexpr: l ?? null, rexpr: r ?? null };
    }
    const list = isObj(expr.rexpr) && isObj(expr.rexpr.List) ? expr.rexpr.List : null;
    if (expr.kind === 'AEXPR_IN' && list && Array.isArray(list.items)) {
      const literals = list.items.every((i) => isObj(i) && 'A_Const' in i);
      out.A_Expr = { ...expr, rexpr: { List: { ...list, items: pgSortIf(list.items, literals) } } };
    }
  }

  const select = out.SelectStmt;
  if (isObj(select) && mode.commutative) {
    const next: Obj = { ...select };
    if (Array.isArray(select.groupClause)) {
      const plain = !/"GroupingSet"/.test(JSON.stringify(select.groupClause));
      next.groupClause = pgSortIf(select.groupClause, plain && select.groupClause.every(pgPure));
    }
    if (Array.isArray(select.fromClause)) {
      const tablesOnly = select.fromClause.every((f) => isObj(f) && 'RangeVar' in f);
      const star = /"A_Star"/.test(JSON.stringify(select.targetList ?? null));
      next.fromClause = pgSortIf(select.fromClause, tablesOnly && !star);
    }
    out.SelectStmt = next;
  }

  if (Array.isArray(out.partitionClause) && mode.commutative) {
    out.partitionClause = pgSortIf(out.partitionClause, out.partitionClause.every(pgPure));
  }
  return out;
}
