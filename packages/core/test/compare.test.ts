import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compare } from '../src/compare.js';
import { formatSql } from '../src/format.js';
import type { Dialect, Difference } from '../src/types.js';
import { reformattedPair, selectSql } from './arbitraries.js';

const pg = { dialect: 'postgresql', level: 2 } as const;
const dialects = fc.constantFrom<Dialect>('postgresql', 'mysql', 'generic');
const semantic = (ds: Difference[]) => ds.filter((d) => d.class === 'semantic');

describe('compare', () => {
  it('reports identical input', () => {
    const result = compare('SELECT 1', 'SELECT 1', pg);
    expect(result.verdict).toBe('identical');
    expect(result.differences).toEqual([]);
  });

  // Acceptance criterion 4.
  it('is formatting-only for whitespace, line breaks, comments and keyword case', () => {
    const left = 'SELECT a, b FROM t WHERE x = 1 AND y IS NULL;';
    const right = `-- tidy
select a,
       b
  from t /* main */
 where x = 1
   and y is null;`;
    const result = compare(left, right, pg);
    expect(result.verdict).toBe('formatting-only');
    expect(result.stats).toMatchObject({ structural: 0, semantic: 0, unknown: 0 });
    expect(result.stats.formatting).toBeGreaterThan(0);
  });

  it('merges a whole-statement reformat into one formatting difference', () => {
    const left = 'select a, b from t where x = 1';
    const formatted = formatSql(left, 'postgresql');
    if (!formatted.ok) throw new Error(formatted.message);
    const result = compare(left, formatted.text, pg);
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toMatchObject({
      class: 'formatting',
      description: 'Whitespace and keyword case changed',
    });
  });

  it('describes a single keyword case change', () => {
    const [d] = compare('SELECT a FROM t', 'SELECT a from t', pg).differences;
    expect(d).toMatchObject({ class: 'formatting', description: 'Keyword case `FROM` → `from`' });
  });

  it('labels comment-only changes', () => {
    const [d] = compare('SELECT a -- old\nFROM t', 'SELECT a -- new\nFROM t', pg).differences;
    expect(d).toMatchObject({ class: 'formatting', description: 'Comments changed' });
  });

  it('treats identifier case and quoting as potentially semantic (until normalization)', () => {
    expect(compare('SELECT Name FROM t', 'SELECT name FROM t', pg).verdict).toBe(
      'potentially-semantic',
    );
    expect(compare('SELECT a FROM "t"', 'SELECT a FROM t', pg).verdict).toBe(
      'potentially-semantic',
    );
  });

  it('treats optimizer hints as significant', () => {
    const result = compare('SELECT /*+ SeqScan(t) */ a FROM t', 'SELECT a FROM t', pg);
    expect(semantic(result.differences)).toHaveLength(1);
  });

  it('describes added, removed and changed tokens with source ranges', () => {
    const left = 'SELECT a, b FROM t JOIN u ON t.id = u.id WHERE x = 1';
    const right = 'SELECT a, b, c FROM t LEFT JOIN u ON t.id = u.id WHERE x = 2';
    const result = compare(left, right, pg);
    expect(result.verdict).toBe('potentially-semantic');
    expect(result.differences.map((d) => [d.kind, d.description])).toEqual([
      ['added', 'Added `, c`'],
      ['added', 'Added `LEFT`'],
      ['changed', 'Changed `1` → `2`'],
    ]);
    const changed = result.differences[2]!;
    expect(left.slice(changed.left!.start, changed.left!.end)).toBe('1');
    expect(right.slice(changed.right!.start, changed.right!.end)).toBe('2');
  });

  it('separates formatting from semantic changes in the same query', () => {
    const result = compare('SELECT a FROM t WHERE x = 1', 'select a\nfrom t\nwhere x = 2', pg);
    expect(result.stats.semantic).toBe(1);
    expect(result.stats.formatting).toBeGreaterThan(0);
  });

  it('handles empty and comment-only input', () => {
    expect(compare('', 'SELECT 1', pg).differences).toMatchObject([
      { kind: 'added', class: 'semantic' },
    ]);
    expect(compare('-- a', '-- b', pg).verdict).toBe('formatting-only');
  });

  // PLAN §8 property (d).
  it('compare(x, x) is identical (property)', () => {
    fc.assert(
      fc.property(selectSql, dialects, (sql, dialect) => {
        expect(compare(sql, sql, { dialect, level: 2 }).verdict).toBe('identical');
      }),
    );
  });

  // PLAN §8 property (e).
  it('compare(x, reformat(x)) is formatting-only (property)', () => {
    fc.assert(
      fc.property(selectSql, dialects, (sql, dialect) => {
        const formatted = formatSql(sql, dialect);
        if (!formatted.ok || formatted.text === sql) return;
        expect(compare(sql, formatted.text, { dialect, level: 2 }).verdict).toBe('formatting-only');
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(reformattedPair, dialects, ([a, b], dialect) => {
        expect(compare(a, b, { dialect, level: 2 }).stats.semantic).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  // PLAN §8 property (f).
  it('is symmetric: added ↔ removed (property)', () => {
    const flip = {
      added: 'removed',
      removed: 'added',
      changed: 'changed',
      moved: 'moved',
    } as const;
    fc.assert(
      fc.property(selectSql, selectSql, dialects, (a, b, dialect) => {
        const ab = compare(a, b, { dialect, level: 2 });
        const ba = compare(b, a, { dialect, level: 2 });
        expect(ba.stats).toEqual(ab.stats);
        expect(ba.verdict).toBe(ab.verdict);
        const kinds = (r: typeof ab) => r.differences.map((d) => `${d.class}:${d.kind}`).sort();
        expect(kinds(ba)).toEqual(ab.differences.map((d) => `${d.class}:${flip[d.kind]}`).sort());
      }),
      { numRuns: 200 },
    );
  });
});
