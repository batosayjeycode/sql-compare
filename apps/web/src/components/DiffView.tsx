import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Chunk,
  getChunks,
  getOriginalDoc,
  MergeView,
  originalDocChangeEffect,
  unifiedMergeView,
} from '@codemirror/merge';
import {
  Annotation,
  ChangeSet,
  Compartment,
  EditorState,
  Text,
  Transaction,
  type Extension,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  CLASS_LABELS,
  createViewMapper,
  splitCodeSpans,
  type ComparisonResult,
  type Dialect,
  type ViewMapper,
} from '@sql-compare/core';
import { analysisExtensions, showAnalysis } from '../editor/analysis';
import { highlightExtensions, setHighlights, type Highlight } from '../editor/highlights';
import { baseExtensions, sqlLanguage } from '../editor/setup';
import { visibleDifferences } from '../lib/differences';
import { useCompareStore, type DiffSummary, type Layout, type Side } from '../store/compare';
import { useFileLoader } from '../hooks/useFileLoader';
import { useSideDisplay, type SideDisplay } from '../hooks/useSideDisplay';
import { PaneHeader } from './PaneHeader';
import { EmptyState } from './EmptyState';
import styles from './DiffView.module.css';

const SIDE_LABELS: Record<Side, { label: string; title: string }> = {
  left: { label: 'Left SQL', title: 'Original' },
  right: { label: 'Right SQL', title: 'Modified' },
};

const COLLAPSE = { margin: 3, minSize: 6 };

const SCROLLER_LABELS: Record<ViewLayout, string> = {
  split: 'Side-by-side diff',
  unified: 'Inline diff',
  left: 'Original SQL',
  right: 'Modified SQL',
};

/** Marks editor updates that come from the store (not the user), so they aren't echoed back. */
const externalSync = Annotation.define<boolean>();

function readOnlyExtension(readOnly: boolean) {
  return readOnly
    ? [EditorState.readOnly.of(true), EditorView.contentAttributes.of({ 'aria-readonly': 'true' })]
    : [];
}

/** Put the cursor at `offset`, scroll it into view and focus the editor. */
function moveTo(editor: EditorView, offset: number) {
  const pos = Math.min(offset, editor.state.doc.length);
  editor.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  editor.focus();
}

/** Lines covered by a chunk side; `to` is one past the last line's end (may exceed the doc). */
function lineSpan(doc: Text, from: number, to: number): number {
  if (to <= from) return 0;
  return doc.lineAt(Math.min(to - 1, doc.length)).number - doc.lineAt(from).number + 1;
}

function summarize(chunks: readonly Chunk[], a: Text, b: Text): DiffSummary {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const c of chunks) {
    linesRemoved += lineSpan(a, c.fromA, c.toA);
    linesAdded += lineSpan(b, c.fromB, c.toB);
  }
  return { chunks: chunks.length, linesAdded, linesRemoved };
}

/**
 * How the sides are shown: side-by-side, inline (unified), or a single side
 * on its own (the Left / Right tabs on small screens).
 */
export type ViewLayout = Layout | 'left' | 'right';

/** The editors on screen: both sides (side-by-side), the right one (inline), or one side. */
interface Editors {
  merge: MergeView | null;
  a: EditorView | null;
  b: EditorView | null;
  /** Element that scrolls (and is focusable for keyboard users). */
  scroller: HTMLElement;
}

/** Maps result ranges (offsets in the original SQL) into what an editor shows. */
function mapperFor(
  result: ComparisonResult | null,
  side: Side,
  input: string,
  display: SideDisplay,
  dialect: Dialect,
): ViewMapper | null {
  if (!result) return null;
  const view = result.views[side];
  // A pending comparison: the result describes older text.
  if (view.original !== input) return null;
  if (display.mode === 'original') {
    return createViewMapper(view.original, display.text, dialect, { kind: 'original' });
  }
  if (display.mode === 'formatted') {
    return createViewMapper(view.original, display.text, dialect, { kind: 'formatted' });
  }
  return createViewMapper(view.original, display.text, dialect, {
    kind: 'normalized',
    sources: view.normalizedSources ?? [],
  });
}

