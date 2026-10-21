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

export interface ParserAdapter {
  /** Parser name and version, e.g. "libpg-query (PostgreSQL 18)". */
  readonly name: string;
  readonly dialect: Dialect;
  parse(statement: Statement): StatementParse;
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
