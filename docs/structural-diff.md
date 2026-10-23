# Structural diff and classification (M5)

`compare()` (`packages/core/src/compare.ts`) turns two SQL inputs into a list of differences. Each difference gets:

- a class (formatting / structural / semantic / unknown)
- a severity (info / minor / major)
- a path, e.g. `['SELECT', 'FROM', 'orders', 'join type']`
- a human-readable description, e.g. "JOIN `orders` changed from INNER to LEFT"
- source ranges on both sides

## Pipeline

1. **Split, parse and normalize** each input (M3, M4).
2. **Align statements** (`diff/align.ts`).
   - Statements are aligned by similarity with an order-preserving weighted LCS. Statements of different kinds never align, except when each input is a single statement (then the difference is "Statement changed from SELECT to DELETE"). Same kind and same target object (`ALTER TABLE users …`) counts as at least 0.6 similar; otherwise similarity is the Jaccard of token bigrams, with a 0.3 threshold.
   - Statements with no counterpart that sit between aligned ones are paired when there are as many on each side, of the same kinds, in the same order (`SELECT 2` → `SELECT 20`).
   - A leftover statement that is identical to, or ≥ 0.5 similar to, a leftover on the other side is a moved statement. Moved and edited statements are reported once as moved, plus their edits.
   - For large inputs (more than 40 000 statement pairs to score), statements identical after normalization are anchored first, and the similarity alignment runs only between anchors.
3. **Token diff per aligned pair.** Statements in place are diffed together, so whitespace between them is still checked. A moved statement is diffed on its own. Whitespace, comment and keyword-case changes are formatting.
4. **Classify candidates** exactly as in M4 (see [normalization.md](./normalization.md)), but per pair. A change that disappears after normalizing both statements is structural (formatting if only L1 rules explain it), and lists the rules that resolved it.
5. **Describe what is left** (`diff/model.ts`, `diff/structural.ts`). When both statements parsed, a clause model is built from each statement's normalized tokens. The two models are then compared clause by clause.
   - Only changes whose items still differ after normalization are kept, so the description can never contradict the classification.
   - Token-level changes that no kept change explains stay as they are ("Changed `x` → `y`"), with the clause they are in as their path. Leftover separators of a described list edit (`,` `(` `)` `AND`) are dropped.
6. **Statements that couldn't be parsed** keep the token-level description and are classified `unknown`. A whole statement added, removed or moved is always `semantic`, even when it couldn't be parsed.
7. **L3 hints** are attached as in M4.

## Clause model

The parsers' ASTs differ completely: libpg-query returns PostgreSQL's parse tree, node-sql-parser returns its own JSON. The differ instead uses one dialect-neutral clause model. It is built from the normalized tokens of statements the parser accepted. Every item keeps token ranges, and tokens keep their source positions, so every difference maps back to exact ranges in the original text.

| Statement           | Modeled as                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SELECT              | `WITH` (CTEs, each with its own nested model), select list, `FROM` (tables, join type, alias, `ON`/`USING` predicates, derived tables with nested models), `WHERE`, `GROUP BY`, `HAVING`, `WINDOW`, `QUALIFY`, `ORDER BY` (expression plus direction), `LIMIT`, `OFFSET`, `FETCH`, locking. Also set operations (branches plus operators; a trailing `ORDER BY`/`LIMIT` applies to the whole set operation). |
| INSERT / REPLACE    | Target, column list, `VALUES` rows (values per position, named after the column list), `INSERT … SELECT` (nested model), `ON CONFLICT … DO UPDATE SET` / `ON DUPLICATE KEY UPDATE` assignments, `RETURNING`.                                                                                                                                                                                                 |
| UPDATE              | Target and alias (MySQL multi-table targets as a table list), `SET` assignments, `FROM`, `WHERE`, `ORDER BY`, `LIMIT`, `RETURNING`.                                                                                                                                                                                                                                                                          |
| DELETE              | Target, `USING` (or the MySQL multi-table `FROM`), `WHERE`, `ORDER BY`, `LIMIT`, `RETURNING`.                                                                                                                                                                                                                                                                                                                |
| CREATE TABLE        | Head (`TEMP`, `IF NOT EXISTS`), name, column definitions (type plus constraints: nullability, `DEFAULT`, `PRIMARY KEY`, `REFERENCES … ON DELETE …`, `CHECK`, `COLLATE`, `AUTO_INCREMENT`, `COMMENT`, …), table constraints, options, `AS SELECT`.                                                                                                                                                            |
| ALTER TABLE         | Name and actions, keyed by what they act on (`ADD COLUMN email`, `DROP CONSTRAINT c`, `ALTER COLUMN x`, …).                                                                                                                                                                                                                                                                                                  |
| CREATE INDEX / VIEW | Index: head (`UNIQUE`), name, table, method, columns (with direction) and partial-index `WHERE`. View: head (`OR REPLACE`), name, column list and the query.                                                                                                                                                                                                                                                 |
| Anything else       | Statement kind only. Changes keep their token-level description.                                                                                                                                                                                                                                                                                                                                             |

