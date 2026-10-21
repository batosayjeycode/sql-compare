import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { compare } from '../src/compare.js';
import { caseInsensitiveWords } from '../src/keywords.js';
import { createNormalizer, printTokens, RULES, type NormToken } from '../src/normalize/index.js';
import type { RuleContext } from '../src/normalize/types.js';
import { loadParser, type ParserAdapter } from '../src/parse.js';
import { splitStatements } from '../src/split.js';
import { isTrivia, tokenize } from '../src/tokenize.js';
import type { Dialect } from '../src/types.js';

let pg: ParserAdapter;
let my: ParserAdapter;
beforeAll(async () => {
  pg = (await loadParser('postgresql'))!;
  my = (await loadParser('mysql'))!;
});

const rule = (id: string) => RULES.find((r) => r.id === id)!;
const ctx = (dialect: Dialect, caseInsensitiveTables = false): RuleContext => ({
  dialect,
  keywords: caseInsensitiveWords(dialect),
  caseInsensitiveTables,
});
const tokensOf = (sql: string, dialect: Dialect): NormToken[] =>
  tokenize(sql, dialect)
    .filter((t) => !isTrivia(t))
    .map(({ type, text, start, end }) => ({ type, text, start, end }));

/** Apply one rule to SQL and print the result (unchanged SQL when the rule doesn't apply). */
function apply(id: string, sql: string, dialect: Dialect = 'postgresql', tables = false) {
  const tokens = tokensOf(sql, dialect);
  return printTokens(rule(id).apply(tokens, ctx(dialect, tables))?.tokens ?? tokens);
}

