import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import {
  DEFAULT_FORMAT_OPTIONS,
  DEFAULT_OPTIONS,
  type ComparisonResult,
  type Dialect,
  type FormatOptions,
} from '@sql-compare/core';
import { sampleFor } from '../lib/samples';

export type Side = 'left' | 'right';
export type Theme = 'dark' | 'light';
/** Which text an editor shows (FR-3.1). The original is never modified by a view switch. */
export type SideView = 'original' | 'formatted' | 'normalized';

/** Normalization settings (PLAN §5.4). Default: L2 with every rule on. */
export interface NormalizationSettings {
  /** L3 "Aggressive normalization": safe structural reordering. */
  aggressive: boolean;
  /** Rules the user turned off. */
  disabledRules: string[];
  /** MySQL lower_case_table_names: table names compare case-insensitively. */
  caseInsensitiveTables: boolean;
}

export const DEFAULT_NORMALIZATION: NormalizationSettings = {
  aggressive: false,
  disabledRules: [],
  caseInsensitiveTables: false,
};

export interface SideInput {
  text: string;
  /** Name of the uploaded file, or null for pasted/typed SQL. */
  fileName: string | null;
}

export interface Notice {
  id: number;
  kind: 'error' | 'warning' | 'info';
  message: string;
}

/** Raw line diff summary, derived from the merge view's chunks. */
export interface DiffSummary {
  chunks: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface CompareState {
  left: SideInput;
  right: SideInput;
  dialect: Dialect;
  theme: Theme;
  /** Auto-save drafts to localStorage (FR-1.2, opt-out). */
  persistDrafts: boolean;
  notice: Notice | null;
  diff: DiffSummary | null;
  views: Record<Side, SideView>;
  formatOptions: FormatOptions;
  normalization: NormalizationSettings;
  /** Latest comparison of the two originals (debounced, computed in a worker). */
  result: ComparisonResult | null;
  /** True while a comparison for the current inputs is pending. */
  comparing: boolean;

  setText: (side: Side, text: string) => void;
  loadFile: (side: Side, text: string, fileName: string) => void;
  clear: (side: Side) => void;
  swap: () => void;
  loadSample: () => void;
  setDialect: (dialect: Dialect) => void;
  toggleTheme: () => void;
  setPersistDrafts: (persist: boolean) => void;
  notify: (kind: Notice['kind'], message: string) => void;
  dismissNotice: () => void;
  setDiff: (diff: DiffSummary | null) => void;
  setView: (side: Side, view: SideView) => void;
  setAllViews: (view: SideView) => void;
  setNormalization: (settings: Partial<NormalizationSettings>) => void;
  toggleRule: (id: string) => void;
  setFormatOptions: (options: Partial<FormatOptions>) => void;
  resetFormatOptions: () => void;
  setResult: (result: ComparisonResult | null) => void;
  setComparing: (comparing: boolean) => void;
}

const EMPTY_SIDE: SideInput = { text: '', fileName: null };
export const STORAGE_KEY = 'sql-compare:v1';
const WRITE_DELAY_MS = 300;

/**
 * localStorage wrapper that debounces writes (drafts change on every keystroke),
 * ignores updates that don't change the persisted slice, flushes on page hide,
 * and swallows storage errors (private mode, quota exceeded).
 */
function debouncedLocalStorage(): StateStorage {
  const pending = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>();
  const written = new Map<string, string>();

  const write = (name: string, value: string) => {
    pending.delete(name);
    written.set(name, value);
    try {
      localStorage.setItem(name, value);
    } catch (err) {
      console.warn('[sql-compare] could not save drafts', err);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      for (const [name, { value, timer }] of pending) {
        clearTimeout(timer);
        write(name, value);
      }
    });
  }

  return {
    getItem: (name) => {
      try {
        const value = localStorage.getItem(name);
        if (value !== null) written.set(name, value);
        return value;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      const queued = pending.get(name);
      // Unrelated store updates (results, notices) re-serialize the same slice.
      if (value === (queued?.value ?? written.get(name))) return;
      if (queued) clearTimeout(queued.timer);
      pending.set(name, { value, timer: setTimeout(() => write(name, value), WRITE_DELAY_MS) });
    },
    removeItem: (name) => {
      const queued = pending.get(name);
      if (queued) clearTimeout(queued.timer);
      pending.delete(name);
      written.delete(name);
      try {
        localStorage.removeItem(name);
      } catch {
        // ignore
      }
    },
  };
}

let noticeId = 0;

export const initialState = {
  left: EMPTY_SIDE,
  right: EMPTY_SIDE,
  dialect: DEFAULT_OPTIONS.dialect,
  theme: 'dark' as Theme,
  persistDrafts: true,
  notice: null,
  diff: null,
  views: { left: 'original', right: 'original' } as Record<Side, SideView>,
  formatOptions: DEFAULT_FORMAT_OPTIONS,
  normalization: DEFAULT_NORMALIZATION,
  result: null,
  comparing: false,
} satisfies Partial<CompareState>;

export const useCompareStore = create<CompareState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setText: (side, text) =>
        set((s) => (s[side].text === text ? s : { [side]: { ...s[side], text } })),
      loadFile: (side, text, fileName) => set({ [side]: { text, fileName } }),
      // A cleared side returns to the editable original view.
      clear: (side) =>
        set((s) => ({ [side]: EMPTY_SIDE, views: { ...s.views, [side]: 'original' } })),
      swap: () =>
        set((s) => ({
          left: s.right,
          right: s.left,
          views: { left: s.views.right, right: s.views.left },
        })),
      loadSample: () => {
        const sample = sampleFor(get().dialect);
        set({
          left: { text: sample.left, fileName: null },
          right: { text: sample.right, fileName: null },
        });
      },
      setDialect: (dialect) => set({ dialect }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setPersistDrafts: (persistDrafts) => set({ persistDrafts }),
      notify: (kind, message) => set({ notice: { id: ++noticeId, kind, message } }),
      dismissNotice: () => set({ notice: null }),
      setDiff: (diff) => set({ diff }),
      setView: (side, view) => set((s) => ({ views: { ...s.views, [side]: view } })),
      setAllViews: (view) => set({ views: { left: view, right: view } }),
      setNormalization: (settings) =>
        set((s) => ({ normalization: { ...s.normalization, ...settings } })),
      toggleRule: (id) =>
        set((s) => {
          const disabled = s.normalization.disabledRules;
          return {
            normalization: {
              ...s.normalization,
              disabledRules: disabled.includes(id)
                ? disabled.filter((r) => r !== id)
                : [...disabled, id],
            },
          };
        }),
      setFormatOptions: (options) =>
        set((s) => ({ formatOptions: { ...s.formatOptions, ...options } })),
      resetFormatOptions: () => set({ formatOptions: DEFAULT_FORMAT_OPTIONS }),
      setResult: (result) => set({ result }),
      setComparing: (comparing) => set({ comparing }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(debouncedLocalStorage),
      // Fill in format options added after the user's settings were saved.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<CompareState>;
        return {
          ...current,
          ...saved,
          formatOptions: { ...current.formatOptions, ...saved.formatOptions },
          normalization: { ...current.normalization, ...saved.normalization },
        };
      },
      // Drafts are only written while persistDrafts is on; turning it off
      // overwrites the stored entry without them.
      partialize: (s) => ({
        dialect: s.dialect,
        theme: s.theme,
        persistDrafts: s.persistDrafts,
        formatOptions: s.formatOptions,
        normalization: s.normalization,
        ...(s.persistDrafts ? { left: s.left, right: s.right } : {}),
      }),
    },
  ),
);
