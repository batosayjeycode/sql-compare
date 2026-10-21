import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { ComparisonResult, StatementInfo } from '@sql-compare/core';

/**
 * Parse errors and "no structural comparison" badges in the editors (FR-7).
 * Only shown on the original view, where the result's offsets apply.
 */

interface Badge {
  pos: number;
  status: 'error' | 'unsupported';
  title: string;
}

class BadgeWidget extends WidgetType {
  constructor(private readonly badge: Badge) {
    super();
  }

  override eq(other: BadgeWidget) {
    return other.badge.status === this.badge.status && other.badge.title === this.badge.title;
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-stmtBadge cm-stmtBadge-${this.badge.status}`;
    el.title = this.badge.title;
    el.textContent = `${this.badge.status === 'error' ? '⚠' : '◇'} No structural comparison`;
    return el;
  }

  override ignoreEvent() {
    return false;
  }
}

const setBadges = StateEffect.define<Badge[]>();

const badgeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setBadges)) {
        return Decoration.set(
          e.value.map((b) =>
            Decoration.widget({ widget: new BadgeWidget(b), side: 1 }).range(b.pos),
          ),
          true,
        );
      }
    }
    return tr.docChanged ? decorations.map(tr.changes) : decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const badgeTheme = EditorView.baseTheme({
  '.cm-stmtBadge': {
    display: 'inline-block',
    marginLeft: '1.5ch',
    padding: '0 0.8ch',
    borderRadius: '999px',
    border: '1px solid currentColor',
    fontFamily: 'var(--font-ui)',
    fontSize: '0.85em',
    lineHeight: '1.5',
    verticalAlign: 'middle',
    cursor: 'help',
  },
  '.cm-stmtBadge-error': { color: 'var(--diff-removed)' },
  '.cm-stmtBadge-unsupported': { color: 'var(--text-muted)' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--diff-removed)',
    textUnderlineOffset: '3px',
  },
});

export function analysisExtensions(): Extension[] {
  return [lintGutter(), badgeField, badgeTheme];
}

/** End of the token at `offset` (or `offset` itself at end of input). */
function tokenEnd(text: string, offset: number): number {
  const match = /^[\w$]+|^\S/.exec(text.slice(offset, offset + 200));
  return offset + (match?.[0].length ?? 0);
}

function badgeFor(view: EditorView, s: StatementInfo): Badge | null {
  if (s.status !== 'error' && s.status !== 'unsupported') return null;
  const line = view.state.doc.lineAt(Math.min(s.start, view.state.doc.length));
  return {
    pos: Math.min(line.to, s.end),
    status: s.status,
    title:
      s.status === 'error'
        ? `Couldn't parse this statement, so its changes are compared as text and classified as unknown. ${s.message ?? ''}`
        : (s.message ?? 'Compared as text.'),
  };
}

/** Show (or clear, with `result` null) one side's parse errors and badges. */
export function showAnalysis(
  view: EditorView,
  side: 'left' | 'right',
  result: ComparisonResult | null,
) {
  const text = view.state.doc.toString();
  const applies = result !== null && result.views[side].original === text;
  const diagnostics: Diagnostic[] = applies
    ? result.errors
        .filter((e) => e.side === side)
        .map((e) => ({
          from: e.offset,
          to: tokenEnd(text, e.offset),
          severity: 'error',
          message: `${e.message} (line ${e.line}, column ${e.column})`,
          ...(result.parser ? { source: result.parser } : {}),
        }))
    : [];
  const badges = applies
    ? result.statements[side].map((s) => badgeFor(view, s)).filter((b): b is Badge => b !== null)
    : [];
  view.dispatch(setDiagnostics(view.state, diagnostics), { effects: setBadges.of(badges) });
}
