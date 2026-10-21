import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { tokenize, type TokenType } from '../src/tokenize.js';
import type { Dialect } from '../src/types.js';

const types = (sql: string, dialect: Dialect = 'postgresql') =>
  tokenize(sql, dialect)
    .filter((t) => t.type !== 'whitespace')
    .map((t) => [t.type, t.text] as [TokenType, string]);

describe('tokenize', () => {
  it('is lossless and contiguous for any input', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary' }),
        fc.constantFrom<Dialect>('postgresql', 'mysql', 'generic'),
        (sql, dialect) => {
          const tokens = tokenize(sql, dialect);
          expect(tokens.map((t) => t.text).join('')).toBe(sql);
          tokens.forEach((t, i) => {
            expect(t.end).toBeGreaterThan(t.start);
            expect(t.start).toBe(i === 0 ? 0 : tokens[i - 1]!.end);
          });
        },
      ),
    );
  });

  it('keeps semicolons and comment markers inside strings', () => {
    expect(types("SELECT 'a;b -- c', 'it''s'")).toEqual([
      ['word', 'SELECT'],
      ['string', "'a;b -- c'"],
      ['punctuation', ','],
      ['string', "'it''s'"],
    ]);
  });

  it('reads PostgreSQL dollar-quoted bodies as one string', () => {
    expect(types('SELECT $fn$ BEGIN; END; $fn$, $$x$$, $1')).toEqual([
      ['word', 'SELECT'],
      ['string', '$fn$ BEGIN; END; $fn$'],
      ['punctuation', ','],
      ['string', '$$x$$'],
      ['punctuation', ','],
      ['variable', '$1'],
    ]);
  });

  it('nests block comments in PostgreSQL only', () => {
    const sql = '/* a /* b */ c */ x';
    expect(types(sql, 'postgresql')).toEqual([
      ['block-comment', '/* a /* b */ c */'],
      ['word', 'x'],
    ]);
    expect(types(sql, 'mysql')[0]).toEqual(['block-comment', '/* a /* b */']);
  });

  it('treats optimizer hints and MySQL executable comments as significant', () => {
    expect(types('SELECT /*+ INDEX(t i) */ 1')[1]).toEqual(['hint', '/*+ INDEX(t i) */']);
    expect(types('SELECT /*! STRAIGHT_JOIN */ 1', 'mysql')[1]).toEqual([
      'hint',
      '/*! STRAIGHT_JOIN */',
    ]);
  });

  it('handles MySQL quoting, # comments, variables and backslash escapes', () => {
    expect(types("SELECT `a``b`, \"s\", 'it\\'s', @v, @@sql_mode # c", 'mysql')).toEqual([
      ['word', 'SELECT'],
      ['quoted-identifier', '`a``b`'],
      ['punctuation', ','],
      ['string', '"s"'],
      ['punctuation', ','],
      ['string', "'it\\'s'"],
      ['punctuation', ','],
      ['variable', '@v'],
      ['punctuation', ','],
      ['variable', '@@sql_mode'],
      ['line-comment', '# c'],
    ]);
  });

  it('requires whitespace after -- for MySQL comments', () => {
    expect(types('SELECT 1--2', 'mysql').map(([, text]) => text)).toEqual([
      'SELECT',
      '1',
      '-',
      '-',
      '2',
    ]);
    expect(types('SELECT 1--2', 'postgresql')[2]).toEqual(['line-comment', '--2']);
  });

  it('reads PostgreSQL quoted identifiers, E-strings and operators', () => {
    expect(types(`SELECT "Col", E'a\\'b', x::int, j->>'k', a <> b`)).toEqual([
      ['word', 'SELECT'],
      ['quoted-identifier', '"Col"'],
      ['punctuation', ','],
      ['string', "E'a\\'b'"],
      ['punctuation', ','],
      ['word', 'x'],
      ['operator', '::'],
      ['word', 'int'],
      ['punctuation', ','],
      ['word', 'j'],
      ['operator', '->>'],
      ['string', "'k'"],
      ['punctuation', ','],
      ['word', 'a'],
      ['operator', '<>'],
      ['word', 'b'],
    ]);
  });

  it('reads numbers', () => {
    expect(types('1 1.50 .5 1e10 2.5E-3 0xFF').map(([t, text]) => `${t}:${text}`)).toEqual([
      'number:1',
      'number:1.50',
      'number:.5',
      'number:1e10',
      'number:2.5E-3',
      'number:0xFF',
    ]);
  });
});
