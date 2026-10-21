import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { compare } from '../src/compare.js';
import { loadParser, type ParserAdapter } from '../src/parse.js';
import { codePointToUtf16 } from '../src/parsers/postgresql.js';
import { splitStatements } from '../src/split.js';
import type { Dialect } from '../src/types.js';

let pg: ParserAdapter;
let my: ParserAdapter;

beforeAll(async () => {
  pg = (await loadParser('postgresql'))!;
  my = (await loadParser('mysql'))!;
});

const parseOne = (adapter: ParserAdapter, sql: string) =>
  adapter.parse(splitStatements(sql, adapter.dialect)[0]!);

describe('loadParser', () => {
  it('loads once per dialect and has no parser for Generic', async () => {
    expect(await loadParser('postgresql')).toBe(pg);
    expect(await loadParser('generic')).toBeNull();
  });
});

describe('PostgreSQL adapter (libpg-query)', () => {
  it('parses PostgreSQL-specific syntax', () => {
    for (const sql of [
      `SELECT a, count(*) FILTER (WHERE b > 1) FROM t GROUP BY GROUPING SETS ((a), ())`,
      `INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = EXCLUDED.a RETURNING id`,
      `MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a`,
      `SELECT data->>'k', tags @> ARRAY['x'] FROM docs FOR UPDATE SKIP LOCKED`,
    ]) {
      expect(parseOne(pg, sql)).toMatchObject({ status: 'parsed' });
    }
  });

  it('reports the error position', () => {
    expect(parseOne(pg, 'SELECT (a FROM t')).toEqual({
      status: 'error',
      message: 'syntax error at or near "FROM"',
      offset: 10,
    });
  });

  it('maps error positions past non-ASCII and astral characters', () => {
    const sql = "SELECT 'héllo 😀', a FROM WHERE";
    const result = parseOne(pg, sql);
    expect(result).toMatchObject({ status: 'error' });
    if (result.status === 'error') expect(sql.slice(result.offset)).toBe('WHERE');
  });

  it('converts code-point offsets to UTF-16 offsets', () => {
    expect(codePointToUtf16('a😀b', 2)).toBe(3);
    expect(codePointToUtf16('abc', 10)).toBe(3);
  });

  it('marks psql meta-commands as unsupported', () => {
    expect(parseOne(pg, '\\set x 1')).toMatchObject({ status: 'unsupported' });
  });
});

describe('MySQL adapter (node-sql-parser)', () => {
  it('parses MySQL-specific syntax', () => {
    for (const sql of [
      'SELECT `a` FROM t WHERE c = "x" LIMIT 1, 10',
      'INSERT INTO t (a) VALUES (1) ON DUPLICATE KEY UPDATE a = VALUES(a)',
      'CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB',
    ]) {
      expect(parseOne(my, sql)).toMatchObject({ status: 'parsed' });
    }
  });

  it('reports syntax errors with a readable message and position', () => {
    expect(parseOne(my, 'SELECT a FROM WHERE x = 1')).toEqual({
      status: 'error',
      message: 'Syntax not recognized near "x"',
      offset: 20,
    });
  });

  it('treats statement kinds the grammar lacks as unsupported, not as errors', () => {
    expect(parseOne(my, 'SET NAMES utf8mb4')).toMatchObject({ status: 'unsupported' });
  });

  it('treats stored-program bodies as unsupported', () => {
    expect(parseOne(my, 'CREATE PROCEDURE p() BEGIN SELECT 1; END')).toMatchObject({
      status: 'unsupported',
    });
  });
});

describe('compare with a parser', () => {
  const opts = (dialect: Dialect) => ({ dialect, level: 2 }) as const;

  it('reports parse errors with line and column in the full input', () => {
    const left = 'SELECT 1;\nSELECT (a\n  FROM t;';
    const result = compare(left, 'SELECT 1;\nSELECT a FROM t;', opts('postgresql'), pg);
    expect(result.parser).toBe(pg.name);
    expect(result.errors).toEqual([
      {
        side: 'left',
        statementIndex: 1,
        message: 'syntax error at or near "FROM"',
        offset: left.indexOf('FROM'),
        line: 3,
        column: 3,
      },
    ]);
    expect(result.statements.left.map((s) => s.status)).toEqual(['parsed', 'error']);
    expect(result.statements.right.map((s) => s.status)).toEqual(['parsed', 'parsed']);
  });

  it('classifies changes in unparseable statements as unknown and keeps the rest', () => {
    const left = 'SELECT a FROM t WHERE x = 1;\nSELECT (b FROM u;';
    const right = 'SELECT a FROM t WHERE x = 2;\nSELECT (c FROM u;';
    const result = compare(left, right, opts('postgresql'), pg);
    expect(result.differences.map((d) => [d.statementPair, d.class])).toEqual([
      [0, 'semantic'],
      [1, 'unknown'],
    ]);
    expect(result.verdict).toBe('potentially-semantic');
    expect(compare('SELECT (b FROM u', 'SELECT (c FROM u', opts('postgresql'), pg).verdict).toBe(
      'unknown',
    );
  });

  it('keeps formatting-only verdicts for unparseable statements', () => {
    const result = compare('SELECT (a FROM t', 'select (a\nfrom t', opts('postgresql'), pg);
    expect(result.verdict).toBe('formatting-only');
    expect(result.errors).toHaveLength(2);
  });

  it('compares unsupported statements as text (unknown class)', () => {
    const result = compare('SET NAMES utf8', 'SET NAMES utf8mb4', opts('mysql'), my);
    expect(result.statements.left[0]).toMatchObject({ status: 'unsupported' });
    expect(result.differences[0]).toMatchObject({ class: 'unknown' });
    expect(result.errors).toEqual([]);
  });

  it('skips structural analysis entirely in Generic mode', () => {
    const result = compare('SELECT 1', 'SELECT 2', opts('generic'));
    expect(result.parser).toBeNull();
    expect(result.statements.left[0]).toMatchObject({ status: 'skipped' });
    expect(result.differences[0]).toMatchObject({ class: 'semantic' });
  });

  // PLAN §8 fuzzing: garbage input never throws.
  it('never throws on arbitrary input (property)', () => {
    const sqlish = fc.stringMatching(/^[A-Za-z0-9_ \n'"`$;(),.*=<>!@#:\\/-]{0,80}$/);
    fc.assert(
      fc.property(
        fc.oneof(sqlish, fc.string({ unit: 'binary', maxLength: 80 })),
        sqlish,
        (a, b) => {
          for (const parser of [pg, my]) {
            const result = compare(a, b, opts(parser.dialect), parser);
            for (const e of result.errors) {
              const text = e.side === 'left' ? a : b;
              expect(e.offset).toBeGreaterThanOrEqual(0);
              expect(e.offset).toBeLessThanOrEqual(text.length);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
