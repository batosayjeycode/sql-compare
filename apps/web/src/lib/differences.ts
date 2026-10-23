import type { ComparisonResult, DiffClass, Difference } from '@sql-compare/core';
import { useCompareStore, type FilterClass, type Filters } from '../store/compare';

/** Filter a class belongs to: unknown changes are shown with semantic ones. */
export const filterOf = (c: DiffClass): FilterClass => (c === 'unknown' ? 'semantic' : c);

/** Differences the filters let through, in order (FR-5.3). */
export function visibleDifferences(
  result: ComparisonResult | null,
  filters: Filters,
): Difference[] {
  return result ? result.differences.filter((d) => filters[filterOf(d.class)]) : [];
}

/** The difference after (or before) `current` among `list`, wrapping around. */
export function stepDifference(
  list: Difference[],
  current: string | null,
  direction: 1 | -1,
): Difference | null {
  if (list.length === 0) return null;
  const index = list.findIndex((d) => d.id === current);
  if (index === -1) return direction === 1 ? list[0]! : list[list.length - 1]!;
  return list[(index + direction + list.length) % list.length]!;
}

/** Select the next / previous visible difference and scroll to it (n/p, F7). */
export function goToDifference(direction: 1 | -1) {
  const { result, filters, activeDiff, setActiveDiff } = useCompareStore.getState();
  const next = stepDifference(visibleDifferences(result, filters), activeDiff, direction);
  if (next) setActiveDiff(next.id, true);
}
