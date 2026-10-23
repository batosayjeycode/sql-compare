import { useEffect, useRef, type CSSProperties } from 'react';
import { DiffNav } from './components/DiffNav';
import { DiffView } from './components/DiffView';
import { DifferencesPanel } from './components/DifferencesPanel';
import { Splitter } from './components/Splitter';
import { Notice } from './components/Notice';
import { SummaryBar } from './components/SummaryBar';
import { Toolbar } from './components/Toolbar';
import { ViewSwitch } from './components/ViewSwitch';
import { useComparison } from './hooks/useComparison';
import { useDiffNavigation } from './hooks/useDiffNavigation';
import { useCompareStore } from './store/compare';
import styles from './App.module.css';

/**
 * SQL Compare: two editors with a classified diff (formatting / structural /
 * semantic), a differences panel grouped by statement and clause, filters,
 * keyboard navigation and report export.
 */
export function App() {
  const theme = useCompareStore((s) => s.theme);
  const panel = useCompareStore((s) => s.panel);
  const setPanel = useCompareStore((s) => s.setPanel);
  const workspaceRef = useRef<HTMLElement>(null);
  useComparison();
  useDiffNavigation();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true" />
          <h1 className={styles.title}>SQL Compare</h1>
          <span className={styles.badge}>Local only</span>
        </div>
        <Toolbar />
      </header>

      <div className={styles.viewBar}>
        <ViewSwitch />
        <DiffNav />
        {!panel.open && (
          <button
            type="button"
            className={styles.pillButton}
            onClick={() => setPanel({ open: true })}
          >
            Show differences
          </button>
        )}
      </div>

      <main
        ref={workspaceRef}
        className={styles.main}
        data-dock={panel.open ? panel.dock : 'none'}
        style={
          {
            '--panel-size': `${panel.dock === 'right' ? panel.width : panel.height}px`,
          } as CSSProperties
        }
      >
        <div className={styles.editors}>
          <DiffView />
        </div>
        {panel.open && (
          <>
            <Splitter container={workspaceRef} />
            <div className={styles.panel}>
              <DifferencesPanel />
            </div>
          </>
        )}
      </main>

      <footer className={styles.summary} aria-label="Comparison summary">
        <SummaryBar />
      </footer>

      <Notice />
    </div>
  );
}
