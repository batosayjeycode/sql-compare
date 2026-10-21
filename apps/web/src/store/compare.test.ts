import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleFor } from '../lib/samples';
import { initialState, STORAGE_KEY, useCompareStore } from './compare';

const store = () => useCompareStore.getState();

function stored(): Record<string, unknown> {
  vi.advanceTimersByTime(1000);
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { state: Record<string, unknown> }).state : {};
}

describe('compare store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('swaps sides including file names', () => {
    store().loadFile('left', 'SELECT 1', 'a.sql');
    store().setText('right', 'SELECT 2');
    store().swap();
    expect(store().left).toEqual({ text: 'SELECT 2', fileName: null });
    expect(store().right).toEqual({ text: 'SELECT 1', fileName: 'a.sql' });
  });

  it('clears one side only', () => {
    store().setText('left', 'a');
    store().setText('right', 'b');
    store().clear('left');
    expect(store().left.text).toBe('');
    expect(store().right.text).toBe('b');
  });

  it('loads the sample for the active dialect', () => {
    store().setDialect('mysql');
    store().loadSample();
    expect(store().left.text).toBe(sampleFor('mysql').left);
    expect(store().right.text).toBe(sampleFor('mysql').right);
  });

  it('persists drafts and preferences to localStorage (debounced)', () => {
    store().setText('left', 'SELECT 1');
    store().setDialect('mysql');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(stored()).toMatchObject({
      dialect: 'mysql',
      persistDrafts: true,
      left: { text: 'SELECT 1', fileName: null },
    });
  });

  it('drops stored drafts when persistence is turned off', () => {
    store().setText('left', 'SELECT secret');
    store().setPersistDrafts(false);
    const state = stored();
    expect(state).toMatchObject({ persistDrafts: false });
    expect(state).not.toHaveProperty('left');
    expect(state).not.toHaveProperty('right');
  });

  it('never persists transient notices', () => {
    store().notify('error', 'boom');
    expect(stored()).not.toHaveProperty('notice');
  });
});

describe('views', () => {
  it('resets a side to the original view when cleared', () => {
    useCompareStore.getState().setAllViews('formatted');
    useCompareStore.getState().clear('left');
    expect(useCompareStore.getState().views).toEqual({ left: 'original', right: 'formatted' });
  });

  it('swaps views together with content', () => {
    useCompareStore.getState().setView('left', 'formatted');
    useCompareStore.getState().swap();
    expect(useCompareStore.getState().views).toEqual({ left: 'original', right: 'formatted' });
  });

  it('persists format options and fills in missing ones', async () => {
    vi.useFakeTimers();
    useCompareStore.getState().setFormatOptions({ keywordCase: 'lower' });
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.state.formatOptions.keywordCase).toBe('lower');

    useCompareStore.setState(initialState);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { formatOptions: { useTabs: true } }, version: 1 }),
    );
    await useCompareStore.persist.rehydrate();
    expect(useCompareStore.getState().formatOptions).toMatchObject({
      useTabs: true,
      keywordCase: 'upper',
      indentWidth: 2,
    });
  });
});

describe('normalization settings', () => {
  it('toggles rules and persists the settings', () => {
    vi.useFakeTimers();
    useCompareStore.getState().toggleRule('alias-as');
    useCompareStore.getState().setNormalization({ aggressive: true });
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.normalization).toEqual({
      aggressive: true,
      disabledRules: ['alias-as'],
      caseInsensitiveTables: false,
    });
    useCompareStore.getState().toggleRule('alias-as');
    expect(useCompareStore.getState().normalization.disabledRules).toEqual([]);
  });
});
