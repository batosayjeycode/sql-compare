import { useEffect } from 'react';
import { DiffView } from './components/DiffView';
import { Notice } from './components/Notice';
import { SummaryBar } from './components/SummaryBar';
import { Toolbar } from './components/Toolbar';
import { ViewSwitch } from './components/ViewSwitch';
import { useComparison } from './hooks/useComparison';
import { useCompareStore } from './store/compare';
import styles from './App.module.css';

/**
 * Side-by-side SQL diff with formatting (M2). Differences are classified as
 * formatting vs potentially semantic by a token diff; normalization and
 * AST classification arrive in M3–M5.
 */
export function App() {
  const theme = useCompareStore((s) => s.theme);
  useComparison();

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
      </div>

      <main className={styles.main}>
        <DiffView />
      </main>

      <footer className={styles.summary} aria-label="Comparison summary">
        <SummaryBar />
      </footer>

      <Notice />
    </div>
  );
}
