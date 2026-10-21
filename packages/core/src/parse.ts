import type { Statement } from './split.js';
import type { Dialect } from './types.js';

/**
 * Parser adapters (PLAN §5.1): one per dialect, behind a common interface so
 * dialects can be added later. Adapters are loaded lazily with `import()`, so
 * each parser is its own chunk and only downloaded when its dialect is used.
 */

export type StatementParse =
  | { status: 'parsed'; ast: unknown }
  /** `offset` is a character offset into `statement.text`. */
  | { status: 'error'; message: string; offset: number }
  | { status: 'unsupported'; reason: string };

/**
 * How two ASTs are compared when verifying a normalization ("equal modulo the
 * rule"). Positions and grouping parentheses are always ignored and AND/OR
 * chains are always flattened (associativity); the flags below relax further,
 * and only when a rule that needs it was applied.
 */
export interface CanonicalMode {
  /** Sort operands of commutative constructs (pure operands only). */
  commutative: boolean;
  /** Column names, column aliases and function names compare case-insensitively. */
  caseInsensitiveColumns: boolean;
  /** Table names and aliases compare case-insensitively. */
  caseInsensitiveTables: boolean;
}

export interface ParserAdapter {
  /** Parser name and version, e.g. "libpg-query (PostgreSQL 18)". */
  readonly name: string;
  readonly dialect: Dialect;
  parse(statement: Statement): StatementParse;
  /** Canonical form of an AST from `parse`, for equality checks. */
  canonical(ast: unknown, mode: CanonicalMode): string;
}

/** Order-independent comparison helper for canonicalizers. */
export function sortByJson<T>(items: T[]): T[] {
  return items
    .map((item) => [JSON.stringify(item), item] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, item]) => item);
}

const loaded = new Map<Dialect, Promise<ParserAdapter | null>>();

/** Load (once) the parser for a dialect. Generic mode has no parser. */
export function loadParser(dialect: Dialect): Promise<ParserAdapter | null> {
  let adapter = loaded.get(dialect);
  if (!adapter) {
    adapter =
      dialect === 'postgresql'
        ? import('./parsers/postgresql.js').then((m) => m.createPostgresParser())
        : dialect === 'mysql'
          ? import('./parsers/mysql.js').then((m) => m.createMysqlParser())
          : Promise.resolve(null);
    // A failed load (e.g. WASM blocked) can be retried on the next compare.
    adapter.catch(() => loaded.delete(dialect));
    loaded.set(dialect, adapter);
  }
  return adapter;
}

/** Statements the splitter already knows can't be parsed structurally. */
export function opaqueReason(statement: Statement): string | null {
  if (statement.opaque === 'compound') return 'Procedural block (BEGIN … END) is compared as text.';
  if (statement.opaque === 'psql-meta') return 'psql client command is compared as text.';
  return null;
}
