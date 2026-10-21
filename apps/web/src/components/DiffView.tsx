import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { getChunks, MergeView } from '@codemirror/merge';
import { Annotation, Compartment, EditorState, Transaction, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { baseExtensions, sqlLanguage } from '../editor/setup';
import { useCompareStore, type DiffSummary, type Side } from '../store/compare';
import { useFileLoader } from '../hooks/useFileLoader';
import { useSideDisplay } from '../hooks/useFormatted';
import { PaneHeader } from './PaneHeader';
import { EmptyState } from './EmptyState';
import styles from './DiffView.module.css';

const SIDE_LABELS: Record<Side, { label: string; title: string }> = {
  left: { label: 'Left SQL', title: 'Original' },
  right: { label: 'Right SQL', title: 'Modified' },
};

/** Marks editor updates that come from the store (not the user), so they aren't echoed back. */
const externalSync = Annotation.define<boolean>();

function readOnlyExtension(readOnly: boolean) {
  return readOnly
    ? [EditorState.readOnly.of(true), EditorView.contentAttributes.of({ 'aria-readonly': 'true' })]
    : [];
}

/** Lines covered by a chunk side; `to` is one past the last line's end (may exceed the doc). */
function lineSpan(doc: Text, from: number, to: number): number {
  if (to <= from) return 0;
  return doc.lineAt(Math.min(to - 1, doc.length)).number - doc.lineAt(from).number + 1;
}

function summarize(view: MergeView): DiffSummary {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const c of view.chunks) {
    linesRemoved += lineSpan(view.a.state.doc, c.fromA, c.toA);
    linesAdded += lineSpan(view.b.state.doc, c.fromB, c.toB);
  }
  return { chunks: view.chunks.length, linesAdded, linesRemoved };
}

/**
 * Side-by-side raw text diff. Both sides are CodeMirror editors inside one
 * `MergeView`, so scrolling is shared and lines stay aligned. Each side shows
 * either its original SQL (editable) or its formatted view (read-only).
 */
export function DiffView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | null>(null);
  // Text currently in each editor, so store → editor sync skips the user's own edits.
  const syncedRef = useRef<Record<Side, string>>({ left: '', right: '' });
  const languageRef = useRef({ a: new Compartment(), b: new Compartment() });
  const readOnlyRef = useRef({ a: new Compartment(), b: new Compartment() });

  const left = useCompareStore((s) => s.left);
  const right = useCompareStore((s) => s.right);
  const dialect = useCompareStore((s) => s.dialect);
  const leftDisplay = useSideDisplay('left');
  const rightDisplay = useSideDisplay('right');
  const loadFile = useFileLoader();
  const [dragSide, setDragSide] = useState<Side | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { setText, setDiff, dialect: initialDialect } = useCompareStore.getState();
    const { left: l, right: r } = useCompareStore.getState();
    syncedRef.current = { left: l.text, right: r.text };

    const listener = (side: Side) =>
      EditorView.updateListener.of((update) => {
        const external = update.transactions.some((tr) => tr.annotation(externalSync));
        if (update.docChanged && !external) {
          const text = update.state.doc.toString();
          syncedRef.current[side] = text;
          setText(side, text);
        }
        // B is always updated last by MergeView, so its listener sees final chunks.
        if (side === 'right' && viewRef.current) {
          const before = getChunks(update.startState)?.chunks;
          const after = getChunks(update.state)?.chunks;
          if (before !== after) setDiff(summarize(viewRef.current));
        }
      });

    const view = new MergeView({
      parent: host,
      a: {
        doc: l.text,
        extensions: [
          baseExtensions({
            label: SIDE_LABELS.left.label,
            placeholderText: 'Paste original SQL or drop a .sql file',
          }),
          languageRef.current.a.of(sqlLanguage(initialDialect)),
          readOnlyRef.current.a.of([]),
          listener('left'),
        ],
      },
      b: {
        doc: r.text,
        extensions: [
          baseExtensions({
            label: SIDE_LABELS.right.label,
            placeholderText: 'Paste modified SQL or drop a .sql file',
          }),
          languageRef.current.b.of(sqlLanguage(initialDialect)),
          readOnlyRef.current.b.of([]),
          listener('right'),
        ],
      },
      highlightChanges: true,
      gutter: true,
    });
    // The merge view is the shared scroll container; make it reachable by keyboard.
    view.dom.tabIndex = 0;
    view.dom.setAttribute('role', 'group');
    view.dom.setAttribute('aria-label', 'Side-by-side diff');
    viewRef.current = view;
    setDiff(summarize(view));

    return () => {
      view.destroy();
      viewRef.current = null;
      setDiff(null);
    };
  }, []);

  // Store → editor: uploads, samples, swap, clear, restored drafts, view switches.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    for (const [side, text, editor] of [
      ['left', leftDisplay.text, view.a],
      ['right', rightDisplay.text, view.b],
    ] as const) {
      if (text === syncedRef.current[side]) continue;
      syncedRef.current[side] = text;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: text },
        // Undo must never bring formatted text back into the original.
        annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
      });
    }
  }, [leftDisplay.text, rightDisplay.text]);

  // The formatted view is read-only: edits always go to the original.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.a.dispatch({
      effects: readOnlyRef.current.a.reconfigure(readOnlyExtension(leftDisplay.formatted)),
    });
    view.b.dispatch({
      effects: readOnlyRef.current.b.reconfigure(readOnlyExtension(rightDisplay.formatted)),
    });
  }, [leftDisplay.formatted, rightDisplay.formatted]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.a.dispatch({ effects: languageRef.current.a.reconfigure(sqlLanguage(dialect)) });
    view.b.dispatch({ effects: languageRef.current.b.reconfigure(sqlLanguage(dialect)) });
  }, [dialect]);

  const sideAt = useCallback((clientX: number): Side => {
    const rect = hostRef.current?.getBoundingClientRect();
    return rect && clientX >= rect.left + rect.width / 2 ? 'right' : 'left';
  }, []);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragSide(sideAt(e.clientX));
  };

  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragSide(null);
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragSide(null);
    const files = Array.from(e.dataTransfer.files);
    const side = sideAt(e.clientX);
    // Dropping two files at once fills both sides.
    if (files.length >= 2 && files[0] && files[1]) {
      void loadFile('left', files[0]);
      void loadFile('right', files[1]);
    } else if (files[0]) {
      void loadFile(side, files[0]);
    }
  };

  const isEmpty = left.text === '' && right.text === '';

  return (
    <section
      className={styles.diff}
      aria-label="SQL editors"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.headers}>
        <PaneHeader side="left" title={SIDE_LABELS.left.title} input={left} display={leftDisplay} />
        <PaneHeader
          side="right"
          title={SIDE_LABELS.right.title}
          input={right}
          display={rightDisplay}
        />
      </div>
      <div className={styles.body}>
        <div ref={hostRef} className={styles.merge} data-testid="merge-view" />
        {isEmpty && <EmptyState />}
        {dragSide && (
          <div className={styles.dropOverlay} data-side={dragSide} aria-hidden="true">
            <span>Drop to load as {SIDE_LABELS[dragSide].title}</span>
          </div>
        )}
      </div>
    </section>
  );
}
