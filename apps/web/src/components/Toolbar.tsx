import { SUPPORTED_DIALECTS, type Dialect } from '@sql-compare/core';
import { useCompareStore } from '../store/compare';
import { FormatOptionsPanel } from './FormatOptionsPanel';
import { NormalizationPanel } from './NormalizationPanel';
import styles from '../App.module.css';

export function Toolbar() {
  const dialect = useCompareStore((s) => s.dialect);
  const setDialect = useCompareStore((s) => s.setDialect);
  const theme = useCompareStore((s) => s.theme);
  const toggleTheme = useCompareStore((s) => s.toggleTheme);
  const persistDrafts = useCompareStore((s) => s.persistDrafts);
  const setPersistDrafts = useCompareStore((s) => s.setPersistDrafts);
  const loadSample = useCompareStore((s) => s.loadSample);
  const colorBlind = useCompareStore((s) => s.colorBlindPalette);
  const setColorBlind = useCompareStore((s) => s.setColorBlindPalette);

  return (
    <div className={styles.toolbar}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Dialect</span>
        <select
          id="dialect-select"
          value={dialect}
          onChange={(e) => setDialect(e.target.value as Dialect)}
        >
          {SUPPORTED_DIALECTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <NormalizationPanel triggerClassName={styles.pillButton} />

      <button type="button" className={styles.textButton} onClick={loadSample}>
        Load example
      </button>

      <label
        className={styles.check}
        title="Keep both inputs in this browser's local storage between visits"
      >
        <input
          type="checkbox"
          checked={persistDrafts}
          onChange={(e) => setPersistDrafts(e.target.checked)}
        />
        Save drafts
      </label>

      <FormatOptionsPanel />

      <button
        type="button"
        className={styles.iconButton}
        onClick={() => setColorBlind(!colorBlind)}
        aria-pressed={colorBlind}
        aria-label="Color-blind-safe colors"
        title="Color-blind-safe colors (blue / orange instead of teal / rose)"
      >
        ◐
      </button>

      <button
        id="theme-toggle"
        type="button"
        className={styles.iconButton}
        onClick={toggleTheme}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </div>
  );
}
