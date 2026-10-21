import { useMemo } from 'react';
import { formatSql, type FormatResult } from '@sql-compare/core';
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
}

/**
 * What one side displays (FR-3.1): the original, its formatted view, or its
 * normalized view. Formatting runs synchronously and only when needed; the
 * normalized SQL comes from the latest comparison and is pretty-printed.
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

  const formatted: FormatResult | null = useMemo(
    () => (view === 'formatted' ? formatSql(text, dialect, options) : null),
    [view, text, dialect, options],
  );
  const normalizedText = useMemo(() => {
    if (view !== 'normalized' || normalized === undefined) return null;
    const pretty = formatSql(normalized, dialect, { ...options, keywordCase: 'upper' });
    return pretty.ok ? pretty.text : normalized;
  }, [view, normalized, dialect, options]);

  if (view === 'normalized' && normalizedText !== null) {
    return { text: normalizedText, mode: 'normalized', readOnly: true, formatError: null };
  }
  if (formatted?.ok)
    return { text: formatted.text, mode: 'formatted', readOnly: true, formatError: null };
  return {
    text,
    mode: 'original',
    readOnly: false,
    formatError: formatted && !formatted.ok ? formatted.message : null,
  };
}
