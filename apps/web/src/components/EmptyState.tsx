import { useCompareStore } from '../store/compare';
import styles from './DiffView.module.css';

/**
 * Shown over the empty editors. The drop-zone outlines don't intercept clicks,
 * so users can still click into either editor and paste.
 */
export function EmptyState() {
  const loadSample = useCompareStore((s) => s.loadSample);
  return (
    <div className={styles.empty}>
      <div className={styles.dropZone} aria-hidden="true">
        <span className={styles.dropIcon}>⇣</span>
        Paste SQL or drop a .sql file
      </div>
      <div className={styles.dropZone} aria-hidden="true">
        <span className={styles.dropIcon}>⇣</span>
        Paste SQL or drop a .sql file
      </div>
      <button type="button" className={styles.sampleButton} onClick={loadSample}>
        Try an example
      </button>
    </div>
  );
}
