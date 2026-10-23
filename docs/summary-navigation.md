# Summary, navigation and export (M6)

M6 puts the classified differences from M5 on screen and makes them easy to work through.

## Highlight layer (FR-5, FR-5.3)

The raw text diff from `@codemirror/merge` stays as it is: changed lines, changed characters, and `+`/`−` in the gutter. On top of it, every difference that passes the filters is marked in both editors (`apps/web/src/editor/highlights.ts`):

| Class                  | Mark                     | Icon |
| ---------------------- | ------------------------ | ---- |
| Semantic (and unknown) | amber underline and tint | ⚠    |
| Structural             | violet dashed underline  | ≡    |
| Formatting             | gray dotted underline    | ¶    |

- **Insertion points** (something added on the other side) show as a thin caret.
- **Gutter icon:** a second gutter shows the most significant class on each line, so a class is never shown by color alone.
- **Default filters:** formatting differences are hidden by default.

**Views.** Result ranges are offsets in the original SQL. `createViewMapper` (`packages/core/src/views.ts`) maps them into whichever view a side shows:

- **Original:** offsets map as is.
- **Formatted:** the formatter keeps every significant token in order (verified in M2), so tokens map one to one.
- **Normalized:** the comparison returns the source position of every normalized token (`views.*.normalizedSources`), so reordered tokens map back as well.

If a view no longer matches the result, for example while a comparison is pending, that view shows no highlights until the new result arrives.

## Differences panel (FR-6.1)

The panel lists every difference that passes the filters, grouped by statement and then by clause. Formatting and structural entries are filed under their clause too. Each entry shows:

- the class icon
- the description, with SQL in `code`
- the severity
- the rules that resolved it (structural) or the L3 hint

Entries are buttons. The accessible name is the class followed by the description, so screen readers hear the same text that is shown.

- **Click:** selects the difference, outlines it on both sides with a short pulse, and scrolls to it. Both panes share one scroll container, so the side that has text to show is centered and the aligned counterpart appears next to it.
- **Hover or focus:** an entry, or a highlight in either editor, highlights the difference on both sides.
- **Layout:** the panel docks below or to the right of the editors. Resize it by dragging the separator or with the arrow keys. It can be hidden and shown again. On screens under 900 px it always sits below the editors.

## Navigation and modes (FR-5.1, FR-5.2)

| Action                     | How                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Next / previous difference | `n` / `p` when focus is not in a text field or editor; `F7` / `Shift+F7` anywhere (also inside an editor); ◀ Prev / Next ▶ buttons |
| Filter categories          | Semantic, Structural, Formatting toggles in the view bar (they apply to highlights, the list, navigation and, optionally, export)  |
| Side-by-side / inline      | Mode switch. Inline uses `unifiedMergeView`: one editor (the right side) with the left side shown as deleted lines                 |
| Collapse unchanged         | Folds runs of six or more unchanged lines (three lines of context)                                                                 |

Navigation wraps around. The position (`2 / 7`) is announced to screen readers.

## Export (FR-6.2)

**Export** in the panel saves the report as Markdown, standalone HTML or JSON (`packages/core/src/report.ts`). The file is created in the browser and downloaded, and nothing is uploaded. All formats contain:

- the verdict, counts, dialect, normalization level and parser
- every difference grouped by statement and clause, with class, severity, description, notes, and `line:column` on each side
- the transformations applied, rules rolled back, and parse errors

The JSON also contains each difference's offsets, the highlighted text, its path and rule ids. The HTML is escaped, has no scripts or external resources, and follows the reader's light or dark preference. Optionally, only the categories shown by the filters are exported.

## Notes and limits

- **Hover linking** works per difference: hovering any highlighted token highlights the whole counterpart range. Unchanged tokens are already aligned line by line by the merge view.
- **Inline mode:** only the right side is an editor, so highlights and parse-error markers are shown there. Jumping to a left-side parse error switches back to side-by-side.
- **Mobile:** the layout works (stacked editors, panel below), but tab-based mobile layouts and inline-by-default on small screens are part of M7.
- **Light theme contrast:** the light theme now has darker category colors (semantic, structural, formatting), which the new axe checks required.
