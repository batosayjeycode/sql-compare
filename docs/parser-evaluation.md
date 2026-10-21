# Parser evaluation (M3)

PLAN §5.1 left the PostgreSQL parser open until M3: `node-sql-parser`, `pgsql-ast-parser`, or `libpg-query` (the real PostgreSQL parser compiled to WebAssembly). This records how they compared and what we chose.

## Method

Each candidate parsed the same corpus in Node:

- **40 valid PostgreSQL statements** covering what real queries and migrations use: CTEs (recursive), window functions, `FILTER`, `GROUPING SETS`, `DISTINCT ON`, `LATERAL`, JSON/array operators, casts, `ON CONFLICT … RETURNING`, `UPDATE … FROM`, `DELETE … USING`, `MERGE`, DDL (tables, indexes, views, materialized views, enums, triggers, functions, extensions, grants, comments), `DO` blocks, `EXPLAIN`, `SET`, `VALUES`, `FOR UPDATE SKIP LOCKED`, E-strings and dollar quotes.
- **4 invalid statements**, to check that errors are reported with a usable position and message.

Bundle sizes are minified and gzipped, as shipped.

## Results: PostgreSQL

| Parser                | Valid statements parsed | Error position                        | Error message                                                           | Size (gz)                       | License    |
| --------------------- | ----------------------- | ------------------------------------- | ----------------------------------------------------------------------- | ------------------------------- | ---------- |
| **libpg-query 18.1**  | **40 / 40**             | exact (offset of the offending token) | `syntax error at or near "FROM"`, the same message as PostgreSQL itself | 346 KB (330 KB WASM + 16 KB JS) | MIT        |
| pgsql-ast-parser 12.0 | 32 / 40                 | line/column of the offending token    | nearley dump of expected tokens                                         | 41 KB                           | MIT        |
| node-sql-parser 5.4   | 31 / 40                 | sometimes one token late              | `Expected "!=", "!~", … but "x" found.`                                 | 56 KB                           | Apache-2.0 |

What each one failed on:

- **pgsql-ast-parser:** `DELETE … USING … RETURNING`, mixed `UNION … EXCEPT`, `GRANT … ON ALL TABLES IN SCHEMA`, `GROUPING SETS`, `CREATE TRIGGER`, E-strings with escaped quotes, `MERGE`, `EXPLAIN ANALYZE`.
- **node-sql-parser:** `DELETE … USING … RETURNING`, `DO` blocks, `CREATE MATERIALIZED VIEW`, `GROUPING SETS`, `FOR UPDATE SKIP LOCKED`, `SET search_path`, `MERGE`, `EXPLAIN`, bare `VALUES`.

## Decision

**PostgreSQL → libpg-query.** It is the actual PostgreSQL grammar, so coverage is complete by construction and errors read exactly like the database's own. Its size is acceptable because the parser runs in the comparison worker and is fetched only when the PostgreSQL dialect is used; the initial bundle is unaffected.

**MySQL / MariaDB → node-sql-parser (MySQL grammar).** It passed 17/20 of a MySQL corpus. The three misses were `CREATE PROCEDURE … BEGIN … END`, `FORCE INDEX`, and `SET NAMES`. To keep known grammar gaps from being reported as user errors:

- Stored-program bodies are detected by the statement splitter and compared as text.
- When a statement fails to parse and its kind is one the grammar doesn't cover (`SET`, `GRANT`, …), it is marked _unsupported_ (compared as text) rather than _error_.
- Error messages are rewritten to `Syntax not recognized near "…"`, pointing at the next token.

Both sit behind the `ParserAdapter` interface (`packages/core/src/parse.ts`), so either can be swapped, and further dialects added, without touching the comparison engine.

## Notes for later milestones

- **Offsets:** libpg-query reports AST locations as **UTF-8 byte offsets** and error positions as **character (code point) offsets**. The adapter converts error positions to UTF-16 indices; AST locations need the byte→UTF-16 conversion when M5 maps AST diffs back to source ranges.
- **Re-printing (M4):** libpg-query has no deparser. Re-printing normalized PostgreSQL for the re-parse check needs `pgsql-deparser`, which works on libpg-query's AST. node-sql-parser has `sqlify` built in.
- **Loading the WASM:** in a worker, Emscripten resolves `libpg-query.wasm` relative to the worker script. `apps/web/vite.config.ts` emits it next to the worker chunk in builds and serves it in dev.
- **CSP (M7):** compiling WebAssembly requires `'wasm-unsafe-eval'` in `script-src` once the strict CSP is added.