describe('rules', () => {
  it('keyword-case upper-cases keywords and built-in functions only', () => {
    expect(apply('keyword-case', 'select count(*), Name from t')).toBe(
      'SELECT COUNT(*), Name FROM t',
    );
  });

  it('identifier-case folds unquoted identifiers (PostgreSQL)', () => {
    expect(apply('identifier-case', 'SELECT UserId FROM Orders o WHERE "Mixed" = 1')).toBe(
      'SELECT userid FROM orders o WHERE "Mixed" = 1',
    );
  });

  it('identifier-case keeps MySQL table names and aliases unless told otherwise', () => {
    const sql = 'SELECT U.Name, Total AS Sum1 FROM Users U JOIN Orders O ON O.UserId = U.Id';
    expect(apply('identifier-case', sql, 'mysql')).toBe(
      'SELECT U.name, total AS sum1 FROM Users U JOIN Orders O ON O.userid = U.id',
    );
    expect(apply('identifier-case', sql, 'mysql', true)).toBe(
      'SELECT u.name, total AS sum1 FROM users u JOIN orders o ON o.userid = u.id',
    );
  });

  it('redundant-quotes unquotes only plain, non-keyword identifiers', () => {
    expect(apply('redundant-quotes', 'SELECT "id", "Id", "user", "a b" FROM "t"')).toBe(
      'SELECT id, "Id", "user", "a b" FROM t',
    );
    expect(apply('redundant-quotes', 'SELECT `Id`, `select` FROM `t`', 'mysql')).toBe(
      'SELECT Id, `select` FROM t',
    );
  });

  it('join-synonyms drops INNER and OUTER', () => {
    expect(apply('join-synonyms', 'a INNER JOIN b LEFT OUTER JOIN c FULL OUTER JOIN d')).toBe(
      'a JOIN b LEFT JOIN c FULL JOIN d',
    );
  });

  it('not-equal writes != as <>', () => {
    expect(apply('not-equal', 'WHERE a != 1 AND b <> 2')).toBe('WHERE a <> 1 AND b <> 2');
  });

  it('alias-as drops AS before aliases but not in CAST, CTEs or CREATE … AS', () => {
    expect(apply('alias-as', 'SELECT a AS x, b AS "Y" FROM t AS u JOIN v AS w ON true')).toBe(
      'SELECT a x, b "Y" FROM t u JOIN v w ON true',
    );
    for (const sql of [
      'SELECT CAST(a AS mytype) FROM t',
      'WITH c AS (SELECT 1) SELECT * FROM c',
      'CREATE VIEW v AS SELECT 1',
      'SELECT a AS select FROM t',
    ]) {
      expect(apply('alias-as', sql)).toBe(sql);
    }
  });

  it('strip-parens removes only parentheses that cannot change precedence', () => {
    expect(apply('strip-parens', 'SELECT 1 FROM t WHERE ((a = 1) AND (b = 2 AND c = 3))')).toBe(
      'SELECT 1 FROM t WHERE a = 1 AND b = 2 AND c = 3',
    );
    expect(apply('strip-parens', 'SELECT 1 FROM t WHERE x OR (y AND z)')).toBe(
      'SELECT 1 FROM t WHERE x OR y AND z',
    );
    for (const sql of [
      'SELECT 1 FROM t WHERE a AND (b OR c)',
      'SELECT 1 FROM t WHERE NOT (a AND b)',
      'SELECT 1 FROM t WHERE a IN (SELECT 1)',
      'SELECT 1 FROM t WHERE (a, b) = (1, 2)',
      'SELECT 1 FROM t WHERE f(a) AND (b)',
    ]) {
      expect(apply('strip-parens', sql)).toBe(sql.replace('AND (b)', 'AND b'));
    }
  });

  it('sort-boolean sorts pure AND / OR chains, recursively', () => {
    expect(apply('sort-boolean', 'SELECT 1 FROM t WHERE z = 1 AND (y = 2 OR x = 3)')).toBe(
      'SELECT 1 FROM t WHERE (x = 3 OR y = 2) AND z = 1',
    );
    expect(apply('sort-boolean', 'SELECT 1 FROM a JOIN b ON b.y = 1 AND a.x = b.x')).toBe(
      'SELECT 1 FROM a JOIN b ON a.x = b.x AND b.y = 1',
    );
  });

  it('sort-boolean leaves chains with function calls or subqueries alone', () => {
    for (const sql of [
      'SELECT 1 FROM t WHERE z = 1 AND f(a) > 0',
      'SELECT 1 FROM t WHERE z = 1 AND EXISTS (SELECT 1)',
      'SELECT 1 FROM t WHERE z = 1 AND a IN (SELECT b FROM u)',
    ]) {
      expect(apply('sort-boolean', sql)).toBe(sql);
    }
  });

  it('sort-boolean keeps BETWEEN … AND together', () => {
    expect(apply('sort-boolean', 'SELECT 1 FROM t WHERE z = 1 AND a BETWEEN 1 AND 2')).toBe(
      'SELECT 1 FROM t WHERE a BETWEEN 1 AND 2 AND z = 1',
    );
  });

  it('sort-equality puts column references first, then sorts', () => {
    expect(apply('sort-equality', 'SELECT 1 FROM t WHERE 1 = x AND u.id = o.user_id')).toBe(
      'SELECT 1 FROM t WHERE x = 1 AND o.user_id = u.id',
    );
    // UPDATE … SET a = b is an assignment, not a comparison.
    expect(apply('sort-equality', 'UPDATE t SET b = a WHERE 1 = 1')).toBe(
      'UPDATE t SET b = a WHERE 1 = 1',
    );
  });

  it('sort-in-list sorts literal lists only', () => {
    expect(apply('sort-in-list', "SELECT 1 FROM t WHERE s IN ('b', 'a') AND n NOT IN (3, 1)")).toBe(
      "SELECT 1 FROM t WHERE s IN ('a', 'b') AND n NOT IN (1, 3)",
    );
    expect(apply('sort-in-list', 'SELECT 1 FROM t WHERE s IN (b, a)')).toBe(
      'SELECT 1 FROM t WHERE s IN (b, a)',
    );
  });

  it('sort-group-by sorts plain GROUP BY lists only', () => {
    expect(apply('sort-group-by', 'SELECT 1 FROM t GROUP BY b, a HAVING count(*) > 1')).toBe(
      'SELECT 1 FROM t GROUP BY a, b HAVING count(*) > 1',
    );
    for (const sql of [
      'SELECT 1 FROM t GROUP BY ROLLUP (b, a)',
      'SELECT 1 FROM t GROUP BY b, a WITH ROLLUP',
      'SELECT 1 FROM t GROUP BY GROUPING SETS ((b), (a))',
    ]) {
      expect(apply('sort-group-by', sql)).toBe(sql);
    }
  });

  it('sort-partition-by sorts window partitions but never ORDER BY', () => {
    expect(
      apply('sort-partition-by', 'SELECT rank() OVER (PARTITION BY b, a ORDER BY d, c) FROM t'),
    ).toBe('SELECT rank() OVER (PARTITION BY a, b ORDER BY d, c) FROM t');
    // Table partitioning DDL is not a window.
    const ddl = 'CREATE TABLE t (a int, b int) PARTITION BY LIST (b)';
    expect(apply('sort-partition-by', ddl)).toBe(ddl);
  });

  it('sort-from-list sorts comma joins, but not with SELECT * or explicit joins', () => {
    expect(apply('sort-from-list', 'SELECT o.id FROM users u, orders o WHERE o.u = u.id')).toBe(
      'SELECT o.id FROM orders o, users u WHERE o.u = u.id',
    );
    for (const sql of [
      'SELECT * FROM users u, orders o',
      'SELECT u.* FROM users u, orders o',
      'SELECT 1 FROM users u, orders o JOIN x ON true',
    ]) {
      expect(apply('sort-from-list', sql)).toBe(sql);
    }
  });

  it('never reorders SELECT lists, ORDER BY items or UNION branches', () => {
    const sql = 'SELECT b, a FROM t ORDER BY b, a LIMIT 5 UNION SELECT 2, 1';
    for (const r of RULES) {
      const out = apply(r.id, sql);
      expect(out.replace(/\s+/g, ' ')).toMatch(/SELECT b, a .*ORDER BY b, a .*SELECT 2, 1/i);
    }
  });
});

