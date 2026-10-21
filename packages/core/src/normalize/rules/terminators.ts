import type { NormalizationRule } from '../types.js';

/** Applied by the pipeline: statement terminators (`;`, custom DELIMITER) are ignored. */
export const terminators: NormalizationRule = {
  id: 'terminators',
  level: 1,
  title: 'Ignore statement terminators',
  description: 'A trailing semicolon (or MySQL DELIMITER) is not part of the statement.',
  example: ['SELECT 1;', 'SELECT 1'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql', 'generic'],
  toggleable: true,
  canonical: {},
  apply: () => null,
};