## Matching keys

| Items                                             | Matched by (in order)                            |
| ------------------------------------------------- | ------------------------------------------------ |
| Select items, RETURNING                           | expression + alias, expression, alias            |
| Tables                                            | name + alias, name, alias                        |
| Predicates (WHERE / HAVING / ON)                  | canonical text, left operand (`x = 1` ↔ `x = 2`) |
| GROUP BY, ORDER BY, index columns, INSERT columns | expression or name                               |
| Assignments                                       | target column                                    |
| Column definitions / constraints                  | column name / constraint name (or text)          |
| ALTER TABLE actions                               | verb + object + name                             |
| CTEs                                              | name                                             |
| VALUES rows, set-operation branches               | order (LCS over their text)                      |

Items left over on both sides in equal numbers are paired in order: a changed item, not a removed and an added one. Of identical items, those outside the longest common order are reported as moved. When there is a choice, the moved items are the ones the normalized token diff also marks as different, so comparing B with A reports the same items as A with B.

## Severity table

`diff/severity.ts`; the full table is the source of truth. Formatting and structural differences are always `info`.

| Major                                                                        | Minor                                                                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Statement added, removed or changed kind; target object changed              | Statement moved                                                                                    |
| Column added, removed or changed (SELECT)                                    | Literal-only change in the SELECT list; alias renamed; column moved                                |
| Table added, removed or swapped; join type; join condition; outer-join order | Inner/comma-join order; table alias                                                                |
| WHERE / HAVING / ON predicate added, removed or changed, literals included   | Predicate order                                                                                    |
| GROUP BY item added or removed                                               | GROUP BY order                                                                                     |
| ORDER BY changes when `LIMIT`/`OFFSET`/`FETCH` picks rows by it              | ORDER BY changes otherwise                                                                         |
| LIMIT, OFFSET, FETCH, locking, `INTO`                                        | RETURNING                                                                                          |
| `DISTINCT`; set operator (`UNION` ↔ `UNION ALL`); branch added or removed    | Branch order                                                                                       |
| CTE added, removed or changed                                                |                                                                                                    |
| INSERT column added, removed or moved; VALUES row or value; assignments      | Assignment order                                                                                   |
| Column added, removed, renamed or retyped; constraints; ALTER actions        | `DEFAULT`, `COMMENT`, column order, table options, `IF NOT EXISTS`/`OR REPLACE`/`IGNORE` modifiers |
|                                                                              | Numeric literal form (`1.0` → `1.00`); optimizer hints                                             |

## Golden corpus

`packages/core/test/golden/corpus.ts` holds 138 hand-written pairs: 110 shared, 15 PostgreSQL-only and 13 MySQL-only. That gives 125 PostgreSQL runs and 123 MySQL runs, covering formatting, structural, L3, SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, ALTER TABLE, CREATE INDEX/VIEW, scripts and unparsed input. Each case lists the verdict and every non-formatting difference (class, kind, severity, description), and some list the highlighted ranges. The test also checks every case in reverse (symmetry), and that every difference has valid source ranges on both sides.

## Limits

- Descriptions are only as fine as the clause model. A change deep inside an expression is described at the item level ("WHERE predicate changed: `…` → `…`"), with the highlight narrowed to the differing tokens. Subqueries are described recursively in `FROM`, CTEs, `INSERT … SELECT` and `CREATE … AS`, but not inside `WHERE … IN (SELECT …)`.
- Procedural code (function and procedure bodies, `DO` blocks) is compared as text.
- Source ranges are offsets in the original text. The M6 highlight layer maps them into the Formatted and Normalized views; see [summary-navigation.md](./summary-navigation.md).
- PLAN §8 suggests about 200 pairs per dialect. The corpus has about 125 per dialect, chosen to cover each statement type and each rule. It should grow during M8 dogfooding with real migrations.
