import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { splitStatements } from '../src/split.js';
import type { Dialect } from '../src/types.js';

const texts = (sql: string, dialect: Dialect = 'postgresql') =>
  splitStatements(sql, dialect).map((s) => s.text);

describe('splitStatements', () => {
  it('splits on semicolons and drops empty statements', () => {
    expect(texts('SELECT 1; SELECT 2;;\n\nSELECT 3')).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3']);
  });

  it('records exact source ranges, terminators and kinds', () => {
    const sql = '-- note\nselect 1;\n  create table t (a int)';
    const [a, b] = splitStatements(sql, 'postgresql');
    expect(a).toMatchObject({ index: 0, text: 'select 1', terminator: ';', kind: 'SELECT' });
    expect(sql.slice(a!.start, a!.end)).toBe('select 1');
    expect(b).toMatchObject({ index: 1, terminator: null, kind: 'CREATE TABLE' });
  });

  it('ignores semicolons in strings, comments, quoted identifiers and dollar quotes', () => {
    const sql = `SELECT 'a;b', "x;y" /* ; */ -- ;
FROM t;
CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;
SELECT 2`;
    expect(texts(sql)).toHaveLength(3);
    expect(texts(sql)[1]).toContain('RETURN 1; END; $$ LANGUAGE plpgsql');
  });

  it('keeps BEGIN/END stored-program bodies together (MySQL, no DELIMITER)', () => {
    const sql = `CREATE PROCEDURE p()
BEGIN
  DECLARE x INT DEFAULT 0;
  IF x = 0 THEN SET x = CASE WHEN 1 THEN 2 ELSE 3 END; END IF;
  WHILE x < 3 DO SET x = x + 1; END WHILE;
END;
SELECT 1;`;
    const stmts = splitStatements(sql, 'mysql');
    expect(stmts.map((s) => s.kind)).toEqual(['CREATE PROCEDURE', 'SELECT']);
    expect(stmts[0]).toMatchObject({ opaque: 'compound' });
    expect(stmts[0]!.text.endsWith('END')).toBe(true);
  });

  it('treats BEGIN; as a transaction statement, not a block', () => {
    expect(texts('BEGIN; UPDATE t SET a = 1; COMMIT;', 'mysql')).toEqual([
      'BEGIN',
      'UPDATE t SET a = 1',
      'COMMIT',
    ]);
    expect(splitStatements('BEGIN;', 'postgresql')[0]?.opaque).toBeNull();
  });

  it('honors MySQL DELIMITER changes', () => {
    const sql = `DELIMITER $$
CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW
BEGIN
  SET NEW.a = 1;
END$$
DELIMITER ;
SELECT 1; SELECT 2;`;
    const stmts = splitStatements(sql, 'mysql');
    expect(stmts.map((s) => [s.kind, s.terminator])).toEqual([
      ['CREATE TRIGGER', '$$'],
      ['SELECT', ';'],
      ['SELECT', ';'],
    ]);
    expect(stmts[0]!.text).toMatch(/^CREATE TRIGGER[\s\S]*SET NEW\.a = 1;\nEND$/);
  });

  it('handles PostgreSQL BEGIN ATOMIC function bodies', () => {
    const sql = `CREATE FUNCTION add(a int, b int) RETURNS int LANGUAGE sql
BEGIN ATOMIC
  SELECT a + b;
END;
SELECT add(1, 2);`;
    expect(splitStatements(sql, 'postgresql').map((s) => s.kind)).toEqual([
      'CREATE FUNCTION',
      'SELECT',
    ]);
  });

  it('splits psql meta-commands at end of line', () => {
    const sql = `\\set ON_ERROR_STOP on
SELECT 1;
\\i other.sql
SELECT 2`;
    const stmts = splitStatements(sql, 'postgresql');
    expect(stmts.map((s) => [s.text, s.opaque])).toEqual([
      ['\\set ON_ERROR_STOP on', 'psql-meta'],
      ['SELECT 1', null],
      ['\\i other.sql', 'psql-meta'],
      ['SELECT 2', null],
    ]);
  });

  it('never loses or overlaps significant text (property)', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary' }),
        fc.constantFrom<Dialect>('postgresql', 'mysql', 'generic'),
        (sql, dialect) => {
          const stmts = splitStatements(sql, dialect);
          let last = 0;
          for (const s of stmts) {
            expect(s.start).toBeGreaterThanOrEqual(last);
            expect(s.end).toBeGreaterThan(s.start);
            expect(sql.slice(s.start, s.end)).toBe(s.text);
            last = s.end;
          }
        },
      ),
    );
  });
});
