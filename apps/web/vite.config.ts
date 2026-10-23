/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { pwa } from './vite.pwa';

const require = createRequire(import.meta.url);

function libpgQueryWasmPath(): string {
  return require.resolve('libpg-query/wasm/libpg-query.wasm', {
    paths: [require.resolve('@sql-compare/core')],
  });
}

/*
 * libpg-query (PostgreSQL parser) runs in the engine worker and, there, looks
 * for `libpg-query.wasm` next to the *worker script* (Emscripten uses
 * `self.location`), a lookup Vite can't see.
 */

/** Build: emit the file into `assets/`, beside the worker chunk. */
function emitLibpgQueryWasm(): Plugin {
  return {
    name: 'libpg-query-wasm:emit',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/libpg-query.wasm',
        source: readFileSync(libpgQueryWasmPath()),
      });
    },
  };
}

/** Dev: serve the file at whatever path the worker asks for. */
function serveLibpgQueryWasm(): Plugin {
  return {
    name: 'libpg-query-wasm:serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split('?')[0]?.endsWith('/libpg-query.wasm')) return next();
        res.setHeader('Content-Type', 'application/wasm');
        res.end(readFileSync(libpgQueryWasmPath()));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveLibpgQueryWasm(), pwa()],
  worker: { format: 'es', plugins: () => [emitLibpgQueryWasm()] },
  // Both parsers ship CommonJS; pre-bundle them so the dev server serves ESM.
  // They're only imported from the worker, which Vite's dependency scan misses.
  optimizeDeps: {
    include: ['libpg-query', 'node-sql-parser/build/mysql.js'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Fonts stay files (cacheable, allowed by the CSP's font-src 'self'), never data: URIs.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
