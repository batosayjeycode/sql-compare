import { expose } from 'comlink';
import { formatSql } from '@sql-compare/core';

const api = { format: formatSql };
export type FormatApi = typeof api;

expose(api);
