import { useEffect } from 'react';
import { compare, DEFAULT_OPTIONS } from '@sql-compare/core';
import { useCompareStore } from '../store/compare';

export const COMPARE_DEBOUNCE_MS = 300;

/**
 * Re-run the comparison 300 ms after the inputs settle (NFR Performance).
 * Runs on the main thread for now; it moves into a Web Worker in M3.
 */
export function useComparison() {
  const left = useCompareStore((s) => s.left.text);
  const right = useCompareStore((s) => s.right.text);
  const dialect = useCompareStore((s) => s.dialect);
  const setResult = useCompareStore((s) => s.setResult);

  useEffect(() => {
    if (left === '' || right === '') {
      setResult(null);
      return;
    }
    const timer = setTimeout(() => {
      setResult(compare(left, right, { ...DEFAULT_OPTIONS, dialect }));
    }, COMPARE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [left, right, dialect, setResult]);
}
