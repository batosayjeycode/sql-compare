import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { MySQL, PostgreSQL, StandardSQL, sql } from '@codemirror/lang-sql';
import { bracketMatching, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { Dialect } from '@sql-compare/core';

export function sqlLanguage(dialect: Dialect): Extension {
  const d = dialect === 'postgresql' ? PostgreSQL : dialect === 'mysql' ? MySQL : StandardSQL;
  return sql({ dialect: d, upperCaseKeywords: true });
}

/**
 * Colors come from CSS custom properties (styles/index.css), so switching
 * `data-theme` re-themes the editor without reconfiguring it.
 */
const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontSize: 'var(--fs-sm)',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    caretColor: 'var(--accent-1)',
    // Show the real characters (`>=`, `!=`), never font ligatures.
    fontVariantLigatures: 'none',
    padding: 'var(--sp-2) 0',
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-1)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--editor-selection)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-faint)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
  '.cm-placeholder': { color: 'var(--text-faint)', fontStyle: 'italic' },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--editor-selection)',
    outline: '1px solid var(--border)',
  },

  // Raw text diff (merge view). A = original (removed), B = modified (added).
  '&.cm-merge-a .cm-changedLine': { backgroundColor: 'var(--diff-removed-line)' },
  '&.cm-merge-b .cm-changedLine': { backgroundColor: 'var(--diff-added-line)' },
  '&.cm-merge-a .cm-changedText': {
    background: 'var(--diff-removed-text)',
    borderRadius: '2px',
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'var(--diff-added-text)',
    borderRadius: '2px',
  },
  '.cm-changeGutter': { width: '1.4ch', paddingLeft: '0', textAlign: 'center' },
  '&.cm-merge-a .cm-changedLineGutter, &.cm-merge-b .cm-changedLineGutter': {
    background: 'none',
    fontWeight: '700',
  },
  // Pair the color with a glyph so the diff is never color-only.
  '&.cm-merge-a .cm-changedLineGutter::before': {
    content: '"−"',
    color: 'var(--diff-removed)',
  },
  '&.cm-merge-b .cm-changedLineGutter::before': {
    content: '"+"',
    color: 'var(--diff-added)',
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--syntax-keyword)' },
  { tag: [t.typeName, t.standard(t.name)], color: 'var(--syntax-type)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syntax-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syntax-number)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: 'var(--text-faint)',
    fontStyle: 'italic',
  },
  { tag: [t.special(t.name), t.quote], color: 'var(--syntax-identifier)' },
  { tag: [t.operator, t.punctuation], color: 'var(--text-muted)' },
]);

export interface EditorOptions {
  label: string;
  placeholderText: string;
}

/** Shared base extensions for both sides of the merge view (minus language). */
export function baseExtensions({ label, placeholderText }: EditorOptions): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    bracketMatching(),
    syntaxHighlighting(highlightStyle),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    placeholder(placeholderText),
    // Wrap instead of scrolling each side horizontally: keeps both sides in
    // view on narrow screens and avoids nested, non-focusable scroll regions.
    EditorView.lineWrapping,
    editorTheme,
    EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
    // Dropped files are handled by DiffView (replace the whole side), so stop
    // CodeMirror from inserting their contents at the drop position.
    EditorView.domEventHandlers({
      drop: (event) => (event.dataTransfer?.files.length ?? 0) > 0,
    }),
  ];
}
