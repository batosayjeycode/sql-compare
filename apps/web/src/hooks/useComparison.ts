import { useEffect, useRef } from 'react';
import { DEFAULT_OPTIONS } from '@sql-compare/core';
import { createEngine, type Engine } from '../engine/engine';
import { useCompareStore } from '../store/compare';

export const COMPARE_DEBOUNCE_MS = 300;

/**
 * Re-run the comparison 300 ms after the inputs settle (NFR Performance).
 * Parsing and diffing happen in a Web Worker; only the latest request's
 * result is applied.
 */
export function useComparison() {
  const left = useCompareStore((s) => s.left.text);
  const right = useCompareStore((s) => s.right.text);
  const dialect = useCompareStore((s) => s.dialect);
  const normalization = useCompareStore((s) => s.normalization);
  const setResult = useCompareStore((s) => s.setResult);
  const setComparing = useCompareStore((s) => s.setComparing);
  const notify = useCompareStore((s) => s.notify);
  const engineRef = useRef<Engine | null>(null);
  const requestRef = useRef(0);
  const lastWarningRef = useRef<string | null>(null);

  useEffect(() => {
    const engine = createEngine();
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const request = ++requestRef.current;
    if (left === '' || right === '') {
      setResult(null);
      setComparing(false);
      return;
    }
    setComparing(true);
    const timer = setTimeout(async () => {
      const engine = engineRef.current;
      if (!engine) return;
      const { result, warning } = await engine.compare(left, right, {
        ...DEFAULT_OPTIONS,
        dialect,
        level: normalization.aggressive ? 3 : 2,
        disabledRules: normalization.disabledRules,
        caseInsensitiveTables: normalization.caseInsensitiveTables,
      });
      if (request !== requestRef.current) return;
      setResult(result);
      setComparing(false);
      if (warning && warning !== lastWarningRef.current) notify('warning', warning);
      lastWarningRef.current = warning;
    }, COMPARE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [left, right, dialect, normalization, setResult, setComparing, notify]);
}
