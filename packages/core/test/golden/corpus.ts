import type { Dialect, Verdict } from '../../src/types.js';

/**
 * Golden corpus (PLAN §8): SQL pairs with the expected verdict and every
 * expected non-formatting difference, in order, as
 * `"<class> <kind> <severity>: <description>"` (plus ` [L3]` when the
 * difference carries the aggressive-normalization hint).
 *
 * Cases run for both dialects unless `only` is set. `level` defaults to 2.
 */
export interface GoldenCase {
  name: string;
  left: string;
  right: string;
  verdict: Verdict;
  diffs: string[];
  only?: Dialect;
  level?: 2 | 3;
  /** Expected highlighted text of semantic differences: [left, right] ('' = insertion point). */
  ranges?: Array<[string, string]>;
}

export const CORPUS: GoldenCase[] = [
  // --- Formatting only -------------------------------------------------------
  {
    name: 'whitespace and line breaks',
    left: 'SELECT a, b FROM t WHERE x = 1',
    right: 'SELECT a,\n       b\n  FROM t\n WHERE x = 1',
    verdict: 'formatting-only',
    diffs: [],
  },
  {
    name: 'keyword case',
    left: 'SELECT a FROM t WHERE x IS NULL ORDER BY a',
    right: 'select a from t where x is null order by a',
    verdict: 'formatting-only',
    diffs: [],
  },
  {
    name: 'comments',
    left: '-- report\nSELECT a /* main */ FROM t',
    right: 'SELECT a FROM t -- updated',
    verdict: 'formatting-only',
    diffs: [],
  },
  {
    name: 'statement terminator',
    left: 'SELECT 1;',
    right: 'SELECT 1',
    verdict: 'formatting-only',
    diffs: [],
  },
  {
    name: 'reformatted script',
    left: "create table t (id int, name text);\ninsert into t values (1, 'a');",
    right: "CREATE TABLE t (\n  id INT,\n  name TEXT\n);\n\nINSERT INTO t\nVALUES (1, 'a');",
    verdict: 'formatting-only',
    diffs: [],
  },

  // --- Structural (L2) -------------------------------------------------------
  {
    name: 'INNER JOIN vs JOIN',
    left: 'SELECT a FROM t INNER JOIN u ON t.id = u.id',
    right: 'SELECT a FROM t JOIN u ON t.id = u.id',
    verdict: 'structural-only',
    diffs: ['structural removed info: Removed `INNER`'],
  },
  {
    name: 'LEFT OUTER JOIN vs LEFT JOIN',
    left: 'SELECT a FROM t LEFT OUTER JOIN u ON t.id = u.id',
    right: 'SELECT a FROM t LEFT JOIN u ON t.id = u.id',
    verdict: 'structural-only',
    diffs: ['structural removed info: Removed `OUTER`'],
  },
  {
    name: '!= vs <>',
    left: 'SELECT a FROM t WHERE x != 1',
    right: 'SELECT a FROM t WHERE x <> 1',
    verdict: 'structural-only',
    diffs: ['structural changed info: Changed `!=` → `<>`'],
  },
  {
    name: 'optional AS',
    left: 'SELECT a AS total FROM t AS x',
    right: 'SELECT a total FROM t x',
    verdict: 'structural-only',
    diffs: ['structural removed info: Removed `AS`', 'structural removed info: Removed `AS`'],
  },
  {
    name: 'acceptance criterion 5: synonyms and quoting',
    only: 'postgresql',
    left: 'SELECT a FROM t INNER JOIN u ON t.id = u.id',
    right: 'SELECT a FROM "t" JOIN u ON t.id = u.id',
    verdict: 'structural-only',
    diffs: ['structural changed info: Changed `t INNER` → `"t"`'],
  },
  {
    name: 'PostgreSQL identifier case',
    only: 'postgresql',
    left: 'SELECT Name FROM Users WHERE Id = 1',
    right: 'SELECT name FROM users WHERE id = 1',
    verdict: 'structural-only',
    diffs: [
      'structural changed info: Changed `Name` → `name`',
      'structural changed info: Changed `Users` → `users`',
      'structural changed info: Changed `Id` → `id`',
    ],
  },
  {
    name: 'MySQL backticks',
    only: 'mysql',
    left: 'SELECT `name` FROM `users`',
    right: 'SELECT name FROM users',
    verdict: 'structural-only',
    diffs: [
      'structural changed info: Changed `` `name` `` → `name`',
      'structural changed info: Changed `` `users` `` → `users`',
    ],
  },
  {
    name: 'MySQL column case is insignificant, table case is significant',
    only: 'mysql',
    left: 'SELECT Name FROM Users',
    right: 'SELECT name FROM users',
    verdict: 'potentially-semantic',
    diffs: [
      'structural changed info: Changed `Name` → `name`',
      'semantic changed major: Table changed from `Users` to `users`',
    ],
    ranges: [['Users', 'users']],
  },

  // --- L3 opt-in -------------------------------------------------------------
  {
    name: 'acceptance criterion 6 at L2: AND reordering is semantic with a hint',
    left: 'SELECT a FROM t WHERE x=1 AND y=2',
    right: 'SELECT a FROM t WHERE y = 2 AND x = 1',
    verdict: 'potentially-semantic',
    diffs: ['semantic moved minor: WHERE predicate `x=1` moved from position 1 to 2 [L3]'],
    ranges: [['x=1', 'x = 1']],
  },
  {
    name: 'acceptance criterion 6 at L3: AND reordering is structural',
    level: 3,
    left: 'SELECT a FROM t WHERE x=1 AND y=2',
    right: 'SELECT a FROM t WHERE y = 2 AND x = 1',
    verdict: 'structural-only',
    diffs: [
      'structural removed info: Removed `x=1 AND`',
      'structural added info: Added `AND x = 1`',
    ],
  },
  {
    name: 'GROUP BY order at L2',
    left: 'SELECT a, b, count(*) FROM t GROUP BY a, b',
    right: 'SELECT a, b, count(*) FROM t GROUP BY b, a',
    verdict: 'potentially-semantic',
    diffs: ['semantic moved minor: GROUP BY item `a` moved from position 1 to 2 [L3]'],
  },
  {
    name: 'GROUP BY order at L3',
    level: 3,
    left: 'SELECT a, b, count(*) FROM t GROUP BY a, b',
    right: 'SELECT a, b, count(*) FROM t GROUP BY b, a',
    verdict: 'structural-only',
    diffs: ['structural removed info: Removed `a,`', 'structural added info: Added `, a`'],
  },
  {
    name: 'IN list order at L3',
    level: 3,
    left: 'SELECT a FROM t WHERE x IN (1, 2, 3)',
    right: 'SELECT a FROM t WHERE x IN (3, 1, 2)',
    verdict: 'structural-only',
    diffs: ['structural added info: Added `3,`', 'structural removed info: Removed `, 3`'],
  },
  {
    name: 'equality operand order at L3',
    level: 3,
    left: 'SELECT a FROM t JOIN u ON t.id = u.id',
    right: 'SELECT a FROM t JOIN u ON u.id = t.id',
    verdict: 'structural-only',
    diffs: [
      'structural changed info: Changed `t` → `u`',
      'structural changed info: Changed `u` → `t`',
    ],
  },
  {
    name: 'comma-joined tables at L3',
    level: 3,
    left: 'SELECT a FROM t, u WHERE t.id = u.id',
    right: 'SELECT a FROM u, t WHERE t.id = u.id',
    verdict: 'structural-only',
    diffs: ['structural removed info: Removed `t,`', 'structural added info: Added `, t`'],
  },
  {
    name: 'ORDER BY order is never normalized',
    level: 3,
    left: 'SELECT a, b FROM t ORDER BY a, b',
    right: 'SELECT a, b FROM t ORDER BY b, a',
    verdict: 'potentially-semantic',
    diffs: ['semantic moved minor: ORDER BY item `a` moved from position 1 to 2'],
  },
  {
    name: 'SELECT column order is never normalized',
    level: 3,
    left: 'SELECT a, b FROM t',
    right: 'SELECT b, a FROM t',
    verdict: 'potentially-semantic',
    diffs: ['semantic moved minor: Column `a` moved from position 1 to 2 in SELECT'],
  },
  {
    name: 'UNION branch order is never normalized',
    level: 3,
    left: 'SELECT a FROM t UNION SELECT a FROM u',
    right: 'SELECT a FROM u UNION SELECT a FROM t',
    verdict: 'potentially-semantic',
    diffs: ['semantic moved minor: Branch `SELECT a FROM t` moved from position 1 to 2'],
  },
  {
    name: 'outer join order is never normalized',
    level: 3,
    left: 'SELECT a FROM t LEFT JOIN u ON t.id = u.id JOIN v ON v.id = t.id',
    right: 'SELECT a FROM t JOIN v ON v.id = t.id LEFT JOIN u ON t.id = u.id',
    verdict: 'potentially-semantic',
    diffs: ['semantic moved major: Table `u` moved from position 2 to 3 in FROM'],
  },
  {
    name: 'AND with function calls is not reordered',
    level: 3,
    left: 'SELECT a FROM t WHERE f(x) AND y = 1',
    right: 'SELECT a FROM t WHERE y = 1 AND f(x)',
    verdict: 'potentially-semantic',
    diffs: ['semantic moved minor: WHERE predicate `y = 1` moved from position 2 to 1'],
  },

  // --- SELECT: semantic --------------------------------------------------------
  {
    name: 'acceptance criterion 7: join type, column, literal',
    left: 'SELECT a, b FROM t JOIN u ON t.id = u.id WHERE x = 1',
    right: 'SELECT a, b, c FROM t LEFT JOIN u ON t.id = u.id WHERE x = 2',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic added major: Added column `c` to SELECT',
      'semantic changed major: JOIN `u` changed from INNER to LEFT',
      'semantic changed major: WHERE predicate changed: `x = 1` → `x = 2`',
    ],
    ranges: [
      ['', 'c'],
      ['', 'LEFT'],
      ['1', '2'],
    ],
  },
  {
    name: 'acceptance criterion 7: swapped table',
    left: 'SELECT a FROM users u WHERE u.id = 1',
    right: 'SELECT a FROM customers u WHERE u.id = 1',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Table changed from `users` to `customers`'],
    ranges: [['users', 'customers']],
  },
  {
    name: 'removed column',
    left: 'SELECT id, name, email FROM users',
    right: 'SELECT id, email FROM users',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed column `name` from SELECT'],
    ranges: [['name', '']],
  },
  {
    name: 'changed expression keeps the alias',
    left: 'SELECT sum(amount) AS total FROM orders',
    right: 'SELECT sum(amount * rate) AS total FROM orders',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Column `total` changed: `sum(amount)` → `sum(amount * rate)`'],
    ranges: [['', '* rate']],
  },
  {
    name: 'literal in the SELECT list is minor',
    left: "SELECT id, 'active' AS state FROM users",
    right: "SELECT id, 'enabled' AS state FROM users",
    verdict: 'potentially-semantic',
    diffs: ["semantic changed minor: Column `state` changed: `'active'` → `'enabled'`"],
  },
  {
    name: 'alias rename is minor',
    left: 'SELECT count(*) AS n FROM t',
    right: 'SELECT count(*) AS total FROM t',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed minor: Alias of `count(*)` changed from `n` to `total`'],
    ranges: [['n', 'total']],
  },
  {
    name: 'alias added',
    left: 'SELECT count(*) FROM t',
    right: 'SELECT count(*) AS n FROM t',
    verdict: 'potentially-semantic',
    diffs: ['semantic added minor: Alias `n` added to `count(*)`'],
  },
  {
    name: 'DISTINCT added',
    left: 'SELECT a FROM t',
    right: 'SELECT DISTINCT a FROM t',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: `SELECT` changed to `SELECT DISTINCT`'],
  },
  {
    name: 'join condition changed',
    left: 'SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id',
    right: 'SELECT o.id FROM orders o JOIN users u ON u.id = o.buyer_id',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: JOIN `users` condition changed: `u.id = o.user_id` → `u.id = o.buyer_id`',
    ],
    ranges: [['user_id', 'buyer_id']],
  },
  {
    name: 'join condition predicate removed and join type changed',
    left: "SELECT c.id FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'",
    right: 'SELECT c.id FROM customers c JOIN orders o ON o.customer_id = c.id',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: JOIN `orders` changed from LEFT to INNER',
      "semantic removed major: Removed JOIN `orders` condition `o.status = 'paid'`",
    ],
  },
  {
    name: 'join added',
    left: 'SELECT o.id FROM orders o',
    right: 'SELECT o.id FROM orders o LEFT JOIN users u ON u.id = o.user_id',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added LEFT JOIN `users`'],
    ranges: [['', 'LEFT JOIN users u ON u.id = o.user_id']],
  },
  {
    name: 'join removed',
    left: 'SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id JOIN items i ON i.order_id = o.id',
    right: 'SELECT o.id FROM orders o JOIN items i ON i.order_id = o.id',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed INNER JOIN `users`'],
  },
  {
    name: 'table alias changed',
    left: 'SELECT 1 FROM users u',
    right: 'SELECT 1 FROM users usr',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed minor: Alias of `users` changed from `u` to `usr`'],
  },
  {
    name: 'WHERE predicate added',
    left: 'SELECT a FROM t WHERE x = 1',
    right: 'SELECT a FROM t WHERE x = 1 AND deleted_at IS NULL',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added WHERE predicate `deleted_at IS NULL`'],
    ranges: [['', 'deleted_at IS NULL']],
  },
  {
    name: 'WHERE predicate removed',
    left: "SELECT a FROM t WHERE x = 1 AND status = 'open'",
    right: 'SELECT a FROM t WHERE x = 1',
    verdict: 'potentially-semantic',
    diffs: ["semantic removed major: Removed WHERE predicate `status = 'open'`"],
  },
  {
    name: 'WHERE clause added',
    left: 'SELECT a FROM t',
    right: 'SELECT a FROM t WHERE active',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added clause `WHERE active`'],
  },
  {
    name: 'WHERE clause removed',
    left: 'SELECT a FROM t WHERE active',
    right: 'SELECT a FROM t',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed clause `WHERE active`'],
  },
  {
    name: 'comparison operator changed',
    left: 'SELECT a FROM t WHERE total > 100',
    right: 'SELECT a FROM t WHERE total >= 100',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: WHERE predicate changed: `total > 100` → `total >= 100`'],
    ranges: [['>', '>=']],
  },
  {
    name: 'IS NULL to IS NOT NULL',
    left: 'SELECT a FROM t WHERE b IS NULL',
    right: 'SELECT a FROM t WHERE b IS NOT NULL',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: WHERE predicate changed: `b IS NULL` → `b IS NOT NULL`'],
  },
  {
    name: 'LIKE pattern changed',
    left: "SELECT a FROM t WHERE name LIKE 'a%'",
    right: "SELECT a FROM t WHERE name LIKE '%a%'",
    verdict: 'potentially-semantic',
    diffs: [
      "semantic changed major: WHERE predicate changed: `name LIKE 'a%'` → `name LIKE '%a%'`",
    ],
  },
  {
    name: 'BETWEEN bound changed',
    left: 'SELECT a FROM t WHERE x BETWEEN 1 AND 10 AND y = 2',
    right: 'SELECT a FROM t WHERE x BETWEEN 1 AND 20 AND y = 2',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: WHERE predicate changed: `x BETWEEN 1 AND 10` → `x BETWEEN 1 AND 20`',
    ],
  },
  {
    name: 'OR condition changed',
    left: 'SELECT a FROM t WHERE x = 1 OR y = 2',
    right: 'SELECT a FROM t WHERE x = 1 OR y = 3',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: WHERE predicate changed: `x = 1 OR y = 2` → `x = 1 OR y = 3`'],
  },
  {
    name: 'numeric literal form is minor',
    left: 'SELECT a FROM t WHERE price = 1.0',
    right: 'SELECT a FROM t WHERE price = 1.00',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed minor: WHERE predicate changed: `price = 1.0` → `price = 1.00`'],
  },
  {
    name: 'HAVING changed',
    left: 'SELECT a, count(*) FROM t GROUP BY a HAVING count(*) > 5',
    right: 'SELECT a, count(*) FROM t GROUP BY a HAVING count(*) > 10',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: HAVING predicate changed: `count(*) > 5` → `count(*) > 10`'],
  },
  {
    name: 'GROUP BY item added',
    left: 'SELECT a, b, count(*) FROM t GROUP BY a',
    right: 'SELECT a, b, count(*) FROM t GROUP BY a, b',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added GROUP BY item `b`'],
  },
  {
    name: 'ORDER BY direction without LIMIT is minor',
    left: 'SELECT a FROM t ORDER BY a',
    right: 'SELECT a FROM t ORDER BY a DESC',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed minor: ORDER BY `a` changed from ASC to DESC'],
    ranges: [['', 'DESC']],
  },
  {
    name: 'ORDER BY direction with LIMIT is major',
    left: 'SELECT a FROM t ORDER BY a LIMIT 10',
    right: 'SELECT a FROM t ORDER BY a DESC LIMIT 10',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: ORDER BY `a` changed from ASC to DESC'],
  },
  {
    name: 'ORDER BY item added',
    left: 'SELECT a FROM t ORDER BY a',
    right: 'SELECT a FROM t ORDER BY a, b',
    verdict: 'potentially-semantic',
    diffs: ['semantic added minor: Added ORDER BY item `b`'],
  },
  {
    name: 'LIMIT changed',
    left: 'SELECT a FROM t LIMIT 10',
    right: 'SELECT a FROM t LIMIT 20',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: LIMIT changed from `10` to `20`'],
    ranges: [['10', '20']],
  },
  {
    name: 'OFFSET removed',
    left: 'SELECT a FROM t LIMIT 10 OFFSET 5',
    right: 'SELECT a FROM t LIMIT 10',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed clause `OFFSET 5`'],
  },
  {
    name: 'locking clause removed',
    left: 'SELECT a FROM t WHERE id = 1 FOR UPDATE',
    right: 'SELECT a FROM t WHERE id = 1',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed clause `FOR UPDATE`'],
  },
  {
    name: 'CTE body changed',
    left: 'WITH recent AS (SELECT * FROM orders WHERE created_at > 1) SELECT count(*) FROM recent',
    right: 'WITH recent AS (SELECT * FROM orders WHERE created_at > 2) SELECT count(*) FROM recent',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: WHERE predicate changed: `created_at > 1` → `created_at > 2`'],
  },
  {
    name: 'CTE added',
    left: 'WITH a AS (SELECT 1 AS x) SELECT x FROM a',
    right: 'WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT x FROM a',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added CTE `b`'],
  },
  {
    name: 'derived table changed',
    left: 'SELECT s.a FROM (SELECT a FROM t WHERE k = 1) s',
    right: 'SELECT s.a FROM (SELECT a FROM t WHERE k = 2) s',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: WHERE predicate changed: `k = 1` → `k = 2`'],
  },
  {
    name: 'subquery in WHERE changed',
    left: 'SELECT a FROM t WHERE id IN (SELECT t_id FROM u WHERE flag)',
    right: 'SELECT a FROM t WHERE id IN (SELECT t_id FROM u WHERE NOT flag)',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: WHERE predicate changed: `id IN (SELECT t_id FROM u WHERE flag)` → `id IN (SELECT t_id FROM u WHERE NOT flag)`',
    ],
    ranges: [['', 'NOT']],
  },
  {
    name: 'EXISTS subquery changed',
    left: 'SELECT a FROM t WHERE EXISTS (SELECT 1 FROM u WHERE u.t_id = t.id)',
    right: 'SELECT a FROM t WHERE NOT EXISTS (SELECT 1 FROM u WHERE u.t_id = t.id)',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: WHERE predicate changed: `EXISTS (SELECT 1 FROM u WHERE u.t_id = t.id)` → `NOT EXISTS (SELECT 1 FROM u WHERE u.t_id = t.id)`',
    ],
  },
  {
    name: 'UNION to UNION ALL',
    left: 'SELECT a FROM t UNION SELECT a FROM u',
    right: 'SELECT a FROM t UNION ALL SELECT a FROM u',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: `UNION` changed to `UNION ALL`'],
  },
  {
    name: 'UNION branch added',
    left: 'SELECT a FROM t UNION SELECT a FROM u',
    right: 'SELECT a FROM t UNION SELECT a FROM u UNION SELECT a FROM v',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added UNION branch `SELECT a FROM v`'],
  },
  {
    name: 'UNION branch changed',
    left: 'SELECT a FROM t UNION SELECT a FROM u WHERE x = 1',
    right: 'SELECT a FROM t UNION SELECT a FROM u WHERE x = 2',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: WHERE predicate changed: `x = 1` → `x = 2`'],
  },
  {
    name: 'CASE branch changed',
    left: "SELECT CASE WHEN score > 50 THEN 'pass' ELSE 'fail' END AS result FROM exams",
    right: "SELECT CASE WHEN score >= 60 THEN 'pass' ELSE 'fail' END AS result FROM exams",
    verdict: 'potentially-semantic',
    diffs: [
      "semantic changed major: Column `result` changed: `CASE WHEN score > 50 THEN 'pass' ELSE 'fail' END` → `CASE WHEN score >= 60 THEN 'pass' ELSE 'fail' END`",
    ],
  },
  {
    name: 'window ORDER BY changed',
    left: 'SELECT id, row_number() OVER (PARTITION BY grp ORDER BY ts) AS rn FROM t',
    right: 'SELECT id, row_number() OVER (PARTITION BY grp ORDER BY ts DESC) AS rn FROM t',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Column `rn` changed: `row_number() OVER (PARTITION BY grp ORDER BY ts)` → `row_number() OVER (PARTITION BY grp ORDER BY ts DESC)`',
    ],
    ranges: [['', 'DESC']],
  },
  {
    name: 'aggregate DISTINCT added',
    left: 'SELECT count(user_id) AS n FROM events',
    right: 'SELECT count(DISTINCT user_id) AS n FROM events',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Column `n` changed: `count(user_id)` → `count(DISTINCT user_id)`',
    ],
  },
  {
    name: 'TPC-H Q1 variant',
    only: 'postgresql',
    left: `SELECT l_returnflag, l_linestatus, sum(l_quantity) AS sum_qty,
       sum(l_extendedprice * (1 - l_discount)) AS sum_disc_price, count(*) AS count_order
FROM lineitem
WHERE l_shipdate <= date '1998-12-01' - interval '90 day'
GROUP BY l_returnflag, l_linestatus
ORDER BY l_returnflag, l_linestatus`,
    right: `select l_returnflag, l_linestatus, sum(l_quantity) as sum_qty,
       sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) as sum_disc_price, count(*) as count_order
from lineitem
where l_shipdate <= date '1998-12-01' - interval '60 day'
group by l_returnflag, l_linestatus
order by l_returnflag, l_linestatus`,
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Column `sum_disc_price` changed: `sum(l_extendedprice * (1 - l_discount))` → `sum(l_extendedprice * (1 - l_discount) * (1 + l_tax))`',
      "semantic changed major: WHERE predicate changed: `l_shipdate <= date '1998-12-01' - interval '90 day'` → `l_shipdate <= date '1998-12-01' - interval '60 day'`",
    ],
  },
  {
    name: 'optimizer hint removed',
    only: 'mysql',
    left: 'SELECT /*+ MAX_EXECUTION_TIME(1000) */ a FROM t',
    right: 'SELECT a FROM t',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed minor: Removed optimizer hint `/*+ MAX_EXECUTION_TIME(1000) */`'],
  },
  {
    name: 'PostgreSQL DISTINCT ON changed',
    only: 'postgresql',
    left: 'SELECT DISTINCT ON (user_id) user_id, ts FROM events ORDER BY user_id, ts DESC',
    right: 'SELECT DISTINCT ON (session_id) user_id, ts FROM events ORDER BY user_id, ts DESC',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: `SELECT DISTINCT ON (user_id)` changed to `SELECT DISTINCT ON (session_id)`',
    ],
  },
  {
    name: 'PostgreSQL cast changed',
    only: 'postgresql',
    left: 'SELECT amount::int AS amount FROM t',
    right: 'SELECT amount::numeric AS amount FROM t',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Column `amount` changed: `amount::int` → `amount::numeric`'],
  },
  {
    name: 'PostgreSQL ILIKE vs LIKE',
    only: 'postgresql',
    left: "SELECT a FROM t WHERE name ILIKE 'a%'",
    right: "SELECT a FROM t WHERE name LIKE 'a%'",
    verdict: 'potentially-semantic',
    diffs: [
      "semantic changed major: WHERE predicate changed: `name ILIKE 'a%'` → `name LIKE 'a%'`",
    ],
  },

  // --- INSERT ----------------------------------------------------------------
  {
    name: 'INSERT row added and value changed',
    left: "INSERT INTO users (id, email) VALUES (1, 'a@x.io'), (2, 'b@x.io')",
    right: "INSERT INTO users (id, email) VALUES (1, 'a@x.io'), (2, 'c@x.io'), (3, 'd@x.io')",
    verdict: 'potentially-semantic',
    diffs: [
      "semantic changed major: VALUES row 2, `email` changed: `'b@x.io'` → `'c@x.io'`",
      "semantic added major: Added VALUES row `(3, 'd@x.io')`",
    ],
    ranges: [
      ["'b@x.io'", "'c@x.io'"],
      ['', "(3, 'd@x.io')"],
    ],
  },
  {
    name: 'INSERT row removed',
    left: 'INSERT INTO t (a) VALUES (1), (2), (3)',
    right: 'INSERT INTO t (a) VALUES (1), (3)',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed VALUES row `(2)`'],
  },
  {
    name: 'INSERT column and value added',
    left: 'INSERT INTO t (a, b) VALUES (1, 2)',
    right: 'INSERT INTO t (a, b, c) VALUES (1, 2, 3)',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic added major: Added INSERT column `c`',
      'semantic added major: VALUES row 1, `c`: added value `3`',
    ],
  },
  {
    name: 'INSERT columns swapped',
    left: 'INSERT INTO users (id, email) VALUES (1, 2)',
    right: 'INSERT INTO users (email, id) VALUES (1, 2)',
    verdict: 'potentially-semantic',
    diffs: ['semantic moved major: INSERT column `email` moved from position 2 to 1'],
  },
  {
    name: 'INSERT without column list',
    left: 'INSERT INTO t VALUES (1, 2)',
    right: 'INSERT INTO t VALUES (1, 3)',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: VALUES row 1, value 2 changed: `2` → `3`'],
  },
  {
    name: 'INSERT target changed',
    left: 'INSERT INTO users (id) VALUES (1)',
    right: 'INSERT INTO accounts (id) VALUES (1)',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Table changed from `users` to `accounts`'],
  },
  {
    name: 'INSERT … SELECT changed',
    left: 'INSERT INTO archive (id) SELECT id FROM orders WHERE created_at < 100',
    right: 'INSERT INTO archive (id) SELECT id FROM orders WHERE created_at < 200',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: WHERE predicate changed: `created_at < 100` → `created_at < 200`',
    ],
  },
  {
    name: 'PostgreSQL ON CONFLICT action changed',
    only: 'postgresql',
    left: "INSERT INTO t (id, n) VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET n = EXCLUDED.n",
    right: "INSERT INTO t (id, n) VALUES (1, 'a') ON CONFLICT (id) DO NOTHING",
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: `ON CONFLICT (id) DO UPDATE SET` changed to `ON CONFLICT (id) DO NOTHING`',
      'semantic removed major: Removed assignment `n = EXCLUDED.n` from ON CONFLICT',
    ],
  },
  {
    name: 'PostgreSQL ON CONFLICT assignment changed',
    only: 'postgresql',
    left: 'INSERT INTO t (id, n) VALUES (1, 2) ON CONFLICT (id) DO UPDATE SET n = EXCLUDED.n',
    right:
      'INSERT INTO t (id, n) VALUES (1, 2) ON CONFLICT (id) DO UPDATE SET n = t.n + EXCLUDED.n',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: ON CONFLICT `n` changed: `EXCLUDED.n` → `t.n + EXCLUDED.n`'],
  },
  {
    name: 'MySQL ON DUPLICATE KEY UPDATE changed',
    only: 'mysql',
    left: 'INSERT INTO t (id, n) VALUES (1, 2) ON DUPLICATE KEY UPDATE n = VALUES(n)',
    right: 'INSERT INTO t (id, n) VALUES (1, 2) ON DUPLICATE KEY UPDATE n = n + VALUES(n)',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: ON DUPLICATE KEY UPDATE `n` changed: `VALUES(n)` → `n + VALUES(n)`',
    ],
  },
  {
    name: 'MySQL INSERT IGNORE',
    only: 'mysql',
    left: 'INSERT INTO t (a) VALUES (1)',
    right: 'INSERT IGNORE INTO t (a) VALUES (1)',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed minor: `INSERT INTO` changed to `INSERT IGNORE INTO`'],
  },
  {
    name: 'PostgreSQL RETURNING added',
    only: 'postgresql',
    left: 'INSERT INTO t (a) VALUES (1)',
    right: 'INSERT INTO t (a) VALUES (1) RETURNING id',
    verdict: 'potentially-semantic',
    diffs: ['semantic added minor: Added clause `RETURNING id`'],
  },

  // --- UPDATE ----------------------------------------------------------------
  {
    name: 'UPDATE assignment value changed',
    left: 'UPDATE products SET price = 10, stock = 5 WHERE id = 3',
    right: 'UPDATE products SET price = 12, stock = 5 WHERE id = 3',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: SET `price` changed: `10` → `12`'],
    ranges: [['10', '12']],
  },
  {
    name: 'UPDATE assignment added',
    left: 'UPDATE products SET price = 10 WHERE id = 3',
    right: 'UPDATE products SET price = 10, updated_at = now() WHERE id = 3',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added assignment `updated_at = now()` to SET'],
  },
  {
    name: 'UPDATE WHERE removed',
    left: 'UPDATE products SET price = 10 WHERE id = 3',
    right: 'UPDATE products SET price = 10',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed clause `WHERE id = 3`'],
  },
  {
    name: 'UPDATE WHERE changed',
    left: "UPDATE orders SET status = 'void' WHERE created_at < 100",
    right: "UPDATE orders SET status = 'void' WHERE created_at < 200",
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: WHERE predicate changed: `created_at < 100` → `created_at < 200`',
    ],
  },
  {
    name: 'UPDATE target changed',
    left: 'UPDATE products SET price = 1 WHERE id = 3',
    right: 'UPDATE items SET price = 1 WHERE id = 3',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Table changed from `products` to `items`'],
  },
  {
    name: 'PostgreSQL UPDATE … FROM',
    only: 'postgresql',
    left: 'UPDATE t SET a = u.a FROM u WHERE t.id = u.id',
    right: 'UPDATE t SET a = u.a FROM u WHERE t.id = u.t_id',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: WHERE predicate changed: `t.id = u.id` → `t.id = u.t_id`'],
  },
  {
    name: 'MySQL multi-table UPDATE join changed',
    only: 'mysql',
    left: 'UPDATE t JOIN u ON u.id = t.u_id SET t.a = u.a',
    right: 'UPDATE t LEFT JOIN u ON u.id = t.u_id SET t.a = u.a',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: JOIN `u` changed from INNER to LEFT'],
  },
  {
    name: 'MySQL UPDATE ORDER BY … LIMIT',
    only: 'mysql',
    left: 'UPDATE jobs SET taken = 1 ORDER BY id LIMIT 1',
    right: 'UPDATE jobs SET taken = 1 ORDER BY id LIMIT 5',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: LIMIT changed from `1` to `5`'],
  },

  // --- DELETE ----------------------------------------------------------------
  {
    name: 'DELETE WHERE changed',
    left: 'DELETE FROM sessions WHERE expires_at < 100',
    right: 'DELETE FROM sessions WHERE expires_at < 200',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: WHERE predicate changed: `expires_at < 100` → `expires_at < 200`',
    ],
  },
  {
    name: 'DELETE WHERE removed',
    left: 'DELETE FROM sessions WHERE expires_at < 100',
    right: 'DELETE FROM sessions',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed clause `WHERE expires_at < 100`'],
  },
  {
    name: 'DELETE target changed',
    left: 'DELETE FROM sessions WHERE id = 1',
    right: 'DELETE FROM tokens WHERE id = 1',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Table changed from `sessions` to `tokens`'],
  },
  {
    name: 'PostgreSQL DELETE … USING',
    only: 'postgresql',
    left: 'DELETE FROM t USING u WHERE t.id = u.id',
    right: 'DELETE FROM t USING v WHERE t.id = v.id',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Table changed from `u` to `v`',
      'semantic changed major: WHERE predicate changed: `t.id = u.id` → `t.id = v.id`',
    ],
  },
  {
    name: 'MySQL DELETE LIMIT added',
    only: 'mysql',
    left: 'DELETE FROM logs WHERE level = 1',
    right: 'DELETE FROM logs WHERE level = 1 LIMIT 1000',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added clause `LIMIT 1000`'],
  },

  // --- CREATE TABLE ------------------------------------------------------------
  {
    name: 'CREATE TABLE column added',
    left: 'CREATE TABLE users (id int, email text)',
    right: 'CREATE TABLE users (id int, email text, created_at timestamp)',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added column `created_at timestamp`'],
    ranges: [['', 'created_at timestamp']],
  },
  {
    name: 'CREATE TABLE column removed',
    left: 'CREATE TABLE users (id int, email text, legacy int)',
    right: 'CREATE TABLE users (id int, email text)',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed column `legacy int`'],
  },
  {
    name: 'CREATE TABLE column type changed',
    left: 'CREATE TABLE users (id int, email varchar(100))',
    right: 'CREATE TABLE users (id int, email varchar(255))',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Column `email` type changed from `varchar(100)` to `varchar(255)`',
    ],
    ranges: [['100', '255']],
  },
  {
    name: 'CREATE TABLE NOT NULL added',
    left: 'CREATE TABLE users (id int, email text)',
    right: 'CREATE TABLE users (id int, email text NOT NULL)',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Column `email`: added `NOT NULL`'],
  },
  {
    name: 'CREATE TABLE NULL to NOT NULL',
    left: 'CREATE TABLE users (id int, email text NULL)',
    right: 'CREATE TABLE users (id int, email text NOT NULL)',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Column `email` changed from NULL to NOT NULL'],
  },
  {
    name: 'CREATE TABLE default changed is minor',
    left: "CREATE TABLE t (id int, status varchar(10) DEFAULT 'new')",
    right: "CREATE TABLE t (id int, status varchar(10) DEFAULT 'open')",
    verdict: 'potentially-semantic',
    diffs: [
      "semantic changed minor: Column `status` DEFAULT changed: `DEFAULT 'new'` → `DEFAULT 'open'`",
    ],
  },
  {
    name: 'CREATE TABLE primary key added',
    left: 'CREATE TABLE t (id int, name text)',
    right: 'CREATE TABLE t (id int PRIMARY KEY, name text)',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Column `id`: added `PRIMARY KEY`'],
  },
  {
    name: 'CREATE TABLE foreign key action changed',
    left: 'CREATE TABLE o (id int, user_id int REFERENCES users (id) ON DELETE CASCADE)',
    right: 'CREATE TABLE o (id int, user_id int REFERENCES users (id) ON DELETE SET NULL)',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Column `user_id` constraint changed: `REFERENCES users (id) ON DELETE CASCADE` → `REFERENCES users (id) ON DELETE SET NULL`',
    ],
    ranges: [['CASCADE', 'SET NULL']],
  },
  {
    name: 'CREATE TABLE table constraint added',
    left: 'CREATE TABLE t (id int, email text)',
    right: 'CREATE TABLE t (id int, email text, CONSTRAINT t_email_key UNIQUE (email))',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added constraint `CONSTRAINT t_email_key UNIQUE (email)`'],
  },
  {
    name: 'CREATE TABLE named constraint changed',
    left: 'CREATE TABLE t (a int, b int, CONSTRAINT t_key UNIQUE (a))',
    right: 'CREATE TABLE t (a int, b int, CONSTRAINT t_key UNIQUE (a, b))',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Constraint `t_key` changed: `CONSTRAINT t_key UNIQUE (a)` → `CONSTRAINT t_key UNIQUE (a, b)`',
    ],
  },
  {
    name: 'CREATE TABLE column renamed',
    left: 'CREATE TABLE t (id int, mail text)',
    right: 'CREATE TABLE t (id int, email text)',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Column `mail` renamed to `email`'],
  },
  {
    name: 'CREATE TABLE column moved is minor',
    left: 'CREATE TABLE t (id int, a int, b int)',
    right: 'CREATE TABLE t (id int, b int, a int)',
    verdict: 'potentially-semantic',
    diffs: ['semantic moved minor: Column `a` moved from position 2 to 3'],
  },
  {
    name: 'CREATE TABLE IF NOT EXISTS',
    left: 'CREATE TABLE IF NOT EXISTS t (a int)',
    right: 'CREATE TABLE t (a int)',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed minor: `CREATE TABLE IF NOT EXISTS` changed to `CREATE TABLE`'],
  },
  {
    name: 'CREATE TABLE AS SELECT changed',
    left: 'CREATE TABLE top_users AS SELECT id FROM users WHERE score > 10',
    right: 'CREATE TABLE top_users AS SELECT id FROM users WHERE score > 20',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: WHERE predicate changed: `score > 10` → `score > 20`'],
  },
  {
    name: 'MySQL table options changed',
    only: 'mysql',
    left: 'CREATE TABLE t (id int) ENGINE=InnoDB DEFAULT CHARSET=utf8',
    right: 'CREATE TABLE t (id int) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed minor: Options changed from `ENGINE=InnoDB DEFAULT CHARSET=utf8` to `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`',
    ],
  },
  {
    name: 'MySQL column comment changed',
    only: 'mysql',
    left: "CREATE TABLE t (id int COMMENT 'key')",
    right: "CREATE TABLE t (id int COMMENT 'primary key')",
    verdict: 'potentially-semantic',
    diffs: [
      "semantic changed minor: Column `id` COMMENT changed: `COMMENT 'key'` → `COMMENT 'primary key'`",
    ],
  },
  {
    name: 'MySQL AUTO_INCREMENT added',
    only: 'mysql',
    left: 'CREATE TABLE t (id int NOT NULL, PRIMARY KEY (id))',
    right: 'CREATE TABLE t (id int NOT NULL AUTO_INCREMENT, PRIMARY KEY (id))',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Column `id`: added `AUTO_INCREMENT`'],
  },
  {
    name: 'PostgreSQL migration-style table',
    only: 'postgresql',
    left: `CREATE TABLE orders (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id),
  total numeric(10, 2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    right: `CREATE TABLE orders (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id),
  total numeric(12, 2) DEFAULT 0,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Column `total` type changed from `numeric(10, 2)` to `numeric(12, 2)`',
      "semantic added major: Added column `status text NOT NULL DEFAULT 'new'`",
    ],
  },

  // --- ALTER TABLE -------------------------------------------------------------
  {
    name: 'ALTER TABLE add column type changed',
    left: 'ALTER TABLE users ADD COLUMN age int',
    right: 'ALTER TABLE users ADD COLUMN age bigint',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Action changed: `ADD COLUMN age int` → `ADD COLUMN age bigint`',
    ],
    ranges: [['int', 'bigint']],
  },
  {
    name: 'ALTER TABLE action removed',
    left: 'ALTER TABLE users ADD COLUMN age int, DROP COLUMN legacy',
    right: 'ALTER TABLE users DROP COLUMN legacy',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed action `ADD COLUMN age int`'],
  },
  {
    name: 'ALTER TABLE action added',
    left: 'ALTER TABLE users ADD COLUMN age int',
    right: 'ALTER TABLE users ADD COLUMN age int, ADD COLUMN city text',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added action `ADD COLUMN city text`'],
  },
  {
    name: 'ALTER TABLE constraint changed',
    left: 'ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email)',
    right: 'ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email, tenant_id)',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Action changed: `ADD CONSTRAINT users_email_key UNIQUE (email)` → `ADD CONSTRAINT users_email_key UNIQUE (email, tenant_id)`',
    ],
  },
  {
    name: 'ALTER TABLE rename target changed',
    left: 'ALTER TABLE users RENAME COLUMN mail TO email',
    right: 'ALTER TABLE users RENAME COLUMN mail TO email_address',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Action changed: `RENAME COLUMN mail TO email` → `RENAME COLUMN mail TO email_address`',
    ],
  },
  {
    name: 'ALTER TABLE target changed',
    left: 'ALTER TABLE users ADD COLUMN age int',
    right: 'ALTER TABLE members ADD COLUMN age int',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Table changed from `users` to `members`'],
  },
  {
    name: 'PostgreSQL ALTER COLUMN SET/DROP NOT NULL',
    only: 'postgresql',
    left: 'ALTER TABLE users ALTER COLUMN email SET NOT NULL',
    right: 'ALTER TABLE users ALTER COLUMN email DROP NOT NULL',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Action changed: `ALTER COLUMN email SET NOT NULL` → `ALTER COLUMN email DROP NOT NULL`',
    ],
  },
  {
    name: 'MySQL MODIFY COLUMN changed',
    only: 'mysql',
    left: 'ALTER TABLE users MODIFY COLUMN email varchar(100) NOT NULL',
    right: 'ALTER TABLE users MODIFY COLUMN email varchar(255) NOT NULL',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed major: Action changed: `MODIFY COLUMN email varchar(100) NOT NULL` → `MODIFY COLUMN email varchar(255) NOT NULL`',
    ],
  },

  // --- CREATE INDEX / VIEW -----------------------------------------------------
  {
    name: 'CREATE INDEX unique and column added',
    left: 'CREATE INDEX idx_users_email ON users (email)',
    right: 'CREATE UNIQUE INDEX idx_users_email ON users (email, tenant_id)',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed minor: `CREATE INDEX` changed to `CREATE UNIQUE INDEX`',
      'semantic added major: Added index column `tenant_id`',
    ],
  },
  {
    name: 'CREATE INDEX table changed',
    left: 'CREATE INDEX idx_a ON users (a)',
    right: 'CREATE INDEX idx_a ON members (a)',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Indexed table changed from `users` to `members`'],
  },
  {
    name: 'PostgreSQL partial index condition changed',
    only: 'postgresql',
    left: 'CREATE INDEX idx_open ON orders (created_at) WHERE status = 1',
    right: 'CREATE INDEX idx_open ON orders (created_at) WHERE status = 2',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: WHERE predicate changed: `status = 1` → `status = 2`'],
  },
  {
    name: 'CREATE VIEW query changed',
    left: 'CREATE VIEW active_users AS SELECT id FROM users WHERE active',
    right: 'CREATE OR REPLACE VIEW active_users AS SELECT id, email FROM users WHERE active',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic changed minor: `CREATE VIEW` changed to `CREATE OR REPLACE VIEW`',
      'semantic added major: Added column `email` to SELECT',
    ],
  },

  // --- Scripts -------------------------------------------------------------------
  {
    name: 'statement added',
    left: 'CREATE TABLE a (x int);\nINSERT INTO a VALUES (1);',
    right: 'CREATE TABLE a (x int);\nINSERT INTO a VALUES (1);\nDROP TABLE a;',
    verdict: 'potentially-semantic',
    diffs: ['semantic added major: Added statement `DROP TABLE a`'],
    ranges: [['', 'DROP TABLE a']],
  },
  {
    name: 'statement removed',
    left: 'SELECT a FROM t;\nDELETE FROM t;\nSELECT b FROM u;',
    right: 'SELECT a FROM t;\nSELECT b FROM u;',
    verdict: 'potentially-semantic',
    diffs: ['semantic removed major: Removed statement `DELETE FROM t`'],
  },
  {
    name: 'statement moved',
    left: 'CREATE TABLE a (x int);\nCREATE TABLE b (y int);\nCREATE TABLE c (z int);',
    right: 'CREATE TABLE c (z int);\nCREATE TABLE a (x int);\nCREATE TABLE b (y int);',
    verdict: 'potentially-semantic',
    diffs: ['semantic moved minor: Statement `CREATE TABLE c (z int)` moved from position 3 to 1'],
  },
  {
    name: 'statement moved and edited',
    left: 'UPDATE a SET x = 1 WHERE id = 1;\nDELETE FROM b WHERE id = 2;\nINSERT INTO c (z) VALUES (3);',
    right:
      'INSERT INTO c (z) VALUES (3);\nUPDATE a SET x = 1 WHERE id = 1;\nDELETE FROM b WHERE id = 20;',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic moved minor: Statement `INSERT INTO c (z) VALUES (3)` moved from position 3 to 1',
      'semantic changed major: WHERE predicate changed: `id = 2` → `id = 20`',
    ],
  },
  {
    name: 'statement kind changed',
    left: 'SELECT * FROM t WHERE id = 1',
    right: 'DELETE FROM t WHERE id = 1',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Statement changed from SELECT to DELETE'],
  },
  {
    name: 'one statement reformatted, another changed',
    left: 'SELECT a FROM t;\nUPDATE t SET a = 1;',
    right: 'select a\nfrom t;\nUPDATE t SET a = 2;',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: SET `a` changed: `1` → `2`'],
  },
  {
    name: 'statements edited in place',
    left: 'SELECT 1;\nSELECT 2;\nSELECT 3;',
    right: 'SELECT 1;\nSELECT 20;\nSELECT 3;',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed minor: Column changed: `2` → `20`'],
  },

  // --- Unparsed ------------------------------------------------------------------
  {
    name: 'syntax error degrades to an unknown token diff',
    left: 'SELECT a FROM t WHERE',
    right: 'SELECT b FROM t WHERE',
    verdict: 'unknown',
    diffs: ['unknown changed major: Changed `a` → `b`'],
  },
  {
    name: 'only the unparsed statement is unknown',
    left: 'SELECT a FROM t;\nSELEC b FROM u;',
    right: 'SELECT a FROM t WHERE x = 1;\nSELEC c FROM u;',
    verdict: 'potentially-semantic',
    diffs: [
      'semantic added major: Added clause `WHERE x = 1`',
      'unknown changed major: Changed `b` → `c`',
    ],
  },
  {
    name: 'MySQL procedure body is compared as text',
    only: 'mysql',
    left: 'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\nDELIMITER ;',
    right: 'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 2; END$$\nDELIMITER ;',
    verdict: 'unknown',
    diffs: ['unknown changed major: Changed `1` → `2`'],
  },
  {
    name: 'PostgreSQL function body is compared as text',
    only: 'postgresql',
    left: 'CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql',
    right: 'CREATE FUNCTION f() RETURNS int AS $$ SELECT 2 $$ LANGUAGE sql',
    verdict: 'potentially-semantic',
    diffs: ['semantic changed major: Changed `$$ SELECT 1 $$` → `$$ SELECT 2 $$`'],
  },
];
