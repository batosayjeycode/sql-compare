import { useEffect, useState } from 'react';
import type { Dialect, FormatOptions, FormatResult } from '@sql-compare/core';
import { getFormatter } from '../engine/formatter';
import { useCompareStore, type Side, type SideView } from '../store/compare';

export interface SideDisplay {
  /** Text the editor should show. */
  text: string;
  /** The view actually shown (falls back to 'original' when unavailable). */
  mode: SideView;
  /** Formatted and normalized views are read-only; edits go to the original. */
  readOnly: boolean;
  /** Set when the formatted view was requested but formatting failed. */
  formatError: string | null;
  /** Pretty-printing is still running (in a worker); `text` is the unformatted SQL. */
  pending: boolean;
}

/** Recent results, so switching views back and forth doesn't format again. */
const recent = new Map<string, FormatResult>();
const RECENT_LIMIT = 6;

function remember(key: string, result: FormatResult) {
  recent.delete(key);
  recent.set(key, result);
  if (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value!);
}

/** Format `text` off the main thread; null while pending (or when `text` is null). */
function useFormatted(
  text: string | null,
  dialect: Dialect,
  options: FormatOptions,
): FormatResult | null {
  const key = text === null ? null : JSON.stringify([text, dialect, options]);
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (key === null || text === null || recent.has(key)) return;
    let cancelled = false;
    void getFormatter()
      .format(text, dialect, options)
      .then((result) => {
        remember(key, result);
        if (!cancelled) setVersion((v) => v + 1);
      });
    return () => {
      cancelled = true;
    };
    // `key` covers text, dialect and options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return key === null ? null : (recent.get(key) ?? null);
}

/**
 * What one side displays (FR-3.1): the original, its formatted view, or its
 * normalized view (from the latest comparison, pretty-printed). Formatting
 * runs in a worker; until it's done the view shows the unformatted SQL,
 * already read-only.
 */
export function useSideDisplay(side: Side): SideDisplay {
  const text = useCompareStore((s) => s[side].text);
  const view = useCompareStore((s) => s.views[side]);
  const dialect = useCompareStore((s) => s.dialect);
  const options = useCompareStore((s) => s.formatOptions);
  const normalized = useCompareStore((s) =>
    s.result && s.result.views[side].original === text
      ? s.result.views[side].normalized
      : undefined,
  );

  const formatted = useFormatted(view === 'formatted' ? text : null, dialect, options);
  const normalizedSource = view === 'normalized' && normalized !== undefined ? normalized : null;
  const prettyNormalized = useFormatted(normalizedSource, dialect, {
    ...options,
    keywordCase: 'upper',
  });

  if (normalizedSource !== null) {
    const ready = prettyNormalized !== null;
    return {
      text: prettyNormalized?.ok ? prettyNormalized.text : normalizedSource,
      mode: 'normalized',
      readOnly: true,
      formatError: null,
      pending: !ready,
    };
  }
  if (view === 'formatted' && formatted === null) {
    return { text, mode: 'formatted', readOnly: true, formatError: null, pending: true };
  }
  if (formatted?.ok) {
    return {
      text: formatted.text,
      mode: 'formatted',
      readOnly: true,
      formatError: null,
      pending: false,
    };
  }
  return {
    text,
    mode: 'original',
    readOnly: false,
    formatError: formatted && !formatted.ok ? formatted.message : null,
    pending: false,
  };
}