describe('verification and rollback', () => {
  /** A parser that accepts anything; ASTs are equivalent to the original when `ok(text)`. */
  function stubParser(ok: (text: string) => boolean): ParserAdapter {
    return {
      name: 'stub',
      dialect: 'postgresql',
      parse: (s) => ({ status: 'parsed', ast: s.text }),
      canonical: (ast) => (ok(ast as string) ? 'same' : (ast as string)),
    };
  }

  function normalize(sql: string, parser: ParserAdapter, level: 2 | 3 = 2) {
    const statements = splitStatements(sql, 'postgresql').map((statement) => ({
      statement,
      status: 'parsed' as const,
      ast: statement.text,
    }));
    return createNormalizer(
      'left',
      sql,
      statements,
      { dialect: 'postgresql', level, disabledRules: new Set(), caseInsensitiveTables: false },
      parser,
    ).snapshot(level);
  }

  it('applies a whole group when the re-parsed AST is equivalent', () => {
    const snap = normalize(
      'select A from t where a != 1',
      stubParser(() => true),
    );
    expect(snap.issues).toEqual([]);
    expect(snap.text).toBe('SELECT a FROM t WHERE a <> 1;');
  });

  it('rolls back only the rule whose result is not equivalent', () => {
    const parser = stubParser((text) => !text.includes('<>'));
    const snap = normalize('select A from t where a != 1', parser);
    expect(snap.text).toBe('SELECT a FROM t WHERE a != 1;');
    expect(snap.issues).toMatchObject([{ rule: 'not-equal', statementIndex: 0 }]);
    expect(snap.transformations.map((t) => t.rule)).toEqual(['keyword-case', 'identifier-case']);
  });

  it('records each applied rule with a count and an example', () => {
    const snap = normalize(
      'select A, B from t where x != 1 and y != 2',
      stubParser(() => true),
    );
    expect(snap.transformations.find((t) => t.rule === 'not-equal')).toMatchObject({
      count: 2,
      before: 'x != 1 AND y != …',
      after: 'x <> 1 AND y <> …',
    });
  });

  it('applies only L1 to statements that did not parse', () => {
    const statements = splitStatements('select (a from T;', 'postgresql').map((statement) => ({
      statement,
      status: 'error' as const,
    }));
    const snap = createNormalizer(
      'left',
      'select (a from T;',
      statements,
      { dialect: 'postgresql', level: 3, disabledRules: new Set(), caseInsensitiveTables: false },
      pg,
    ).snapshot(3);
    expect(snap.text).toBe('select (a from T;');
    expect(snap.transformations.map((t) => t.rule)).toEqual(['terminators']);
  });

  it('really rejects non-equivalent rewrites with the real parsers', () => {
    // These canonical forms must differ: the verification is not vacuous.
    const canon = (p: ParserAdapter, sql: string) => {
      const parsed = p.parse(splitStatements(sql, p.dialect)[0]!);
      if (parsed.status !== 'parsed') throw new Error(sql);
      return p.canonical(parsed.ast, {
        commutative: true,
        caseInsensitiveColumns: true,
        caseInsensitiveTables: false,
      });
    };
    for (const p of [pg, my]) {
      expect(canon(p, 'SELECT a, b FROM t')).not.toBe(canon(p, 'SELECT b, a FROM t'));
      expect(canon(p, 'SELECT 1 FROM t ORDER BY a, b')).not.toBe(
        canon(p, 'SELECT 1 FROM t ORDER BY b, a'),
      );
      expect(canon(p, 'SELECT 1 FROM t WHERE f(a) AND b')).not.toBe(
        canon(p, 'SELECT 1 FROM t WHERE b AND f(a)'),
      );
      expect(canon(p, 'SELECT 1 FROM t WHERE a = 1.0')).not.toBe(
        canon(p, 'SELECT 1 FROM t WHERE a = 1.00'),
      );
      expect(canon(p, 'SELECT 1 FROM a LEFT JOIN b ON a.x = b.x')).not.toBe(
        canon(p, 'SELECT 1 FROM b LEFT JOIN a ON a.x = b.x'),
      );
    }
    expect(canon(my, 'SELECT a FROM Users')).not.toBe(canon(my, 'SELECT a FROM users'));
  });
});

