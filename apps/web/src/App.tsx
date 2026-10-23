import { useEffect, useRef, type CSSProperties } from 'react';
import { DiffNav } from './components/DiffNav';
import { DiffView, type ViewLayout } from './components/DiffView';
import { DifferencesPanel } from './components/DifferencesPanel';
import {
  EDITORS_PANEL_ID,
  MobileTabs,
  SUMMARY_PANEL_ID,
  WORKSPACE_ID,
} from './components/MobileTabs';
import { Splitter } from './components/Splitter';
import { Notice } from './components/Notice';
import { SummaryBar } from './components/SummaryBar';
import { Toolbar } from './components/Toolbar';
import { ViewSwitch } from './components/ViewSwitch';
import { useComparison } from './hooks/useComparison';
import { useDiffNavigation } from './hooks/useDiffNavigation';
import { NARROW, useMediaQuery } from './hooks/useMediaQuery';
import { useCompareStore } from './store/compare';
import styles from './App.module.css';

/**
 * SQL Compare: two editors with a classified diff (formatting / structural /
 * semantic), a differences panel grouped by statement and clause, filters,
 * keyboard navigation and report export. Below 900px the panes become tabs
 * (Left / Right / Diff / Summary) with navigation in a bottom bar.
 */
export function App() {
  const theme = useCompareStore((s) => s.theme);
  const panel = useCompareStore((s) => s.panel);
  const setPanel = useCompareStore((s) => s.setPanel);
  const layout = useCompareStore((s) => s.layout);
  const mobileLayout = useCompareStore((s) => s.mobileLayout);
  const tab = useCompareStore((s) => s.mobileTab);
  const setTab = useCompareStore((s) => s.setMobileTab);
  const narrow = useMediaQuery(NARROW);
  const workspaceRef = useRef<HTMLElement>(null);
  useComparison();
  useDiffNavigation();

  const colorBlind = useCompareStore((s) => s.colorBlindPalette);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (colorBlind) document.documentElement.dataset.palette = 'color-blind';
    else delete document.documentElement.dataset.palette;
  }, [colorBlind]);

  const viewLayout: ViewLayout = !narrow
    ? layout
    : tab === 'left' || tab === 'right'
      ? tab
      : mobileLayout;
  const showPanel = narrow ? tab === 'summary' : panel.open;
  const showEditors = !narrow || tab !== 'summary';

  return (
    <div className={styles.app} data-narrow={narrow || undefined}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true" />
          <h1 className={styles.title}>SQL Compare</h1>
          <span className={styles.badge}>Local only</span>
        </div>
        <Toolbar />
      </header>

      {narrow && <MobileTabs />}

      <div className={styles.viewBar}>
        <ViewSwitch />
        {!narrow && <DiffNav />}
        {narrow && tab === 'diff' && <DiffNav part="controls" narrow />}
        {!narrow && !panel.open && (
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
        id={WORKSPACE_ID}
        ref={workspaceRef}
        className={styles.main}
        data-dock={showPanel && !narrow ? panel.dock : 'none'}
        style={
          {
            '--panel-size': `${panel.dock === 'right' ? panel.width : panel.height}px`,
          } as CSSProperties
        }
      >
        {/* Kept mounted on the Summary tab, so the editors keep their state. */}
        <div
          className={styles.editors}
          hidden={!showEditors}
          id={EDITORS_PANEL_ID}
          role={narrow ? 'tabpanel' : undefined}
          aria-labelledby={narrow && tab !== 'summary' ? `tab-${tab}` : undefined}
        >
          <DiffView layout={viewLayout} onShowSide={narrow ? setTab : undefined} />
        </div>
        {showPanel && (
          <>
            {!narrow && <Splitter container={workspaceRef} />}
            <div
              className={styles.panel}
              id={SUMMARY_PANEL_ID}
              role={narrow ? 'tabpanel' : undefined}
              aria-labelledby={narrow ? 'tab-summary' : undefined}
            >
              <DifferencesPanel />
            </div>
          </>
        )}
      </main>

      <footer className={styles.summary} aria-label="Comparison summary">
        <SummaryBar />
      </footer>

      {narrow && (
        <nav className={styles.mobileBar} aria-label="Differences">
          <DiffNav part="navigation" narrow />
        </nav>
      )}

      <Notice />
    </div>
  );
}
