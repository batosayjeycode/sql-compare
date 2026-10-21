import { tokenDiff } from './diff/token.js';
import { deriveVerdict, emptyStats } from './verdict.js';
import type { CompareOptions, ComparisonResult } from './types.js';

/**
 * Compare two SQL inputs.
 *
 * M2: token-level comparison only. Every difference is either `formatting`
 * (whitespace, comments, keyword case) or potentially `semantic`. Parsing,
 * normalization (structural) and statement alignment arrive in M3–M5.
 */
export function compare(left: string, right: string, options: CompareOptions): ComparisonResult {
  const differences = left === right ? [] : tokenDiff(left, right, options.dialect);
  const stats = emptyStats();
  for (const d of differences) stats[d.class]++;
  return {
    verdict: deriveVerdict(stats),
    stats,
    differences,
    transformations: [],
    errors: [],
    views: { left: { original: left }, right: { original: right } },
  };
}
