import fc from 'fast-check';

/**
 * Small grammar-based generator for SELECT statements that are valid in
 * PostgreSQL, MySQL and ANSI SQL. A query is generated as a list of tokens,
 * then joined with arbitrary whitespace/comments so the same token list can be
 * rendered many different ways.
 */

const keyword = (word: string) =>
  fc.constantFrom(
    word.toUpperCase(),
    word.toLowerCase(),
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
  );

const column = fc.constantFrom('id', 'title', 'total', 'user_id', 'created_at', 'amount');
const table = fc.constantFrom('users', 'orders', 'items', 'accounts');
const qualified = fc.tuple(fc.constantFrom('a', 'b'), column).map(([t, c]) => [t, '.', c]);
const columnRef = fc.oneof(
  column.map((c) => [c]),
  qualified,
);

const literal = fc.oneof(
  fc.integer({ min: 0, max: 99999 }).map((n) => [String(n)]),
  fc.constantFrom("'a'", "'it''s'", "'x;y'", "'--not a comment'", '1.50', '0.5').map((s) => [s]),
  keyword('null').map((s) => [s]),
);

const comparison = fc
  .tuple(columnRef, fc.constantFrom('=', '<>', '<', '>=', '!='), literal)
  .map(([c, op, l]) => [...c, op, ...l]);

const isNull = fc
  .tuple(columnRef, keyword('is'), fc.option(keyword('not'), { nil: undefined }), keyword('null'))
  .map(([c, is, not, nul]) => [...c, is, ...(not ? [not] : []), nul]);

const inList = fc
  .tuple(columnRef, keyword('in'), fc.array(literal, { minLength: 1, maxLength: 3 }))
  .map(([c, kw, items]) => [
    ...c,
    kw,
    '(',
    ...items.flatMap((item, i) => (i === 0 ? item : [',', ...item])),
    ')',
  ]);

const predicate = fc.oneof(comparison, isNull, inList);

const where = fc
  .tuple(
    keyword('where'),
    predicate,
    fc.array(fc.tuple(fc.oneof(keyword('and'), keyword('or')), predicate), { maxLength: 3 }),
  )
  .map(([kw, first, rest]) => [kw, ...first, ...rest.flatMap(([op, p]) => [op, ...p])]);

const selectItem = fc.oneof(
  columnRef,
  fc.tuple(keyword('count'), fc.constant(['(', '*', ')'])).map(([f, args]) => [f, ...args]),
  fc
    .tuple(columnRef, keyword('as'), fc.constantFrom('x', 'label', 'n'))
    .map(([c, as, alias]) => [...c, as, alias]),
);

const join = fc
  .tuple(
    fc.constantFrom(['join'], ['inner', 'join'], ['left', 'join']),
    fc.boolean(),
    table,
    keyword('on'),
  )
  .chain(([kws, upper, t, on]) =>
    fc.constant([
      ...kws.map((k) => (upper ? k.toUpperCase() : k)),
      t,
      'b',
      on,
      'a',
      '.',
      'id',
      '=',
      'b',
      '.',
      'user_id',
    ]),
  );

export const selectTokens: fc.Arbitrary<string[]> = fc
  .tuple(
    keyword('select'),
    fc.array(selectItem, { minLength: 1, maxLength: 4 }),
    keyword('from'),
    table,
    fc.option(join, { nil: undefined }),
    fc.option(where, { nil: undefined }),
    fc.option(
      fc.tuple(
        keyword('order'),
        keyword('by'),
        columnRef,
        fc.option(keyword('desc'), { nil: undefined }),
      ),
      { nil: undefined },
    ),
    fc.option(fc.tuple(keyword('limit'), fc.integer({ min: 1, max: 500 })), { nil: undefined }),
    fc.boolean(),
  )
  .map(([select, items, from, t, j, w, order, limit, semicolon]) => [
    select,
    ...items.flatMap((item, i) => (i === 0 ? item : [',', ...item])),
    from,
    t,
    'a',
    ...(j ?? []),
    ...(w ?? []),
    ...(order ? [order[0], order[1], ...order[2], ...(order[3] ? [order[3]] : [])] : []),
    ...(limit ? [limit[0], String(limit[1])] : []),
    ...(semicolon ? [';'] : []),
  ]);

const separator = fc.constantFrom(' ', '  ', '\n', '\n  ', '\t', ' /* note */ ', ' -- note\n');

/** Join tokens with arbitrary whitespace / comments between every pair. */
export function render(tokens: string[], seps: string[]): string {
  return tokens.map((t, i) => (i === 0 ? t : (seps[i % seps.length] ?? ' ') + t)).join('');
}

export const selectSql: fc.Arbitrary<string> = fc
  .tuple(selectTokens, fc.array(separator, { minLength: 1, maxLength: 8 }))
  .map(([tokens, seps]) => render(tokens, seps));

/** The same query rendered twice with different whitespace and keyword case. */
export const reformattedPair: fc.Arbitrary<[string, string]> = fc
  .tuple(
    selectTokens,
    fc.array(separator, { minLength: 1, maxLength: 8 }),
    fc.array(fc.constantFrom(' ', '\n', '\n    ', '\t'), { minLength: 1, maxLength: 8 }),
    fc.constantFrom<'upper' | 'lower' | 'same'>('upper', 'lower', 'same'),
  )
  .map(([tokens, seps1, seps2, recase]) => {
    // Only words that are keywords in every dialect get re-cased.
    const KEYWORDS =
      /^(select|from|where|and|or|in|is|not|null|join|inner|left|on|as|order|by|desc|limit|count)$/i;
    const other = tokens.map((t) =>
      recase === 'same' || !KEYWORDS.test(t)
        ? t
        : recase === 'upper'
          ? t.toUpperCase()
          : t.toLowerCase(),
    );
    return [render(tokens, seps1), render(other, seps2)];
  });
