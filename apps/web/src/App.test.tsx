import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
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
  it('shows a read-only formatted view and keeps the original byte-identical', () => {
    const original = 'select a, b from t where x = 1';
    setBoth(original, 'SELECT 1');
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Format left side' }));
    expect(editorText('Left SQL')).toBe('SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1');
    expect(editorView('Left SQL').state.readOnly).toBe(true);
    expect(screen.getByText('Formatted · read-only')).toBeInTheDocument();
    expect(useCompareStore.getState().left.text).toBe(original);

    fireEvent.click(screen.getByRole('button', { name: 'Format left side' }));
    expect(editorText('Left SQL')).toBe(original);
    expect(editorView('Left SQL').state.readOnly).toBe(false);
  });

  it('switches both sides from the view bar', () => {
    setBoth('select 1', 'select 2');
    render(<App />);
    fireEvent.click(screen.getByRole('radio', { name: 'Formatted' }));
    expect(editorText('Left SQL')).toBe('SELECT\n  1');
    expect(editorText('Right SQL')).toBe('SELECT\n  2');

    // Mixed views: neither option is selected.
    fireEvent.click(screen.getByRole('button', { name: 'Format right side' }));
    expect(screen.getByRole('radio', { name: 'Formatted' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Original' })).not.toBeChecked();
  });

  it('applies formatting options', () => {
    setBoth('SELECT a FROM t', 'SELECT 1');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Formatting options' }));
    fireEvent.change(screen.getByLabelText('Keyword case'), { target: { value: 'lower' } });
    fireEvent.change(screen.getByLabelText('Indent'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Format left side' }));
    expect(editorText('Left SQL')).toBe('select\n    a\nfrom\n    t');
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
