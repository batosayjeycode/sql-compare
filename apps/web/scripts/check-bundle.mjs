// Bundle budget (NFR: initial JS < 400 KB gzipped). Run after `npm run build`.
// Counts what the first page load needs: the scripts and modulepreloads in
// dist/index.html (workers, parsers and other lazy chunks load later).
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 400;
const dist = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const scripts = [
  ...html.matchAll(/<(?:script[^>]*src|link[^>]*rel="modulepreload"[^>]*href)="\/([^"]+\.js)"/g),
].map((m) => m[1]);

let total = 0;
for (const file of scripts) {
  const size = gzipSync(await readFile(new URL(file, dist))).length;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${file}`);
}
const kb = total / 1024;
console.log(`${kb.toFixed(1).padStart(7)} KB  initial JS (gzip), budget ${BUDGET_KB} KB`);
if (scripts.length === 0 || kb > BUDGET_KB) {
  console.error(
    scripts.length === 0 ? 'No entry scripts found in dist/index.html.' : 'Over budget.',
  );
  process.exit(1);
}
