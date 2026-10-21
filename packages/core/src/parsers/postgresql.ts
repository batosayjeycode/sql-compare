import { hasSqlDetails, loadModule, parseSync } from 'libpg-query';
import { opaqueReason, type ParserAdapter } from '../parse.js';

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
  };
}
