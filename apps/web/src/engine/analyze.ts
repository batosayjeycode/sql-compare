import { compare, loadParser, type CompareOptions, type ComparisonResult } from '@sql-compare/core';

export interface EngineResponse {
  result: ComparisonResult;
  /** Set when structural analysis was unavailable (e.g. the parser failed to load). */
  warning: string | null;
  /** Time spent comparing (parser loading excluded), in ms. */
  durationMs?: number;
}

/** Parse + compare. Runs inside the worker, or in-process where Workers don't exist. */
export async function analyze(
  left: string,
  right: string,
  options: CompareOptions,
): Promise<EngineResponse> {
  try {
    const parser = await loadParser(options.dialect);
    const start = performance.now();
    const result = compare(left, right, options, parser);
    return { result, warning: null, durationMs: Math.round(performance.now() - start) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      result: compare(left, right, options, null),
      warning: `The SQL parser couldn't load (${reason}). Showing a token comparison only.`,
    };
  }
}
