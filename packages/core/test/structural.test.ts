import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { compare } from '../src/compare.js';
import { alignStatements, type StatementSignature } from '../src/diff/align.js';
import { buildModel, type QueryModel } from '../src/diff/model.js';
import { SEVERITY } from '../src/diff/severity.js';
import { code } from '../src/diff/text.js';
import { caseInsensitiveWords } from '../src/keywords.js';
import { loadParser, type ParserAdapter } from '../src/parse.js';
import { isTrivia, tokenize } from '../src/tokenize.js';
import type { ComparisonResult, Dialect } from '../src/types.js';
import { selectSql } from './arbitraries.js';

let pg: ParserAdapter;
let my: ParserAdapter;

beforeAll(async () => {
  pg = (await loadParser('postgresql'))!;
  my = (await loadParser('mysql'))!;
});

const keywords = caseInsensitiveWords('postgresql');

function model(sql: string, kind = '') {
  const tokens = tokenize(sql, 'postgresql').filter((t) => !isTrivia(t));
  const text = (r: { start: number; end: number } | undefined) =>
    r
      ? tokens
          .slice(r.start, r.end)
          .map((t) => t.text)
          .join(' ')
      : undefined;
  return { model: buildModel(tokens, kind, { keywords }), text };
}

const clause = (m: QueryModel, name: string) => m.clauses.find((c) => c.name === name)!;

