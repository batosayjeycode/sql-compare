# Normalization (M4)

Normalization decides whether a token-level change is **structural** (equivalent under the active rules) or **potentially semantic**. Rules live in `packages/core/src/normalize/rules/`, one file per rule, each declaring its level, dialects and safety. They are listed in the UI under **Normalize** and in **Transformations applied**.

## How a rule is applied

1. Each statement is split into significant tokens. A rule rewrites, drops or reorders tokens, never merging or splitting them, so every normalized token still points to its source position.
2. **L1** (whitespace, comments, statement terminators) works on the token stream and needs no proof.
3. **L2 and L3** rules are applied only to statements the dialect parser accepted. After applying a group of rules, the statement is printed and re-parsed. It is kept only if its AST equals the original AST modulo what the rules are meant to change:
   - always ignored: positions, grouping parentheses, and AND/OR nesting (associativity)
   - `caseInsensitiveColumns` (MySQL identifier/keyword case): column names, column aliases and function names compare case-insensitively; table names do not
   - `commutative` (L3): operands of AND/OR, `=`, literal IN lists, GROUP BY, PARTITION BY and comma-joined FROM lists compare as sets, but **only when the operands are pure** (no function calls, no subqueries)

   If the group fails, rules are retried one at a time and only the failing ones are rolled back for that statement. The rollback is listed in **Transformations applied → Not applied**.

4. **Classification:** a raw change is structural when none of its tokens still differ after normalizing both sides, and a rule touched one of them (or the normalized inputs are identical overall). It is formatting when only L1 rules explain it. As a safety net, if the normalized inputs still differ but no change ended up semantic, all candidate changes revert to semantic.
5. **L3 dry run:** at L2, L3 runs as a dry run, and semantic changes it would resolve get a hint ("may be structural under aggressive normalization").

## Never normalized

These are reported as potentially semantic at every level:

- SELECT column order
- ORDER BY items
- UNION branches
- outer-join order
- numeric literal form (`1.0` vs `1.00`)
- AND/OR chains containing function calls or subqueries (short-circuit and side effects)

## Differences from the PLAN §5.4 table

- **L1 whitespace and comments can't be turned off.** They define what "formatting" means, and the Normalized view never shows them. Terminators can be turned off.
- **The "canonical synonyms" row is three rules** (join keywords, `!=`/`<>`, optional `AS`), so each can be toggled separately.
- **Sort INNER JOIN / comma-joined tables:** only comma-joined `FROM a, b` lists are sorted (no JOINs or LATERAL in that FROM clause, no `SELECT *`). Reordering explicit `INNER JOIN … ON` chains would need moving ON conditions and is not implemented.
- **MySQL table names** compare case-sensitively unless _Table names are case-insensitive_ (`lower_case_table_names`) is turned on.
- **Database-backed semantic tests** (PLAN §8, optional, CI-only) are not set up. Equivalence is checked against the parser's AST, plus property tests over generated queries.
