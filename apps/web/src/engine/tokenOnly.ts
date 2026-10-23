// Loaded on demand: the main bundle doesn't carry the comparison engine.
import { compare, type CompareOptions } from '@sql-compare/core';

export function tokenOnlyCompare(left: string, right: string, options: CompareOptions) {
  return compare(left, right, options, null);
}
