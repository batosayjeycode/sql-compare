import { wrap, type Remote } from 'comlink';
import type { CompareOptions } from '@sql-compare/core';
import type { EngineResponse } from './analyze';
import type { EngineApi } from './engine.worker';

export type { EngineResponse } from './analyze';

/** Longest a comparison may take before the worker is considered stuck. */
export const ENGINE_TIMEOUT_MS = 15_000;

export interface Engine {
  compare(left: string, right: string, options: CompareOptions): Promise<EngineResponse>;
  dispose(): void;
}

async function tokenOnly(
  left: string,
  right: string,
  options: CompareOptions,
  why: string,
): Promise<EngineResponse> {
  const { tokenOnlyCompare } = await import('./tokenOnly');
  return {
    result: tokenOnlyCompare(left, right, options),
    warning: `${why} Showing a token comparison only; structural analysis will retry on the next change.`,
  };
}

/**
 * Comparison engine in a Web Worker (NFR Performance: the UI never blocks).
 * If the worker crashes or exceeds the timeout it is replaced, and that one
 * comparison falls back to a token-only diff on the main thread.
 */
function createWorkerEngine(): Engine {
  let worker: Worker | null = null;
  let remote: Remote<EngineApi> | null = null;
  let crashed: Promise<never> | null = null;

  const start = () => {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    remote = wrap<EngineApi>(worker);
    const w = worker;
    crashed = new Promise<never>((_, reject) => {
      w.addEventListener('error', (e) => reject(new Error(e.message || 'Worker crashed')));
    });
    crashed.catch(() => undefined);
  };

  const stop = () => {
    worker?.terminate();
    worker = null;
    remote = null;
    crashed = null;
  };

  return {
    async compare(left, right, options) {
      if (!remote) start();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ENGINE_TIMEOUT_MS);
      });
      try {
        return await Promise.race([remote!.analyze(left, right, options), crashed!, timeout]);
      } catch (err) {
        stop();
        const why =
          err instanceof Error && err.message === 'timeout'
            ? 'The comparison took too long and was stopped.'
            : 'The comparison engine stopped unexpectedly.';
        return await tokenOnly(left, right, options, why);
      } finally {
        clearTimeout(timer);
      }
    },
    dispose: stop,
  };
}

/** Same API without a worker (tests, environments without Worker support). */
function createInProcessEngine(): Engine {
  return {
    compare: async (left, right, options) => {
      try {
        // Loaded on demand: browsers with Worker support never need it.
        const { analyze } = await import('./analyze');
        return await analyze(left, right, options);
      } catch {
        return tokenOnly(left, right, options, 'The comparison engine failed.');
      }
    },
    dispose: () => undefined,
  };
}

export function createEngine(): Engine {
  return typeof Worker === 'undefined' ? createInProcessEngine() : createWorkerEngine();
}
