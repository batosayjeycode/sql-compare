import { useEffect, useRef, type ChangeEvent } from 'react';
import { ACCEPT_ATTR } from '../lib/files';
import { useShallow } from 'zustand/react/shallow';
import { useCompareStore, type Side, type SideInput } from '../store/compare';
import { useFileLoader } from '../hooks/useFileLoader';
import type { SideDisplay } from '../hooks/useFormatted';
import styles from './DiffView.module.css';

interface PaneHeaderProps {
  side: Side;
  title: string;
  input: SideInput;
  display: SideDisplay;
  /** Move the cursor to a character offset in this side's original SQL. */
  onJump: (side: Side, offset: number) => void;
}

/** Parse issues for one side, if the latest result matches its current text. */
function useSideAnalysis(side: Side) {
  const errors = useCompareStore(
    useShallow((s) =>
      s.result && s.result.views[side].original === s[side].text
        ? s.result.errors.filter((e) => e.side === side)
        : [],
    ),
  );
  const unsupported = useCompareStore((s) =>
    s.result && s.result.views[side].original === s[side].text
      ? s.result.statements[side].filter((st) => st.status === 'unsupported').length
      : 0,
  );
  return { errors, unsupported };
}

function lineCount(text: string): number {
  if (text === '') return 0;
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

export function PaneHeader({ side, title, input, display, onJump }: PaneHeaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const clear = useCompareStore((s) => s.clear);
  const swap = useCompareStore((s) => s.swap);
  const view = useCompareStore((s) => s.views[side]);
  const setView = useCompareStore((s) => s.setView);
  const notify = useCompareStore((s) => s.notify);
  const loadFile = useFileLoader();
  const analysis = useSideAnalysis(side);

  // FR-2.1: if formatting fails (or would change tokens), say why and fall
  // back to the original rather than showing unverified output.
  useEffect(() => {
    if (!display.formatError) return;
    notify('warning', `Couldn't format ${title.toLowerCase()} SQL: ${display.formatError}`);
    setView(side, 'original');
  }, [display.formatError, notify, setView, side, title]);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so selecting the same file again still fires `change`.
    e.target.value = '';
    if (file) void loadFile(side, file);
  };

  const lines = lineCount(input.text);

  return (
    <div className={styles.paneHeader}>
      <div className={styles.paneInfo}>
        <h2 className={styles.paneTitle}>{title}</h2>
        {input.fileName && (
          <span className={styles.fileName} title={input.fileName}>
            {input.fileName}
          </span>
        )}
        <span className={styles.paneMeta}>
          {lines} {lines === 1 ? 'line' : 'lines'}
        </span>
        {analysis.errors.length > 0 && (
          <button
            type="button"
            className={styles.errorPill}
            onClick={() => onJump(side, analysis.errors[0]!.offset)}
            title={analysis.errors.map((e) => `Line ${e.line}:${e.column} ${e.message}`).join('\n')}
          >
            Parse error L{analysis.errors[0]!.line}:{analysis.errors[0]!.column}
            {analysis.errors.length > 1 && ` +${analysis.errors.length - 1}`}
          </button>
        )}
        {analysis.unsupported > 0 && (
          <span
            className={styles.infoPill}
            title="These statements use syntax the parser doesn't handle (procedural blocks, client commands, vendor extensions). Their changes are compared as text."
          >
            {analysis.unsupported} compared as text
          </span>
        )}
        {display.formatted && (
          <span className={styles.viewBadge} title="Formatted view. Switch to Original to edit.">
            Formatted · read-only
          </span>
        )}
      </div>
      <div className={styles.paneActions}>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={onFileChange}
          data-testid={`${side}-file-input`}
        />
        <button
          type="button"
          className={styles.action}
          onClick={() => fileRef.current?.click()}
          aria-label={`Upload ${side} file`}
        >
          Upload
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => setView(side, view === 'formatted' ? 'original' : 'formatted')}
          aria-pressed={view === 'formatted'}
          aria-label={`Format ${side} side`}
          disabled={input.text.trim() === ''}
        >
          Format
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => clear(side)}
          disabled={input.text === ''}
          aria-label={`Clear ${side} side`}
        >
          Clear
        </button>
        {side === 'left' && (
          <button
            type="button"
            className={styles.action}
            onClick={swap}
            aria-label="Swap sides"
            title="Swap sides"
          >
            ⇄
          </button>
        )}
      </div>
    </div>
  );
}
