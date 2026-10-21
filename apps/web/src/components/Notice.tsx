import { useEffect } from 'react';
import { useCompareStore } from '../store/compare';
import styles from './Notice.module.css';

const AUTO_DISMISS_MS = 6000;
const ICONS = { error: '✕', warning: '⚠', info: 'ℹ' } as const;

/** Transient message for upload errors/warnings. Errors stay until dismissed. */
export function Notice() {
  const notice = useCompareStore((s) => s.notice);
  const dismiss = useCompareStore((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  return (
    <div className={styles.region} aria-live="polite">
      {notice && (
        <div
          key={notice.id}
          className={`${styles.notice} ${styles[notice.kind]}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          <span aria-hidden="true">{ICONS[notice.kind]}</span>
          <span className={styles.message}>{notice.message}</span>
          <button
            type="button"
            className={styles.close}
            onClick={dismiss}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
