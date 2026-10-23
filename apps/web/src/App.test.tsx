import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { useCompareStore } from './store/compare';

const editorText = (label: string) =>
  EditorView.findFromDOM(screen.getByLabelText(label))?.state.doc.toString();

describe('App shell', () => {
  it('renders the heading and both editors', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('SQL Compare');
    expect(screen.getByLabelText('Left SQL')).toBeInTheDocument();
    expect(screen.getByLabelText('Right SQL')).toBeInTheDocument();
  });

  it('defaults to PostgreSQL and L2', () => {
    render(<App />);
    expect(screen.getByLabelText('Dialect')).toHaveValue('postgresql');
    expect(screen.getByText('Normalize: L2')).toBeInTheDocument();
  });

  it('toggles the theme', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('input and raw diff', () => {
  it('shows the empty state until an example is loaded', () => {
    render(<App />);
    expect(screen.getByTestId('diff-status')).toHaveTextContent(
      'Paste SQL on both sides to compare',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));

    expect(screen.queryByRole('button', { name: 'Try an example' })).not.toBeInTheDocument();
    expect(editorText('Left SQL')).toContain('INNER JOIN orders');
    expect(editorText('Right SQL')).toContain('left join orders');
    expect(screen.getByTestId('diff-status')).toHaveTextContent(/\d+ changes? · \+\d+ −\d+ lines/);
  });

  it('reports identical text', () => {
    render(<App />);
    act(() => {
      useCompareStore.getState().setText('left', 'SELECT 1;');
      useCompareStore.getState().setText('right', 'SELECT 1;');
    });
    expect(screen.getByTestId('diff-status')).toHaveTextContent('Identical text');
  });

  it('counts added and removed lines', () => {
    render(<App />);
    act(() => {
      useCompareStore.getState().setText('left', 'SELECT a\nFROM t\nWHERE x = 1');
      useCompareStore.getState().setText('right', 'SELECT a\nFROM t\nWHERE x = 2\nLIMIT 5');
    });
    expect(screen.getByTestId('diff-status')).toHaveTextContent('1 change · +2 −1 lines');
  });

  it('uploads a file into one side and shows its name', async () => {
    render(<App />);
    const file = new File(['SELECT id FROM users;'], 'users.sql', { type: 'application/sql' });
    fireEvent.change(screen.getByTestId('right-file-input'), { target: { files: [file] } });

    await waitFor(() => expect(editorText('Right SQL')).toBe('SELECT id FROM users;'));
    expect(screen.getByText('users.sql')).toBeInTheDocument();
    expect(editorText('Left SQL')).toBe('');
  });

  it('shows a friendly error for unsupported file types', async () => {
    render(<App />);
    const file = new File(['GIF89a'], 'cat.gif');
    fireEvent.change(screen.getByTestId('left-file-input'), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a supported file type/);
    expect(editorText('Left SQL')).toBe('');
  });

  it('loads a dropped file into the side it was dropped on', async () => {
    render(<App />);
    const file = new File(['SELECT 42;'], 'drop.sql');
    // jsdom has no layout, so every drop resolves to the left half.
    fireEvent.drop(screen.getByRole('region', { name: 'SQL editors' }), {
      dataTransfer: { files: [file], types: ['Files'] },
    });
    await waitFor(() => expect(editorText('Left SQL')).toBe('SELECT 42;'));
  });

  it('swaps and clears sides', () => {
    render(<App />);
    act(() => {
      useCompareStore.getState().setText('left', 'SELECT 1');
      useCompareStore.getState().setText('right', 'SELECT 2');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Swap sides' }));
    expect(editorText('Left SQL')).toBe('SELECT 2');
    expect(editorText('Right SQL')).toBe('SELECT 1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear left side' }));
    expect(editorText('Left SQL')).toBe('');
    expect(screen.getByRole('button', { name: 'Clear left side' })).toBeDisabled();
  });

  it('restores persisted drafts on mount', () => {
    act(() => useCompareStore.getState().setText('left', 'SELECT restored'));
    render(<App />);
    expect(editorText('Left SQL')).toBe('SELECT restored');
  });
});

const editorView = (label: string) => EditorView.findFromDOM(screen.getByLabelText(label))!;

function setBoth(left: string, right: string) {
  act(() => {
    useCompareStore.getState().setText('left', left);
    useCompareStore.getState().setText('right', right);
  });
}

describe('formatting', () => {
  it('shows a read-only formatted view and keeps the original byte-identical', async () => {
    const original = 'select a, b from t where x = 1';
    setBoth(original, 'SELECT 1');
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Format left side' }));
    // Read-only at once; the formatted text arrives from the formatter.
    expect(editorView('Left SQL').state.readOnly).toBe(true);
    await waitFor(() =>
      expect(editorText('Left SQL')).toBe('SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1'),
    );
    expect(editorView('Left SQL').state.readOnly).toBe(true);
    expect(screen.getByText('Formatted · read-only')).toBeInTheDocument();
    expect(useCompareStore.getState().left.text).toBe(original);

    fireEvent.click(screen.getByRole('button', { name: 'Format left side' }));
    expect(editorText('Left SQL')).toBe(original);
    expect(editorView('Left SQL').state.readOnly).toBe(false);
  });

  it('switches both sides from the view bar', async () => {
    setBoth('select 1', 'select 2');
    render(<App />);
    fireEvent.click(screen.getByRole('radio', { name: 'Formatted' }));
    await waitFor(() => expect(editorText('Left SQL')).toBe('SELECT\n  1'));
    expect(editorText('Right SQL')).toBe('SELECT\n  2');

    // Mixed views: neither option is selected.
    fireEvent.click(screen.getByRole('button', { name: 'Format right side' }));
    expect(screen.getByRole('radio', { name: 'Formatted' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Original' })).not.toBeChecked();
  });

  it('applies formatting options', async () => {
    setBoth('SELECT a FROM t', 'SELECT 1');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Formatting options' }));
    fireEvent.change(screen.getByLabelText('Keyword case'), { target: { value: 'lower' } });
    fireEvent.change(screen.getByLabelText('Indent'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Format left side' }));
    await waitFor(() => expect(editorText('Left SQL')).toBe('select\n    a\nfrom\n    t'));
  });

  it('falls back to the original with a warning when formatting fails', async () => {
    setBoth('SELECT (a FROM t', 'SELECT 1');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Format left side' }));

    expect(await screen.findByText(/Couldn't format original SQL/)).toBeInTheDocument();
    expect(editorText('Left SQL')).toBe('SELECT (a FROM t');
    expect(screen.getByRole('button', { name: 'Format left side' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clearing a formatted side makes it editable again', () => {
    setBoth('select 1', 'select 2');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Format left side' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear left side' }));
    expect(editorView('Left SQL').state.readOnly).toBe(false);
  });
});

describe('classification summary', () => {
  it('reports formatting-only differences', async () => {
    render(<App />);
    setBoth('SELECT a, b FROM t WHERE x = 1', 'select a,\n  b\nfrom t -- note\nwhere x = 1');
    await waitFor(() => expect(screen.getByTestId('verdict')).toHaveTextContent('Formatting only'));
    const counts = screen.getByRole('list', { name: 'Differences by category' });
    expect(counts).toHaveTextContent('Semantic0');
    expect(counts).toHaveTextContent('Structural0');
  });

  it('reports potentially semantic differences for the example', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));
    await waitFor(() =>
      expect(screen.getByTestId('verdict')).toHaveTextContent('Potentially semantic'),
    );
  });
});

describe('parsing and fallback', () => {
  const waitForResult = () =>
    waitFor(() => expect(useCompareStore.getState().result).not.toBeNull(), { timeout: 5000 });

  it('parses with the real PostgreSQL parser', async () => {
    render(<App />);
    setBoth('SELECT 1', 'SELECT 2');
    await waitForResult();
    expect(useCompareStore.getState().result?.parser).toMatch(/libpg-query/);
  });

  it('shows the parse error location, marks the statement, and still diffs it', async () => {
    render(<App />);
    setBoth('SELECT 1;\nSELECT (a FROM t;', 'SELECT 1;\nSELECT (b FROM t;');

    const pills = await screen.findAllByRole(
      'button',
      { name: 'Parse error L2:11' },
      { timeout: 5000 },
    );
    expect(pills).toHaveLength(2);
    const pill = pills[0]!;
    expect(screen.getAllByText('⚠ No structural comparison')).toHaveLength(2);
    expect(screen.getByTestId('verdict')).toHaveTextContent('Unknown (unparsed SQL)');
    expect(useCompareStore.getState().result?.stats.unknown).toBe(1);

    fireEvent.click(pill);
    const view = editorView('Left SQL');
    expect(view.state.selection.main.head).toBe('SELECT 1;\nSELECT (a '.length);
  });

  it('jumping to an error from the formatted view switches back to the original', async () => {
    render(<App />);
    setBoth('SELECT (a FROM t', 'SELECT 1');
    await screen.findByRole('button', { name: 'Parse error L1:11' }, { timeout: 5000 });
    // Formatting the unparseable side fails and falls back, so format the right side instead.
    fireEvent.click(screen.getByRole('button', { name: 'Format right side' }));
    act(() => useCompareStore.getState().setView('left', 'formatted'));
    fireEvent.click(screen.getByRole('button', { name: 'Parse error L1:11' }));
    await waitFor(() => expect(useCompareStore.getState().views.left).toBe('original'));
  });

  it('labels statements the parser does not support', async () => {
    render(<App />);
    act(() => useCompareStore.getState().setDialect('mysql'));
    setBoth('SET NAMES utf8;\nSELECT 1;', 'SET NAMES utf8mb4;\nSELECT 1;');
    expect(
      await screen.findAllByText('1 compared as text', undefined, { timeout: 5000 }),
    ).toHaveLength(2);
    expect(screen.getAllByText('◇ No structural comparison')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Parse error/ })).not.toBeInTheDocument();
  });

  it('runs a token diff only in Generic mode', async () => {
    render(<App />);
    act(() => useCompareStore.getState().setDialect('generic'));
    setBoth('SELECT (a FROM t', 'SELECT (b FROM t');
    expect(await screen.findByText('Token diff only', undefined, { timeout: 5000 })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Parse error/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('verdict')).toHaveTextContent('Potentially semantic');
  });
});

describe('normalization', () => {
  const verdict = () => screen.getByTestId('verdict');
  const settled = (text: string | RegExp) =>
    waitFor(() => expect(verdict()).toHaveTextContent(text), { timeout: 5000 });

  it('reports INNER JOIN vs JOIN with a quoted table as structural (L2)', async () => {
    render(<App />);
    setBoth(
      'SELECT a FROM t INNER JOIN u ON t.id = u.id',
      'SELECT a FROM "t" JOIN u ON t.id = u.id',
    );
    await settled('Equivalent (structural)');
    expect(screen.getByRole('list', { name: 'Differences by category' })).toHaveTextContent(
      'Structural1',
    );
  });

  it('offers aggressive normalization for reordered predicates', async () => {
    render(<App />);
    setBoth('SELECT a FROM t WHERE x=1 AND y=2', 'SELECT a FROM t WHERE y = 2 AND x = 1');
    await settled('Potentially semantic');
    expect(screen.getByText(/may be structural under aggressive normalization/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Enable Aggressive' }));
    await settled('Equivalent (structural)');
    expect(screen.getByRole('button', { name: 'Normalize: L3 · Aggressive' })).toBeVisible();
    expect(screen.queryByText(/may be structural/)).not.toBeInTheDocument();
  });

  it('lets each rule be turned off', async () => {
    render(<App />);
    setBoth('SELECT a FROM t INNER JOIN u ON true', 'SELECT a FROM t JOIN u ON true');
    await settled('Equivalent (structural)');

    fireEvent.click(screen.getByRole('button', { name: 'Normalize: L2' }));
    const rule = screen.getByRole('checkbox', { name: /Canonical join keywords/ });
    expect(rule).toBeChecked();
    fireEvent.click(rule);
    await settled('Potentially semantic');
    expect(useCompareStore.getState().normalization.disabledRules).toEqual(['join-synonyms']);
    // L1 whitespace/comments define formatting and can't be turned off; L3 is off by default.
    expect(screen.getByRole('checkbox', { name: /Collapse whitespace/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Sort AND \/ OR operands/ })).not.toBeChecked();
  });

  it('lists the transformations applied with counts and examples', async () => {
    render(<App />);
    setBoth('select a from t where b != 1', 'SELECT a FROM t WHERE b <> 1');
    await settled('Equivalent (structural)');
    fireEvent.click(screen.getByRole('button', { name: /Transformations/ }));
    const panel = screen.getByRole('group', { name: /Transformations applied/ });
    expect(panel).toHaveTextContent('Canonical not-equal operator');
    expect(panel).toHaveTextContent('b != 1 → b <> 1');
    expect(panel).toHaveTextContent('Uppercase keywords');
  });

  it('shows read-only normalized SQL in the Normalized view', async () => {
    render(<App />);
    setBoth('select A from T inner join U on true;', 'SELECT 1');
    await settled(/./);
    fireEvent.click(screen.getByRole('radio', { name: 'Normalized' }));
    await waitFor(() =>
      expect(editorText('Left SQL')).toBe('SELECT\n  a\nFROM\n  t\n  JOIN u ON TRUE;'),
    );
    expect(editorView('Left SQL').state.readOnly).toBe(true);
    expect(screen.getAllByText('Normalized · read-only')).toHaveLength(2);
    expect(useCompareStore.getState().left.text).toBe('select A from T inner join U on true;');
  });
});

describe('differences panel and navigation', () => {
  const LEFT = 'SELECT a, b FROM t JOIN u ON t.id = u.id WHERE x = 1';
  const RIGHT = 'select a, b, c\nFROM t LEFT JOIN u ON t.id = u.id WHERE x = 2';
  const panel = () => screen.getByRole('region', { name: /Differences/ });
  const entries = () =>
    within(panel()).queryAllByRole('button', {
      name: /^(Semantic|Structural|Formatting|Unknown):/,
    });
  const ready = () => waitFor(() => expect(entries().length).toBeGreaterThan(0), { timeout: 5000 });

  it('lists differences grouped by statement and clause, with descriptions', async () => {
    render(<App />);
    setBoth(LEFT, RIGHT);
    await ready();
    expect(
      within(panel()).getByRole('heading', { name: 'Statement 1 · SELECT' }),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('heading', { name: 'FROM' })).toBeInTheDocument();
    expect(panel()).toHaveTextContent('JOIN u changed from INNER to LEFT');
    expect(within(panel()).getByText('u', { selector: 'code' })).toBeInTheDocument();
    // Formatting is hidden by default (FR-5.3).
    const classes = entries().map((e) => e.textContent!.split(':')[0]);
    expect(classes).not.toContain('Formatting');
  });

  it('filters categories independently', async () => {
    render(<App />);
    setBoth(LEFT, RIGHT);
    await ready();
    const before = entries().length;
    fireEvent.click(screen.getByRole('button', { name: /^Formatting \d+$/ }));
    expect(entries().length).toBeGreaterThan(before);
    fireEvent.click(screen.getByRole('button', { name: /^Semantic \d+$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Formatting \d+$/ }));
    expect(panel()).toHaveTextContent(/hidden by the filters/);
  });

  it('selects entries by click and with n / p / F7', async () => {
    render(<App />);
    setBoth(LEFT, RIGHT);
    await ready();
    const position = screen.getByTestId('diff-position');
    expect(position).toHaveTextContent('– / 3');

    fireEvent.click(entries()[1]!);
    expect(entries()[1]).toHaveAttribute('aria-current', 'true');
    expect(position).toHaveTextContent('2 / 3');

    fireEvent.keyDown(document.body, { key: 'n' });
    expect(position).toHaveTextContent('3 / 3');
    fireEvent.keyDown(document.body, { key: 'F7' });
    expect(position).toHaveTextContent('1 / 3');
    fireEvent.keyDown(document.body, { key: 'F7', shiftKey: true });
    expect(position).toHaveTextContent('3 / 3');
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(position).toHaveTextContent('2 / 3');
    // Typing in a field never navigates.
    fireEvent.keyDown(screen.getByLabelText('Dialect'), { key: 'n' });
    expect(position).toHaveTextContent('2 / 3');
  });

  it('highlights visible differences in both editors', async () => {
    render(<App />);
    setBoth(LEFT, RIGHT);
    await ready();
    await waitFor(() => expect(document.querySelectorAll('.cm-scMark').length).toBeGreaterThan(0));
    const marks = [...document.querySelectorAll('.cm-scMark.cm-sc-semantic')].map(
      (m) => m.textContent,
    );
    expect(marks).toEqual(expect.arrayContaining(['1', '2', 'LEFT', 'c']));
    fireEvent.click(entries()[0]!);
    await waitFor(() =>
      expect(document.querySelectorAll('.cm-scActive').length).toBeGreaterThan(0),
    );
  });

  it('exports Markdown, HTML and JSON reports as downloads', async () => {
    const blobs: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        blobs.push(b);
        return 'blob:report';
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    setBoth(LEFT, RIGHT);
    await ready();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Export' }));
    for (const format of ['Markdown', 'HTML', 'JSON']) {
      fireEvent.click(screen.getByRole('button', { name: format }));
    }
    expect(click).toHaveBeenCalledTimes(3);
    // jsdom's Blob has no text().
    const read = (b: Blob) =>
      new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(b);
      });
    const [md, html, json] = await Promise.all(blobs.map(read));
    expect(md).toContain('JOIN `u` changed from INNER to LEFT');
    expect(html).toContain('<code>u</code>');
    expect(JSON.parse(json!).verdict).toBe('potentially-semantic');
    click.mockRestore();
  });

  it('switches to the inline view and back', async () => {
    render(<App />);
    setBoth(LEFT, RIGHT);
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Inline' }));
    expect(screen.getByTestId('merge-view')).toHaveAttribute('data-layout', 'unified');
    expect(screen.queryByLabelText('Left SQL')).not.toBeInTheDocument();
    expect(editorText('Right SQL')).toBe(RIGHT);
    fireEvent.click(screen.getByRole('radio', { name: 'Side-by-side' }));
    expect(editorText('Left SQL')).toBe(LEFT);
  });

  it('docks, hides and shows the panel', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Dock panel to the right' }));
    expect(useCompareStore.getState().panel.dock).toBe('right');
    fireEvent.click(screen.getByRole('button', { name: 'Hide differences panel' }));
    expect(screen.queryByRole('region', { name: /Differences/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show differences' }));
    expect(screen.getByRole('region', { name: /Differences/ })).toBeInTheDocument();
  });
});
