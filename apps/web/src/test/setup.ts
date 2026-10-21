import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { initialState, useCompareStore } from '../store/compare';

// jsdom has no layout; CodeMirror measures text ranges when scrolling/selecting.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

afterEach(() => {
  cleanup();
  useCompareStore.setState(initialState);
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
