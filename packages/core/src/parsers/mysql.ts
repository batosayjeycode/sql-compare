import * as mysqlBuild from 'node-sql-parser/build/mysql.js';
import { opaqueReason, type ParserAdapter } from '../parse.js';

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
  };
}
