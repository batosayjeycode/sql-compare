import { expose } from 'comlink';
import { analyze } from './analyze';

const api = { analyze };
export type EngineApi = typeof api;

expose(api);
