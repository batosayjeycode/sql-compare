import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMAT_OPTIONS,
  formatSql,
  significantKeys,
  type FormatOptions,
} from '../src/format.js';
import type { Dialect } from '../src/types.js';
import { selectSql } from './arbitraries.js';

const dialects = fc.constantFrom<Dialect>('postgresql', 'mysql', 'generic');

const formatOptions: fc.Arbitrary<FormatOptions> = fc.record({
  keywordCase: fc.constantFrom('preserve', 'upper', 'lower'),
  indentWidth: fc.constantFrom(2, 4),
  useTabs: fc.boolean(),
  lineWidth: fc.constantFrom(20, 50, 80, 120),
  logicalOperatorNewline: fc.constantFrom('before', 'after'),
});

describe('formatSql', () => {
  it('pretty-prints and uppercases keywords by default', () => {
    const result = formatSql('select a, b from t where x = 1', 'postgresql');
    expect(result).toEqual({ ok: true, text: 'SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1' });
  });

  it('respects keyword case, indentation and tabs', () => {
    const opts = { ...DEFAULT_FORMAT_OPTIONS, keywordCase: 'lower' as const, useTabs: true };
    expect(formatSql('SELECT a FROM t', 'mysql', opts)).toEqual({
      ok: true,
      text: 'select\n\ta\nfrom\n\tt',
    });
  });

  it('never changes identifier case', () => {
    const result = formatSql('select UserName from Accounts', 'postgresql');
    expect(result.ok && result.text).toContain('UserName');
    expect(result.ok && result.text).toContain('Accounts');
  });

  it('keeps comments and the trailing newline', () => {
    const result = formatSql('-- top\nselect a /* why */ from t;\n', 'postgresql');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain('-- top');
      expect(result.text).toContain('/* why */');
      expect(result.text.endsWith('\n')).toBe(true);
    }
  });

  it('returns an error instead of throwing on input it cannot format', () => {
    const result = formatSql('SELECT (a FROM t', 'postgresql');
    expect(result).toMatchObject({ ok: false, reason: 'error' });
  });

  it('leaves blank input unchanged', () => {
    expect(formatSql('  \n', 'mysql')).toEqual({ ok: true, text: '  \n' });
  });

  // PLAN §8 property (a): tokens(format(sql)) == tokens(sql).
  it('never changes tokens (property)', () => {
    fc.assert(
      fc.property(selectSql, dialects, formatOptions, (sql, dialect, opts) => {
        const result = formatSql(sql, dialect, opts);
        expect(result).toMatchObject({ ok: true });
        if (result.ok)
          expect(significantKeys(result.text, dialect)).toEqual(significantKeys(sql, dialect));
      }),
      { numRuns: 300 },
    );
  });

  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(selectSql, dialects, (sql, dialect) => {
        const once = formatSql(sql, dialect);
        if (!once.ok) return;
        expect(formatSql(once.text, dialect)).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });
});