describe('classification', () => {
  const opts = (level: 2 | 3, dialect: Dialect = 'postgresql') => ({ dialect, level }) as const;

  // Acceptance criterion 5.
  it('INNER JOIN vs JOIN with a quoted table is structural-only at L2', () => {
    const result = compare(
      'SELECT a FROM t INNER JOIN u ON t.id = u.id',
      'SELECT a FROM "t" JOIN u ON t.id = u.id',
      opts(2),
      pg,
    );
    expect(result.verdict).toBe('structural-only');
    expect(result.differences.every((d) => d.resolvedBy)).toBe(true);
    expect(result.differences[0]!.resolvedBy!.split(',').sort()).toEqual([
      'join-synonyms',
      'redundant-quotes',
    ]);
  });

  // Acceptance criterion 6.
  it('reordered AND is semantic with an L3 hint at L2, structural with Aggressive', () => {
    const left = 'SELECT a FROM t WHERE x=1 AND y=2';
    const right = 'SELECT a FROM t WHERE y = 2 AND x = 1';
    const l2 = compare(left, right, opts(2), pg);
    expect(l2.verdict).toBe('potentially-semantic');
    const semantic = l2.differences.filter((d) => d.class === 'semantic');
    expect(semantic.length).toBeGreaterThan(0);
    for (const d of semantic) expect(d.l3Hint).toMatch(/aggressive normalization/);

    expect(compare(left, right, opts(3), pg).verdict).toBe('structural-only');
  });

  // Acceptance criterion 8.
  it.each([
    ['SELECT a, b FROM t', 'SELECT b, a FROM t'],
    ['SELECT a FROM t ORDER BY a, b', 'SELECT a FROM t ORDER BY b, a'],
    ['SELECT 1 UNION SELECT 2', 'SELECT 2 UNION SELECT 1'],
    [
      'SELECT 1 FROM a LEFT JOIN b ON a.x = b.x LEFT JOIN c ON a.y = c.y',
      'SELECT 1 FROM a LEFT JOIN c ON a.y = c.y LEFT JOIN b ON a.x = b.x',
    ],
  ])('never normalizes away %s → %s', (left, right) => {
    for (const parser of [pg, my]) {
      for (const level of [0, 1, 2, 3] as const) {
        const result = compare(left, right, { dialect: parser.dialect, level }, parser);
        expect(result.verdict).toBe('potentially-semantic');
      }
    }
  });

  it('keeps numeric literal form as a semantic difference', () => {
    expect(compare('SELECT 1 WHERE a = 1.0', 'SELECT 1 WHERE a = 1.00', opts(3), pg).verdict).toBe(
      'potentially-semantic',
    );
  });

  it('treats terminator differences as formatting', () => {
    const result = compare('SELECT 1;', 'SELECT 1', opts(2), pg);
    expect(result.verdict).toBe('formatting-only');
    expect(result.differences[0]).toMatchObject({ class: 'formatting', resolvedBy: 'terminators' });
  });

  it('respects disabled rules', () => {
    const left = 'SELECT a FROM t INNER JOIN u ON true';
    const right = 'SELECT a FROM t JOIN u ON true';
    expect(compare(left, right, opts(2), pg).verdict).toBe('structural-only');
    expect(compare(left, right, { ...opts(2), disabledRules: ['join-synonyms'] }, pg).verdict).toBe(
      'potentially-semantic',
    );
  });

  it('handles MySQL identifier case, quotes and != (and table names only when asked)', () => {
    const result = compare(
      'SELECT `Name` AS n FROM `Users` WHERE a != 1',
      'select name n from Users where a <> 1',
      opts(2, 'mysql'),
      my,
    );
    expect(result.verdict).toBe('structural-only');
    const tables = ['SELECT a FROM Users', 'SELECT a FROM users'] as const;
    expect(compare(...tables, opts(3, 'mysql'), my).verdict).toBe('potentially-semantic');
    expect(
      compare(...tables, { ...opts(3, 'mysql'), caseInsensitiveTables: true }, my).verdict,
    ).toBe('structural-only');
  });

  it('uppercases keyword-like MySQL column names without rolling back, but never table names', () => {
    const columns = compare(
      'SELECT o.status, o.name FROM orders o',
      'select o.STATUS, o.NAME from orders o',
      opts(2, 'mysql'),
      my,
    );
    expect(columns.normalizationIssues).toEqual([]);
    // STATUS is a keyword (formatting); `name` vs `NAME` is identifier case (structural).
    expect(columns.verdict).toBe('structural-only');
    expect(columns.stats).toMatchObject({ structural: 1, semantic: 0 });
    // `user` is a keyword, but as a MySQL table name its case matters.
    const table = compare('SELECT a FROM user', 'SELECT a FROM user', opts(2, 'mysql'), my);
    expect(table.views.left.normalized).toBe('SELECT a FROM user;');
  });

  it('runs no L3 rule unless aggressive mode is on', () => {
    const left = 'SELECT 1 FROM t WHERE ((b = 1) AND a = 2) GROUP BY y, x';
    const right = 'select 1 from t where a = 2 and b = 1 group by x, y';
    for (const parser of [pg, my]) {
      const result = compare(left, right, { dialect: parser.dialect, level: 2 }, parser);
      const levels = result.transformations.map((t) => RULES.find((r) => r.id === t.rule)!.level);
      expect(Math.max(...levels)).toBeLessThanOrEqual(2);
      expect(result.verdict).toBe('potentially-semantic');
    }
  });

  it('exposes normalized SQL for each side', () => {
    const result = compare('select A from T where (x = 1);', 'SELECT 1', opts(3), pg);
    expect(result.views.left.normalized).toBe('SELECT a FROM t WHERE x = 1;');
  });
});

