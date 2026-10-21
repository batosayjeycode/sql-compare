import type { NormalizationRule } from '../types.js';

/** Applied by the pipeline: normalized statements never keep whitespace. */
export const whitespace: NormalizationRule = {
  id: 'whitespace',
  level: 1,
  title: 'Collapse whitespace',
  description:
    'Spaces, tabs and line breaks between tokens are ignored. Never inside strings or quoted identifiers.',
  example: ['SELECT  a,\n       b', 'SELECT a, b'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql', 'generic'],
  toggleable: false,
  canonical: {},
  apply: () => null,
};
