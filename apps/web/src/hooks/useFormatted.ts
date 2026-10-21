import { useMemo } from 'react';
import { formatSql, type FormatResult } from '@sql-compare/core';
import { useCompareStore, type Side } from '../store/compare';

export interface SideDisplay {
  /** Text the editor should show. */
  text: string;
  /** True when the formatted view is active and formatting succeeded. */
  formatted: boolean;
  /** Set when the formatted view was requested but formatting failed. */
  formatError: string | null;
}

/**
 * What one side displays: the original, or its formatted view (FR-3.1).
 * Formatting runs synchronously, and only while the formatted view is active.
 */
export function useSideDisplay(side: Side): SideDisplay {
  const text = useCompareStore((s) => s[side].text);
  const view = useCompareStore((s) => s.views[side]);
  const dialect = useCompareStore((s) => s.dialect);
  const options = useCompareStore((s) => s.formatOptions);

  const result: FormatResult | null = useMemo(
    () => (view === 'formatted' ? formatSql(text, dialect, options) : null),
    [view, text, dialect, options],
  );

  if (!result) return { text, formatted: false, formatError: null };
  if (!result.ok) return { text, formatted: false, formatError: result.message };
  return { text: result.text, formatted: true, formatError: null };
}
