import * as mysqlBuild from 'node-sql-parser/build/mysql.js';
import { opaqueReason, sortByJson, type CanonicalMode, type ParserAdapter } from '../parse.js';

/** MySQL / MariaDB adapter: node-sql-parser (MySQL grammar). */

type ParserCtor = typeof mysqlBuild.Parser;

/**
 * Statement kinds node-sql-parser's MySQL grammar handles. When one of these
 * fails to parse it's reported as an error; any other kind (SET NAMES, GRANT,
 * HANDLER, …) is treated as unsupported and compared as text.
 */
const SUPPORTED_KINDS = new Set([
  'SELECT',
  'WITH',
  'INSERT',
  'REPLACE',
  'UPDATE',
  'DELETE',
  'CREATE TABLE',
  'CREATE VIEW',
  'CREATE INDEX',
  'CREATE DATABASE',
  'CREATE SCHEMA',
  'ALTER TABLE',
  'DROP TABLE',
  'DROP VIEW',
  'DROP INDEX',
  'DROP DATABASE',
  'DROP SCHEMA',
  'TRUNCATE',
  'RENAME',
  'USE',
  '(',
]);

interface PegError {
  message: string;
  location?: { start: { offset: number } };
}

function isPegError(err: unknown): err is PegError {
  return typeof err === 'object' && err !== null && 'location' in err;
}

export function createMysqlParser(): ParserAdapter {
  // The build is CommonJS; depending on the loader, exports sit on `default`.
  const mod = mysqlBuild as unknown as { Parser?: ParserCtor; default?: { Parser: ParserCtor } };
  const Parser = mod.Parser ?? mod.default?.Parser;
  if (!Parser) throw new Error('node-sql-parser: MySQL build has no Parser export');
  const parser = new Parser();

  return {
    name: 'node-sql-parser (MySQL)',
    dialect: 'mysql',
    parse(statement) {
      const opaque = opaqueReason(statement);
      if (opaque) return { status: 'unsupported', reason: opaque };
      try {
        const ast = parser.astify(statement.text, {
          database: 'mysql',
          parseOptions: { includeLocations: true },
        });
        return { status: 'parsed', ast };
      } catch (err) {
        if (!SUPPORTED_KINDS.has(statement.kind)) {
          return {
            status: 'unsupported',
            reason: `${statement.kind || 'This statement'} isn't supported by the MySQL parser; compared as text.`,
          };
        }
        if (isPegError(err)) {
          // The grammar often stops on the whitespace before the offending token.
          let offset = err.location?.start.offset ?? 0;
          while (offset < statement.text.length && /\s/.test(statement.text[offset]!)) offset++;
          const near = /^[\w$]+|^\S/.exec(statement.text.slice(offset))?.[0];
          return {
            status: 'error',
            message: near ? `Syntax not recognized near "${near}"` : 'Unexpected end of statement',
            offset,
          };
        }
        return {
          status: 'error',
          message: err instanceof Error ? err.message : 'The parser failed on this statement.',
          offset: 0,
        };
      }
    },
    canonical: (ast, mode) => JSON.stringify(myCanonical(ast as Json, mode)),
  };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const isObj = (v: Json | undefined): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const lower = (v: Json | undefined): Json =>
  typeof v === 'string' ? v.toLowerCase() : (v ?? null);

/** No function calls or subqueries. */
const myPure = (node: Json) =>
  !/"type":"(function|aggr_func|select)"|"ast":/.test(JSON.stringify(node));

const LITERAL_TYPES = new Set([
  'number',
  'string',
  'single_quote_string',
  'double_quote_string',
  'bool',
  'null',
]);

/** Flatten `a AND (b AND c)` (nested binary_expr) into one operand list. */
function chain(node: Json, op: string): Json[] {
  if (isObj(node) && node.type === 'binary_expr' && node.operator === op) {
    return [...chain(node.left ?? null, op), ...chain(node.right ?? null, op)];
  }
  return [node];
}

/** Canonical node-sql-parser AST (see CanonicalMode). */
export function myCanonical(node: Json, mode: CanonicalMode): Json {
  if (Array.isArray(node)) return node.map((n) => myCanonical(n, mode));
  if (!isObj(node)) return node;
  // `Ab` (quoted) and Ab are the same identifier.
  if (node.type === 'backticks_quote_string' && typeof node.value === 'string') return node.value;

  if (node.type === 'binary_expr' && (node.operator === 'AND' || node.operator === 'OR')) {
    const args = chain(node, node.operator).map((n) => myCanonical(n, mode));
    const sorted = mode.commutative && args.every(myPure) ? sortByJson(args) : args;
    return { type: 'bool_chain', operator: node.operator, args: sorted };
  }

  const out: Obj = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'loc' && key !== 'parentheses') out[key] = myCanonical(value, mode);
  }

  if (out.type === 'binary_expr') {
    if (out.operator === '!=') out.operator = '<>';
    if (
      mode.commutative &&
      out.operator === '=' &&
      myPure(out.left ?? null) &&
      myPure(out.right ?? null)
    ) {
      const [l, r] = sortByJson([out.left ?? null, out.right ?? null]);
      out.left = l ?? null;
      out.right = r ?? null;
    }
    const list = out.right;
    if (mode.commutative && out.operator === 'IN' && isObj(list) && Array.isArray(list.value)) {
      const literals = list.value.every((v) => isObj(v) && LITERAL_TYPES.has(String(v.type)));
      if (literals) out.right = { ...list, value: sortByJson(list.value) };
    }
  }

  if (mode.caseInsensitiveColumns) {
    if (out.type === 'column_ref') {
      const col = out.column;
      out.column =
        isObj(col) && isObj(col.expr)
          ? { expr: { ...col.expr, value: lower(col.expr.value) } }
          : lower(col);
    }
    if ((out.type === 'aggr_func' || out.type === 'function') && out.name !== undefined) {
      out.name = JSON.parse(JSON.stringify(out.name).toLowerCase()) as Json;
    }
    if (out.type === 'select' && Array.isArray(out.columns)) {
      out.columns = out.columns.map((c) => (isObj(c) ? { ...c, as: lower(c.as) } : c));
    }
  }
  if (mode.caseInsensitiveTables) {
    if (out.type === 'column_ref' && out.table !== undefined) out.table = lower(out.table);
    if (out.type === 'select' && Array.isArray(out.from)) {
      out.from = out.from.map((f) =>
        isObj(f) ? { ...f, table: lower(f.table), as: lower(f.as), db: lower(f.db) } : f,
      );
    }
  }

  if (mode.commutative && out.type === 'select') {
    const group = out.groupby;
    if (isObj(group) && Array.isArray(group.columns)) {
      const plain = !(Array.isArray(group.modifiers) && group.modifiers.some((m) => m !== null));
      if (plain && group.columns.every(myPure))
        out.groupby = { ...group, columns: sortByJson(group.columns) };
    }
    if (Array.isArray(out.from)) {
      const tablesOnly = out.from.every((f) => isObj(f) && !f.join && !f.expr);
      const star = /"type":"star"|"column":"\*"/.test(JSON.stringify(out.columns ?? null));
      if (tablesOnly && !star) out.from = sortByJson(out.from);
    }
  }
  if (mode.commutative && Array.isArray(out.partitionby) && out.partitionby.every(myPure)) {
    out.partitionby = sortByJson(out.partitionby);
  }
  return out;
}