describe('clause model', () => {
  it('splits a SELECT into clauses and items', () => {
    const { model: m, text } = model(
      'SELECT DISTINCT a, b AS x, count(*) n FROM t JOIN u ON t.id = u.id AND u.ok WHERE p = 1 AND q BETWEEN 1 AND 2 GROUP BY a ORDER BY a DESC LIMIT 5',
    );
    expect(m.clauses.map((c) => c.name)).toEqual([
      'SELECT',
      'FROM',
      'WHERE',
      'GROUP BY',
      'ORDER BY',
      'LIMIT',
    ]);
    const select = clause(m, 'SELECT');
    expect(text(select.head)).toBe('SELECT DISTINCT');
    expect(select.items.map((i) => [i.key, i.name])).toEqual([
      ['a', 'a'],
      ['b', 'x'],
      ['COUNT ( * )', 'n'],
    ]);
    const from = clause(m, 'FROM');
    expect(from.items.map((i) => [text(i.parts.join), text(i.parts.table)])).toEqual([
      ['', 't'],
      ['JOIN', 'u'],
    ]);
    expect(from.items[1]!.children!.map((c) => c.key)).toEqual(['t . id = u . id', 'u . ok']);
    // BETWEEN … AND … is one predicate.
    expect(clause(m, 'WHERE').items.map((i) => i.key)).toEqual(['p = 1', 'q BETWEEN 1 AND 2']);
    expect(text(clause(m, 'ORDER BY').items[0]!.parts.direction)).toBe('DESC');
  });

  it('does not take keywords or operator operands for aliases', () => {
    const { model: m } = model(
      'SELECT a.b, x IS NULL, t.*, ts::timestamp with time zone, count(*) total, CASE WHEN a THEN 1 END c, 1 - 2 FROM t',
    );
    expect(clause(m, 'SELECT').items.map((i) => i.parts.alias !== undefined)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it('separates set operation branches from the trailing ORDER BY', () => {
    const { model: m, text } = model(
      'SELECT a FROM t UNION ALL (SELECT a FROM u) ORDER BY a LIMIT 3',
    );
    expect(m.branches!.map((b) => text(b.op))).toEqual(['', 'UNION ALL']);
    expect(m.clauses.map((c) => c.name)).toEqual(['ORDER BY', 'LIMIT']);
  });

  it('models WITH, INSERT, UPDATE and DELETE', () => {
    const withQuery = model('WITH r AS (SELECT 1) SELECT * FROM r').model;
    expect(withQuery.kind).toBe('SELECT');
    expect(clause(withQuery, 'WITH').items[0]!.query!.kind).toBe('SELECT');

    const insert = model("INSERT INTO s.t (a, b) VALUES (1, 'x'), (2, 'y') RETURNING a").model;
    expect(insert.target!.key).toBe('s . t');
    expect(insert.clauses.map((c) => c.name)).toEqual(['columns', 'VALUES', 'RETURNING']);
    expect(clause(insert, 'VALUES').items[1]!.children!.map((v) => v.key)).toEqual(['2', "'y'"]);

    const update = model('UPDATE t SET a = 1, b = b + 1 FROM u WHERE t.id = u.id').model;
    expect(clause(update, 'SET').items.map((i) => i.key)).toEqual(['a', 'b']);
    expect(update.clauses.map((c) => c.name)).toEqual(['SET', 'FROM', 'WHERE']);

    const del = model('DELETE FROM ONLY t AS x USING u WHERE x.id = u.id').model;
    expect(del.target!.name).toBe('t');
    expect(del.clauses.map((c) => c.name)).toEqual(['USING', 'WHERE']);
  });

  it('models CREATE TABLE columns, constraints and options', () => {
    const { model: m, text } = model(
      'CREATE TABLE IF NOT EXISTS t (id int NOT NULL DEFAULT 0 PRIMARY KEY, fk int REFERENCES u (id) ON DELETE SET NULL, CONSTRAINT c CHECK (id > 0)) WITH (fillfactor = 70)',
      'CREATE TABLE',
    );
    expect(text(m.head)).toBe('CREATE TABLE IF NOT EXISTS');
    const [id, fk, check] = clause(m, 'columns').items;
    expect(text(id!.parts.type)).toBe('int');
    expect(id!.children!.map((c) => c.name)).toEqual(['nullability', 'DEFAULT', 'PRIMARY KEY']);
    expect(fk!.children!.map((c) => text(c.span))).toEqual([
      'REFERENCES u ( id ) ON DELETE SET NULL',
    ]);
    expect([check!.role, check!.key]).toEqual(['constraint', 'CONSTRAINT c']);
    expect(clause(m, 'options').items[0]!.key).toBe('WITH ( fillfactor = 70 )');
  });

  it('keys ALTER TABLE actions by what they act on', () => {
    const { model: m } = model(
      'ALTER TABLE t ADD email text, ADD COLUMN IF NOT EXISTS age int, DROP CONSTRAINT c, ALTER COLUMN x TYPE int, RENAME TO u, ADD PRIMARY KEY (id)',
      'ALTER TABLE',
    );
    expect(clause(m, 'actions').items.map((i) => i.key)).toEqual([
      'ADD COLUMN email',
      'ADD COLUMN age',
      'DROP CONSTRAINT c',
      'ALTER COLUMN x',
      'RENAME TO',
      'ADD PRIMARY KEY',
    ]);
  });
});

describe('statement alignment', () => {
  const sig = (kind: string, target: string, sql: string): StatementSignature => ({
    kind,
    target,
    keys: sql.split(' '),
  });

  it('pairs identical, edited, added and moved statements', () => {
    const left = [
      sig('CREATE TABLE', 'a', 'CREATE TABLE a ( x int )'),
      sig('INSERT', 'a', 'INSERT INTO a VALUES ( 1 )'),
      sig('SELECT', '', 'SELECT 1'),
    ];
    const right = [
      sig('SELECT', '', 'SELECT 1'),
      sig('CREATE TABLE', 'a', 'CREATE TABLE a ( x int , y int )'),
      sig('INSERT', 'a', 'INSERT INTO a VALUES ( 1 )'),
      sig('DROP TABLE', 'a', 'DROP TABLE a'),
    ];
    expect(alignStatements(left, right).pairs).toEqual([
      { left: 2, right: 0, moved: true },
      { left: 0, right: 1, moved: false },
      { left: 1, right: 2, moved: false },
      { left: null, right: 3, moved: false },
    ]);
  });

  it('pairs dissimilar statements edited in place between aligned ones', () => {
    const left = ['SELECT 1', 'SELECT 2', 'SELECT 3'].map((s) => sig('SELECT', '', s));
    const right = ['SELECT 1', 'SELECT 20', 'SELECT 3'].map((s) => sig('SELECT', '', s));
    expect(alignStatements(left, right).pairs.map((p) => [p.left, p.right])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('handles large inputs with anchors first', () => {
    const left = Array.from({ length: 300 }, (_, i) => sig('SELECT', '', `SELECT ${i}`));
    const right = [...left.slice(0, 150), sig('DELETE', 't', 'DELETE FROM t'), ...left.slice(150)];
    const { pairs } = alignStatements(left, right);
    expect(pairs.filter((p) => p.left === null).map((p) => p.right)).toEqual([150]);
    expect(pairs.filter((p) => p.left !== null && p.right !== null)).toHaveLength(300);
  });
});

describe('severity and descriptions', () => {
  it('rates every aspect', () => {
    for (const value of Object.values(SEVERITY))
      expect(['info', 'minor', 'major']).toContain(value);
    expect(SEVERITY['from.join-type']).toBe('major');
    expect(SEVERITY.predicate).toBe('major');
    expect(SEVERITY['select.literal']).toBe('minor');
    expect(SEVERITY['select.alias']).toBe('minor');
  });

  it('writes Markdown-safe code spans', () => {
    expect(code('a')).toBe('`a`');
    expect(code('`a`')).toBe('`` `a` ``');
    expect(code('x``y')).toBe('``` x``y ```');
  });

  it('describes changes with the original spelling', () => {
    const result = compare(
      'CREATE TABLE t (Status varchar(5))',
      'CREATE TABLE t (Status varchar(9))',
      { dialect: 'mysql', level: 2 },
      my,
    );
    expect(result.differences[0]!.description).toBe(
      'Column `Status` type changed from `varchar(5)` to `varchar(9)`',
    );
  });

  it('groups differences by aligned statement pair', () => {
    const result = compare(
      'SELECT 1;\nUPDATE t SET a = 1;\nDELETE FROM x;',
      'SELECT 1;\nUPDATE t SET a = 2;\nINSERT INTO y VALUES (1);',
      { dialect: 'postgresql', level: 2 },
      pg,
    );
    expect(result.pairs.map((p) => [p.left, p.right, p.status, p.kind])).toEqual([
      [0, 0, 'unchanged', 'SELECT'],
      [1, 1, 'changed', 'UPDATE'],
      [2, null, 'removed', 'DELETE'],
      [null, 2, 'added', 'INSERT'],
    ]);
    for (const d of result.differences) {
      expect(result.pairs[d.statementPair]).toBeDefined();
    }
  });
});

describe('properties', () => {
  const flip = { added: 'removed', removed: 'added', changed: 'changed', moved: 'moved' } as const;
  const parserFor = (d: Dialect) => (d === 'mysql' ? my : pg);

  function checkRanges(result: ComparisonResult, left: string, right: string) {
    for (const d of result.differences) {
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.path.length).toBeGreaterThan(0);
      expect(result.pairs[d.statementPair]).toBeDefined();
      for (const [r, text] of [
        [d.left, left],
        [d.right, right],
      ] as const) {
        expect(r).toBeDefined();
        expect(0 <= r!.start && r!.start <= r!.end && r!.end <= text.length).toBe(true);
      }
    }
  }

  it('is symmetric and maps every difference to source ranges (property)', () => {
    fc.assert(
      fc.property(
        selectSql,
        selectSql,
        fc.constantFrom<Dialect>('postgresql', 'mysql'),
        (a, b, dialect) => {
          const options = { dialect, level: 2 } as const;
          const ab = compare(a, b, options, parserFor(dialect));
          const ba = compare(b, a, options, parserFor(dialect));
          checkRanges(ab, a, b);
          expect(ba.stats).toEqual(ab.stats);
          const kinds = (r: ComparisonResult, mirror: boolean) =>
            r.differences
              .map((d) => `${d.class}:${mirror ? flip[d.kind] : d.kind}:${d.severity}`)
              .sort();
          expect(kinds(ba, false)).toEqual(kinds(ab, true));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reports reordered distinct statements as moves only (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(selectSql, {
          minLength: 2,
          maxLength: 5,
          selector: (s) => s.toLowerCase().replace(/\s+/g, ' '),
        }),
        fc.integer({ min: 1, max: 4 }),
        (queries, k) => {
          const left = queries.map((q) => `${q};`).join('\n');
          const rotated = [
            ...queries.slice(k % queries.length),
            ...queries.slice(0, k % queries.length),
          ];
          const right = rotated.map((q) => `${q};`).join('\n');
          const result = compare(left, right, { dialect: 'postgresql', level: 2 }, pg);
          checkRanges(result, left, right);
          const semantic = result.differences.filter((d) => d.class === 'semantic');
          for (const d of semantic) expect(d.kind).toBe('moved');
        },
      ),
      { numRuns: 100 },
    );
  });
});
