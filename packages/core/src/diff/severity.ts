import type { Severity } from '../types.js';

/**
 * Severity table (PLAN §5.5 step 4, FR-4.2). Every semantic difference is
 * tagged with an aspect, i.e. what changed, and its severity comes from here.
 * Formatting and structural differences are always `info`.
 *
 * - major: can change which rows are read or written, or the schema
 * - minor: changes the shape or presentation of the result, or metadata
 */
export const SEVERITY = {
  // Statements
  'statement.added': 'major',
  'statement.removed': 'major',
  'statement.kind': 'major',
  /** Scripts run in order, but a moved identical statement is usually harmless. */
  'statement.moved': 'minor',
  'statement.target': 'major',
  /** Modifiers such as `IF NOT EXISTS`, `TEMP`, `IGNORE`. */
  'statement.modifier': 'minor',
  /** Change the parsed statement couldn't attribute to a clause. */
  'statement.other': 'major',

  // Clauses
  'clause.added': 'major',
  'clause.removed': 'major',
  'clause.head': 'major',

  // SELECT list / RETURNING
  'select.column': 'major',
  'select.expression': 'major',
  /** PLAN §5.5: a literal change is minor in the SELECT list (it doesn't filter rows). */
  'select.literal': 'minor',
  'select.alias': 'minor',
  /** Reordering columns changes the result shape, not the rows. */
  'select.moved': 'minor',
  'select.distinct': 'major',
  /** RETURNING only shapes what the statement reports back. */
  returning: 'minor',

  // FROM / joins
  'from.table': 'major',
  'from.join-type': 'major',
  'from.condition': 'major',
  'from.alias': 'minor',
  /** Inner-join order doesn't change the rows; outer-join order can (`from.moved-outer`). */
  'from.moved': 'minor',
  'from.moved-outer': 'major',

  // Predicates (WHERE / HAVING / ON), literal changes included
  predicate: 'major',
  'predicate.moved': 'minor',

  // GROUP BY
  'group.item': 'major',
  'group.moved': 'minor',

  // ORDER BY: ordering only, unless LIMIT/OFFSET/FETCH picks rows by it
  'order.item': 'minor',
  'order.limited': 'major',

  // LIMIT, OFFSET, FETCH, locking, INTO, …
  value: 'major',

  // Set operations
  'set.operator': 'major',
  'set.branch': 'major',
  'set.moved': 'minor',

  // CTEs
  'cte.added': 'major',
  'cte.removed': 'major',
  'cte.changed': 'major',
  'cte.moved': 'minor',

  // INSERT / UPDATE
  'insert.column': 'major',
  /** Moving an INSERT column changes which value goes where. */
  'insert.moved': 'major',
  'insert.row': 'major',
  'insert.value': 'major',
  assignment: 'major',
  'assignment.moved': 'minor',

  // CREATE TABLE / ALTER TABLE / CREATE INDEX
  'ddl.column': 'major',
  'ddl.type': 'major',
  'ddl.constraint': 'major',
  'ddl.default': 'minor',
  'ddl.comment': 'minor',
  'ddl.moved': 'minor',
  'ddl.options': 'minor',
  'ddl.action': 'major',
  'ddl.action-moved': 'minor',
  'index.column': 'major',

  /** `1.0` vs `1.00`: same value, possibly a different type or precision. */
  'numeric-form': 'minor',
  /** Optimizer hints change plans, not results. */
  hint: 'minor',
} as const satisfies Record<string, Severity>;

export type Aspect = keyof typeof SEVERITY;

export function severityOf(aspect: Aspect): Severity {
  return SEVERITY[aspect];
}
