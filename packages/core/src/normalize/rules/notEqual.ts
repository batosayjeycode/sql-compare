import type { NormalizationRule } from '../types.js';
import { diffResult } from './util.js';

export const notEqual: NormalizationRule = {
  id: 'not-equal',
  level: 2,
  title: 'Canonical not-equal operator',
  description: '!= and <> are the same operator; != is written as <>.',
  example: ['WHERE a != 1', 'WHERE a <> 1'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: {},
  apply(tokens) {
    const after = tokens.map((t) =>
      t.type === 'operator' && t.text === '!=' ? { ...t, text: '<>' } : t,
    );
    return diffResult(tokens, after);
  },
};
