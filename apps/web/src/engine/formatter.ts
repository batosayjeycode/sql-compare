import { wrap, type Remote } from 'comlink';
import type { Dialect, FormatOptions, FormatResult } from '@sql-compare/core';
import type { FormatApi } from './format.worker';

/**
 * Formatting off the main thread: pretty-printing a 10k-line file takes most
 * of a second, so it runs in its own worker (separate from comparisons, so
 * neither waits for the other). Without Worker support (tests) it runs in
 * process, loaded on demand.
 */
export interface Formatter {
  format(text: string, dialect: Dialect, options: FormatOptions): Promise<FormatResult>;
}

let instance: Formatter | null = null;

function workerFormatter(): Formatter {
  let remote: Remote<FormatApi> | null = null;
  return {
    async format(text, dialect, options) {
      remote ??= wrap<FormatApi>(
        new Worker(new URL('./format.worker.ts', import.meta.url), { type: 'module' }),
      );
      try {
        return await remote.format(text, dialect, options);
      } catch (err) {
        remote = null;
        return {
          ok: false,
          reason: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

function inProcessFormatter(): Formatter {
  return {
    async format(text, dialect, options) {
      const { formatSql } = await import('./formatInProcess');
      return formatSql(text, dialect, options);
    },
  };
}

export function getFormatter(): Formatter {
  instance ??= typeof Worker === 'undefined' ? inProcessFormatter() : workerFormatter();
  return instance;
}
