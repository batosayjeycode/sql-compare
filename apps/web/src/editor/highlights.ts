import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  gutter,
  GutterMarker,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { CLASS_ICONS, CLASS_LABELS, type DiffClass } from '@sql-compare/core';

/**
 * Classified-difference highlight layer (FR-5, FR-5.1, FR-5.3): one mark per
 * visible difference in each editor, a class icon in a gutter next to it, an
 * outline on the selected difference and on the one under the pointer (and
 * its counterpart on the other side).
 */

export interface Highlight {
  id: string;
  cls: DiffClass;
  /** Display positions in this editor (from === to: insertion point). */
  from: number;
  to: number;
  label: string;
  active: boolean;
  hover: boolean;
}

export const setHighlights = StateEffect.define<Highlight[]>();

class InsertionWidget extends WidgetType {
  constructor(private readonly h: Highlight) {
    super();
  }

  override eq(other: InsertionWidget) {
    return (
      other.h.id === this.h.id &&
      other.h.active === this.h.active &&
      other.h.hover === this.h.hover &&
      other.h.cls === this.h.cls
    );
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = classes(this.h, 'cm-scInsert');
    el.dataset.diff = this.h.id;
    el.title = this.h.label;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  override ignoreEvent() {
    return false;
  }
}

function classes(h: Highlight, base: string): string {
  const cls = h.cls === 'unknown' ? 'semantic' : h.cls;
  return `${base} cm-sc-${cls}${h.active ? ' cm-scActive' : ''}${h.hover ? ' cm-scHover' : ''}`;
}

function decorations(highlights: Highlight[], length: number): DecorationSet {
  const ranges = highlights
    .filter((h) => h.from <= length && h.to <= length)
    .map((h) =>
      h.from === h.to
        ? Decoration.widget({ widget: new InsertionWidget(h), side: 1 }).range(h.from)
        : Decoration.mark({
            class: classes(h, 'cm-scMark'),
            attributes: { 'data-diff': h.id, title: h.label },
          }).range(h.from, h.to),
    );
  return Decoration.set(ranges, true);
}

const highlightField = StateField.define<{ list: Highlight[]; deco: DecorationSet }>({
  create: () => ({ list: [], deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlights))
        return { list: e.value, deco: decorations(e.value, tr.state.doc.length) };
    }
    // Any edit makes the old positions stale until the next comparison.
    return tr.docChanged ? { list: [], deco: Decoration.none } : value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

const RANK: Record<DiffClass, number> = { semantic: 3, unknown: 3, structural: 2, formatting: 1 };

class ClassMarker extends GutterMarker {
  constructor(
    private readonly cls: DiffClass,
    private readonly count: number,
  ) {
    super();
  }

  override eq(other: ClassMarker) {
    return other.cls === this.cls && other.count === this.count;
  }

  override toDOM() {
    const el = document.createElement('span');
    const cls = this.cls === 'unknown' ? 'semantic' : this.cls;
    el.className = `cm-scGutterMark cm-sc-${cls}`;
    el.textContent = CLASS_ICONS[this.cls];
    el.title = `${this.count} ${CLASS_LABELS[this.cls].toLowerCase()}${this.count === 1 ? ' difference' : ' differences'} on this line`;
    return el;
  }
}

/** Gutter icon per line: the most significant class of the differences starting on it. */
const classGutter = gutter({
  class: 'cm-scGutter',
  markers: (view) => {
    const { list } = view.state.field(highlightField);
    const byLine = new Map<number, { cls: DiffClass; count: number }>();
    for (const h of list) {
      if (h.from > view.state.doc.length) continue;
      const line = view.state.doc.lineAt(h.from).from;
      const entry = byLine.get(line);
      if (!entry) byLine.set(line, { cls: h.cls, count: 1 });
      else {
        entry.count++;
        if (RANK[h.cls] > RANK[entry.cls]) entry.cls = h.cls;
      }
    }
    return RangeSet.of(
      [...byLine]
        .sort((a, b) => a[0] - b[0])
        .map(([pos, e]) => new ClassMarker(e.cls, e.count).range(pos)),
    );
  },
  lineMarkerChange: (update) =>
    update.transactions.some((tr) => tr.effects.some((e) => e.is(setHighlights))),
});

const highlightTheme = EditorView.baseTheme({
  '.cm-scMark': { borderRadius: '2px', cursor: 'pointer' },
  '.cm-scMark.cm-sc-semantic': {
    textDecoration: 'underline 2px var(--diff-semantic)',
    textUnderlineOffset: '3px',
    backgroundColor: 'hsl(40 90% 55% / 0.14)',
  },
  '.cm-scMark.cm-sc-structural': {
    textDecoration: 'underline 2px dashed var(--diff-structural)',
    textUnderlineOffset: '3px',
  },
  '.cm-scMark.cm-sc-formatting': {
    textDecoration: 'underline 1px dotted var(--diff-formatting)',
    textUnderlineOffset: '3px',
  },
  '.cm-scInsert': {
    display: 'inline-block',
    width: '0',
    height: '1.2em',
    verticalAlign: 'text-bottom',
    borderLeft: '2px solid currentColor',
    margin: '0 1px',
  },
  '.cm-scInsert.cm-sc-semantic': { color: 'var(--diff-semantic)' },
  '.cm-scInsert.cm-sc-structural': { color: 'var(--diff-structural)' },
  '.cm-scInsert.cm-sc-formatting': { color: 'var(--diff-formatting)' },
  '.cm-scHover': { outline: '1px solid var(--accent-2)', outlineOffset: '1px' },
  '.cm-scActive': {
    outline: '2px solid var(--accent-1)',
    outlineOffset: '1px',
    animation: 'cm-sc-pulse 900ms var(--ease-out) 1',
  },
  '@keyframes cm-sc-pulse': {
    '0%': { boxShadow: '0 0 0 0 hsl(250 95% 70% / 0.7)' },
    '100%': { boxShadow: '0 0 0 8px hsl(250 95% 70% / 0)' },
  },
  '.cm-scGutterMark': { fontSize: '0.85em', cursor: 'default' },
  '.cm-scGutterMark.cm-sc-semantic': { color: 'var(--diff-semantic)' },
  '.cm-scGutterMark.cm-sc-structural': { color: 'var(--diff-structural)' },
  '.cm-scGutterMark.cm-sc-formatting': { color: 'var(--diff-formatting)' },
});

export interface HighlightHandlers {
  /** Pointer over a highlighted difference (null: none). */
  hover: (id: string | null) => void;
  /** Click on a highlighted difference. */
  select: (id: string) => void;
}

const diffAt = (e: Event) =>
  (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-diff]')?.dataset.diff ?? null;

export function highlightExtensions(handlers: HighlightHandlers): Extension[] {
  return [
    highlightField,
    classGutter,
    highlightTheme,
    EditorView.domEventHandlers({
      mouseover: (e) => {
        handlers.hover(diffAt(e));
        return false;
      },
      mouseleave: () => {
        handlers.hover(null);
        return false;
      },
      click: (e) => {
        const id = diffAt(e);
        if (id) handlers.select(id);
        return false;
      },
    }),
  ];
}