const plain = (description: string) =>
  splitCodeSpans(description)
    .map((p) => p.text)
    .join('');

/**
 * Side-by-side (`MergeView`) or inline (`unifiedMergeView`) diff of the two
 * sides, with the classified-difference highlight layer on top. Each side
 * shows its original SQL (editable) or a read-only formatted / normalized view;
 * highlights are mapped into whichever view is shown.
 */
export function DiffView({
  layout,
  onShowSide,
}: {
  layout: ViewLayout;
  /** Bring a side that isn't shown into view (default: switch to side-by-side). */
  onShowSide?: ((side: Side) => void) | undefined;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorsRef = useRef<Editors | null>(null);
  // Text currently in each editor, so store → editor sync skips the user's own edits.
  const syncedRef = useRef<Record<Side, string>>({ left: '', right: '' });
  const languageRef = useRef({ a: new Compartment(), b: new Compartment() });
  const readOnlyRef = useRef({ a: new Compartment(), b: new Compartment() });

  const left = useCompareStore((s) => s.left);
  const right = useCompareStore((s) => s.right);
  const dialect = useCompareStore((s) => s.dialect);
  const leftDisplay = useSideDisplay('left');
  const rightDisplay = useSideDisplay('right');
  const result = useCompareStore((s) => s.result);
  const filters = useCompareStore((s) => s.filters);
  const collapse = useCompareStore((s) => s.collapseUnchanged);
  const activeDiff = useCompareStore((s) => s.activeDiff);
  const hoverDiff = useCompareStore((s) => s.hoverDiff);
  const scrollRequest = useCompareStore((s) => s.scrollRequest);
  const setView = useCompareStore((s) => s.setView);
  const loadFile = useFileLoader();
  const [dragSide, setDragSide] = useState<Side | null>(null);
  // Bumped when the editors are rebuilt (layout switch), to re-apply state.
  const [generation, setGeneration] = useState(0);
  // A jump requested while that side showed a read-only view; applied once
  // the original is back in the editor.
  const pendingJumpRef = useRef<{ side: Side; offset: number } | null>(null);
  // Latest display state, read when (re)building the editors.
  const latestRef = useRef({ leftDisplay, rightDisplay, dialect, collapse });
  latestRef.current = { leftDisplay, rightDisplay, dialect, collapse };

  const unifiedCollapse = layout === 'unified' ? collapse : null;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { setText, setDiff, setHoverDiff, setActiveDiff } = useCompareStore.getState();
    const latest = latestRef.current;
    syncedRef.current = { left: latest.leftDisplay.text, right: latest.rightDisplay.text };

    const sideExtensions = (side: Side, key: 'a' | 'b', placeholderText: string): Extension[] => [
      baseExtensions({ label: SIDE_LABELS[side].label, placeholderText }),
      languageRef.current[key].of(sqlLanguage(latest.dialect)),
      readOnlyRef.current[key].of(
        readOnlyExtension((side === 'left' ? latest.leftDisplay : latest.rightDisplay).readOnly),
      ),
      analysisExtensions(),
      highlightExtensions({ hover: setHoverDiff, select: (id) => setActiveDiff(id) }),
      EditorView.updateListener.of((update) => {
        const external = update.transactions.some((tr) => tr.annotation(externalSync));
        if (update.docChanged && !external) {
          const text = update.state.doc.toString();
          syncedRef.current[side] = text;
          setText(side, text);
        }
        // The right editor updates last (MergeView) or alone (inline): it sees final chunks.
        if (side !== 'right' || layout === 'right') return;
        const before = getChunks(update.startState)?.chunks;
        const after = getChunks(update.state)?.chunks;
        if (before === after || !after) return;
        const editors = editorsRef.current;
        if (editors?.merge) {
          setDiff(summarize(editors.merge.chunks, editors.merge.a.state.doc, update.state.doc));
        } else {
          setDiff(summarize(after, getOriginalDoc(update.state), update.state.doc));
        }
      }),
    ];

    let editors: Editors;
    if (layout === 'split') {
      const merge = new MergeView({
        parent: host,
        a: {
          doc: latest.leftDisplay.text,
          extensions: sideExtensions('left', 'a', 'Paste original SQL or drop a .sql file'),
        },
        b: {
          doc: latest.rightDisplay.text,
          extensions: sideExtensions('right', 'b', 'Paste modified SQL or drop a .sql file'),
        },
        highlightChanges: true,
        gutter: true,
        ...(latest.collapse ? { collapseUnchanged: COLLAPSE } : {}),
      });
      editors = { merge, a: merge.a, b: merge.b, scroller: merge.dom };
      setDiff(summarize(merge.chunks, merge.a.state.doc, merge.b.state.doc));
    } else if (layout === 'left' || layout === 'right') {
      const side = layout;
      const key = side === 'left' ? 'a' : 'b';
      const editor = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: (side === 'left' ? latest.leftDisplay : latest.rightDisplay).text,
          extensions: sideExtensions(
            side,
            key,
            `Paste ${side === 'left' ? 'original' : 'modified'} SQL or drop a .sql file`,
          ),
        }),
      });
      editors = {
        merge: null,
        a: side === 'left' ? editor : null,
        b: side === 'right' ? editor : null,
        scroller: editor.scrollDOM,
      };
    } else {
      const b = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: latest.rightDisplay.text,
          extensions: [
            sideExtensions('right', 'b', 'Paste modified SQL or drop a .sql file'),
            unifiedMergeView({
              original: latest.leftDisplay.text,
              mergeControls: false,
              highlightChanges: true,
              gutter: true,
              ...(latest.collapse ? { collapseUnchanged: COLLAPSE } : {}),
            }),
          ],
        }),
      });
      editors = { merge: null, a: null, b, scroller: b.scrollDOM };
      const chunks = getChunks(b.state)?.chunks ?? [];
      setDiff(summarize(chunks, getOriginalDoc(b.state), b.state.doc));
    }
    // The scroll container is reachable by keyboard.
    editors.scroller.tabIndex = 0;
    editors.scroller.setAttribute('role', 'group');
    editors.scroller.setAttribute('aria-label', SCROLLER_LABELS[layout]);
    editorsRef.current = editors;
    setGeneration((g) => g + 1);

    return () => {
      if (editors.merge) editors.merge.destroy();
      else (editors.a ?? editors.b)?.destroy();
      editorsRef.current = null;
    };
  }, [layout, unifiedCollapse]);

  // One side on its own (small screens): keep the line counts up to date.
  useEffect(() => {
    if (layout !== 'left' && layout !== 'right') return;
    const timer = setTimeout(() => {
      const a = Text.of(left.text.split('\n'));
      const b = Text.of(right.text.split('\n'));
      useCompareStore.getState().setDiff(summarize(Chunk.build(a, b), a, b));
    }, 300);
    return () => clearTimeout(timer);
  }, [layout, left.text, right.text]);

  // Collapsing unchanged text in the side-by-side view needs no rebuild.
  useEffect(() => {
    // An explicit `undefined` turns collapsing off again.
    const config = { collapseUnchanged: collapse ? COLLAPSE : undefined };
    editorsRef.current?.merge?.reconfigure(config as Parameters<MergeView['reconfigure']>[0]);
  }, [collapse, generation]);

  // Store → editor: uploads, samples, swap, clear, restored drafts, view switches.
  useEffect(() => {
    const editors = editorsRef.current;
    if (!editors) return;
    const annotations = [externalSync.of(true), Transaction.addToHistory.of(false)];
    const replace = (editor: EditorView, text: string) =>
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: text },
        // Undo must never bring formatted text back into the original.
        annotations,
      });
    if (editors.b && rightDisplay.text !== syncedRef.current.right) {
      syncedRef.current.right = rightDisplay.text;
      replace(editors.b, rightDisplay.text);
    }
    if (leftDisplay.text !== syncedRef.current.left) {
      if (editors.a) {
        syncedRef.current.left = leftDisplay.text;
        replace(editors.a, leftDisplay.text);
      } else if (editors.b && layout === 'unified') {
        // Inline view: the left side is the original document being compared against.
        syncedRef.current.left = leftDisplay.text;
        const length = getOriginalDoc(editors.b.state).length;
        const changes = ChangeSet.of({ from: 0, to: length, insert: leftDisplay.text }, length);
        editors.b.dispatch({
          effects: originalDocChangeEffect(editors.b.state, changes),
          annotations,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layout changes rebuild (generation)
  }, [leftDisplay.text, rightDisplay.text, generation]);

  // Formatted and normalized views are read-only: edits always go to the original.
  useEffect(() => {
    const editors = editorsRef.current;
    if (!editors) return;
    editors.a?.dispatch({
      effects: readOnlyRef.current.a.reconfigure(readOnlyExtension(leftDisplay.readOnly)),
    });
    editors.b?.dispatch({
      effects: readOnlyRef.current.b.reconfigure(readOnlyExtension(rightDisplay.readOnly)),
    });
  }, [leftDisplay.readOnly, rightDisplay.readOnly, generation]);

  // Parse errors and badges: only on the original view, where offsets apply.
  // Runs after the store → editor sync above, so the editors hold the new text.
  const leftReadOnly = leftDisplay.readOnly;
  const rightReadOnly = rightDisplay.readOnly;
  useEffect(() => {
    const editors = editorsRef.current;
    if (!editors) return;
    if (editors.a) showAnalysis(editors.a, 'left', leftReadOnly ? null : result);
    if (editors.b) showAnalysis(editors.b, 'right', rightReadOnly ? null : result);

    const jump = pendingJumpRef.current;
    if (jump && !(jump.side === 'left' ? leftReadOnly : rightReadOnly)) {
      const editor = jump.side === 'left' ? editors.a : editors.b;
      pendingJumpRef.current = null;
      if (editor) moveTo(editor, jump.offset);
    }
  }, [result, leftReadOnly, rightReadOnly, leftDisplay.text, rightDisplay.text, generation]);

  // Classified differences, mapped into each side's current view.
  const leftMode = leftDisplay.mode;
  const rightMode = rightDisplay.mode;
  const mappers = useMemo(
    () => ({
      left: mapperFor(result, 'left', left.text, leftDisplay, dialect),
      right: mapperFor(result, 'right', right.text, rightDisplay, dialect),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- display objects are rebuilt every render
    [
      result,
      left.text,
      right.text,
      leftDisplay.text,
      leftMode,
      rightDisplay.text,
      rightMode,
      dialect,
    ],
  );
  // Last highlights sent to each editor, so unchanged ones aren't re-dispatched.
  const sentRef = useRef<Record<Side, string>>({ left: '', right: '' });
  const visible = useMemo(() => visibleDifferences(result, filters), [result, filters]);

  useEffect(() => {
    const editors = editorsRef.current;
    if (!editors) return;
    for (const [side, editor] of [
      ['left', editors.a],
      ['right', editors.b],
    ] as const) {
      if (!editor) continue;
      const mapper = mappers[side];
      const highlights: Highlight[] = [];
      if (mapper && editor.state.doc.toString() === syncedRef.current[side]) {
        for (const d of visible) {
          const range = d[side];
          if (!range) continue;
          const { from, to } = mapper.toDisplay(range);
          highlights.push({
            id: d.id,
            cls: d.class,
            from,
            to,
            label: `${CLASS_LABELS[d.class]} (${d.severity}): ${plain(d.description)}`,
            active: d.id === activeDiff,
            hover: d.id === hoverDiff,
          });
        }
      }
      const key = `${generation}:${editor.state.doc.length}:${JSON.stringify(highlights)}`;
      if (key === sentRef.current[side]) continue;
      sentRef.current[side] = key;
      editor.dispatch({ effects: setHighlights.of(highlights) });
    }
  }, [mappers, visible, activeDiff, hoverDiff, generation, leftDisplay.text, rightDisplay.text]);

  // Bring the selected difference into view (summary click, n/p, F7).
  useEffect(() => {
    const editors = editorsRef.current;
    if (!editors || scrollRequest === 0) return;
    const { activeDiff: id, result: current } = useCompareStore.getState();
    const d = current?.differences.find((x) => x.id === id);
    if (!d) return;
    const targets = (
      [
        ['left', editors.a],
        ['right', editors.b],
      ] as const
    ).flatMap(([side, editor]) => {
      const range = d[side];
      const mapper = mappers[side];
      if (!editor || !range || !mapper) return [];
      return [{ editor, ...mapper.toDisplay(range) }];
    });
    // Both panes share one scroll container: center on a side that has text to show.
    const target = targets.find((t) => t.to > t.from) ?? targets[0];
    target?.editor.dispatch({
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on request
  }, [scrollRequest]);

  const jumpTo = useCallback(
    (side: Side, offset: number) => {
      const editors = editorsRef.current;
      if (!editors) return;
      if (useCompareStore.getState().views[side] !== 'original') {
        pendingJumpRef.current = { side, offset };
        setView(side, 'original');
        return;
      }
      const editor = side === 'left' ? editors.a : editors.b;
      if (editor) {
        moveTo(editor, offset);
      } else {
        // The side isn't an editor here (inline view, or the other tab): show it first.
        pendingJumpRef.current = { side, offset };
        if (onShowSide) onShowSide(side);
        else useCompareStore.getState().setLayout('split');
      }
    },
    [setView, onShowSide],
  );

  useEffect(() => {
    const editors = editorsRef.current;
    if (!editors) return;
    editors.a?.dispatch({ effects: languageRef.current.a.reconfigure(sqlLanguage(dialect)) });
    editors.b?.dispatch({ effects: languageRef.current.b.reconfigure(sqlLanguage(dialect)) });
  }, [dialect, generation]);

  const sideAt = useCallback(
    (clientX: number): Side => {
      if (layout !== 'split') return layout === 'left' ? 'left' : 'right';
      const rect = hostRef.current?.getBoundingClientRect();
      return rect && clientX >= rect.left + rect.width / 2 ? 'right' : 'left';
    },
    [layout],
  );

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
      <div className={styles.headers} data-count={layout === 'left' || layout === 'right' ? 1 : 2}>
        {layout !== 'right' && (
          <PaneHeader
            side="left"
            title={SIDE_LABELS.left.title}
            input={left}
            display={leftDisplay}
            onJump={jumpTo}
          />
        )}
        {layout !== 'left' && (
          <PaneHeader
            side="right"
            title={SIDE_LABELS.right.title}
            input={right}
            display={rightDisplay}
            onJump={jumpTo}
          />
        )}
      </div>
      <div className={styles.body}>
        <div ref={hostRef} className={styles.merge} data-testid="merge-view" data-layout={layout} />
        {isEmpty && <EmptyState />}
        {dragSide && (
          <div
            className={styles.dropOverlay}
            data-side={layout === 'split' ? dragSide : 'all'}
            aria-hidden="true"
          >
            <span>Drop to load as {SIDE_LABELS[dragSide].title}</span>
          </div>
        )}
      </div>
    </section>
  );
}
