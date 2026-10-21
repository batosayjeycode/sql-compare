import type { DiffClass, Verdict } from './types.js';

/**
 * Derive the overall verdict from per-class counts.
 * Precedence: unknown/semantic > structural > formatting > identical.
 */
export function deriveVerdict(stats: Record<DiffClass, number>): Verdict {
  if (stats.semantic > 0) return 'potentially-semantic';
  if (stats.unknown > 0) return 'unknown';
  if (stats.structural > 0) return 'structural-only';
  if (stats.formatting > 0) return 'formatting-only';
  return 'identical';
}

export function emptyStats(): Record<DiffClass, number> {
  return { formatting: 0, structural: 0, semantic: 0, unknown: 0 };
}