describe('properties', () => {
  const columns = fc.constantFrom('a', 'b', 'c', 'x', 'y');
  const literal = fc.oneof(
    fc.integer({ min: 0, max: 50 }).map(String),
    fc.constantFrom("'p'", "'q'"),
  );
  const predicate = fc
    .tuple(columns, fc.constantFrom('=', '<>', '<', '>='), literal)
    .map(([c, op, l]) => `${c} ${op} ${l}`);

  /** A query plus an equivalent variant (L3), built from the same parts. */
  const equivalentPair = fc
    .record({
      preds: fc.array(predicate, { minLength: 1, maxLength: 4 }),
      inList: fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 4 }),
      group: fc.uniqueArray(columns, { minLength: 1, maxLength: 3 }),
      perm: fc.integer(),
      inner: fc.boolean(),
      quote: fc.boolean(),
      upper: fc.boolean(),
      wrap: fc.boolean(),
      flip: fc.boolean(),
    })
    .map((p) => {
      const rotate = <T>(xs: T[]) => {
        const k = Math.abs(p.perm) % xs.length;
        return [...xs.slice(k), ...xs.slice(0, k)];
      };
      const kw = (s: string) => (p.upper ? s.toUpperCase() : s.toLowerCase());
      const where = (preds: string[], list: number[]) =>
        [...preds, `z IN (${list.join(', ')})`].join(` ${kw('and')} `);
      const left = `SELECT a, count(*) FROM t ${p.inner ? 'INNER JOIN' : 'JOIN'} u ON t.id = u.id WHERE ${where(p.preds, p.inList)} GROUP BY ${p.group.join(', ')}`;
      const rightWhere = where(rotate(p.preds), [...p.inList].reverse());
      const right = `${kw('select')} a, count(*) ${kw('from')} ${p.quote ? '"t"' : 't'} ${kw('join')} u ${kw('on')} ${p.flip ? 'u.id = t.id' : 't.id = u.id'} ${kw('where')} ${p.wrap ? `(${rightWhere})` : rightWhere} ${kw('group by')} ${rotate(p.group).join(', ')}`;
      return [left, right] as const;
    });

  it('equivalent variants are never potentially semantic at L3 (property)', () => {
    fc.assert(
      fc.property(equivalentPair, ([left, right]) => {
        const result = compare(left, right, { dialect: 'postgresql', level: 3 }, pg);
        expect(result.normalizationIssues).toEqual([]);
        expect(['identical', 'formatting-only', 'structural-only']).toContain(result.verdict);
      }),
      { numRuns: 150 },
    );
  });

  it('a changed literal is always potentially semantic (property)', () => {
    fc.assert(
      fc.property(equivalentPair, fc.integer({ min: 100, max: 999 }), ([left, right], n) => {
        const changed = right.replace(/ IN \(/i, ` IN (${n}, `);
        for (const level of [2, 3] as const) {
          expect(compare(left, changed, { dialect: 'postgresql', level }, pg).verdict).toBe(
            'potentially-semantic',
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  // PLAN §8 properties (b) and (c).
  it('normalized SQL re-parses and normalizing it again changes nothing (property)', () => {
    fc.assert(
      fc.property(equivalentPair, fc.constantFrom('postgresql', 'mysql'), ([left], dialect) => {
        const parser = dialect === 'mysql' ? my : pg;
        const sql = dialect === 'mysql' ? left.replace(/"/g, '`') : left;
        const once = compare(sql, sql, { dialect, level: 3 }, parser).views.left.normalized!;
        for (const s of splitStatements(once, dialect)) {
          expect(parser.parse(s).status).toBe('parsed');
        }
        const twice = compare(once, once, { dialect, level: 3 }, parser).views.left.normalized!;
        expect(twice.replace(/\s+/g, ' ')).toBe(once.replace(/\s+/g, ' '));
      }),
      { numRuns: 100 },
    );
  });

  // PLAN §8 property (f), now with normalization.
  it('stays symmetric with normalization (property)', () => {
    fc.assert(
      fc.property(equivalentPair, equivalentPair, ([a], [, b]) => {
        const ab = compare(a, b, { dialect: 'postgresql', level: 3 }, pg);
        const ba = compare(b, a, { dialect: 'postgresql', level: 3 }, pg);
        expect(ba.verdict).toBe(ab.verdict);
        expect(ba.stats).toEqual(ab.stats);
      }),
      { numRuns: 100 },
    );
  });
});
