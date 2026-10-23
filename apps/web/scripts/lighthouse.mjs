// Lighthouse audit of the production build (PLAN M7 exit criterion: ≥ 90 for
// Performance, Accessibility and Best Practices), mobile and desktop.
//   npm run build && npm run lighthouse -w @sql-compare/web
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const cli = require.resolve('lighthouse/cli/index.js');

const MIN_SCORE = 90;
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const REQUIRED = new Set(['performance', 'accessibility', 'best-practices']);
const METRICS = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'total-blocking-time',
  'cumulative-layout-shift',
];
const URL = 'http://localhost:4174/';

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'warn' });
let failed = false;
try {
  for (const preset of ['mobile', 'desktop']) {
    const { stdout } = await run(
      process.execPath,
      [
        cli,
        URL,
        '--quiet',
        '--output=json',
        '--output-path=stdout',
        `--only-categories=${CATEGORIES.join(',')}`,
        `--chrome-path=${chromium.executablePath()}`,
        '--chrome-flags=--headless=new --no-sandbox',
        ...(preset === 'desktop' ? ['--preset=desktop'] : []),
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const lhr = JSON.parse(stdout);
    console.log(`\nLighthouse ${lhr.lighthouseVersion}, ${preset}`);
    for (const id of CATEGORIES) {
      const score = Math.round((lhr.categories[id]?.score ?? 0) * 100);
      const ok = !REQUIRED.has(id) || score >= MIN_SCORE;
      if (!ok) failed = true;
      console.log(`${ok ? '✓' : '✗'} ${lhr.categories[id].title}: ${score}`);
    }
    for (const id of METRICS)
      console.log(`  ${lhr.audits[id].title}: ${lhr.audits[id].displayValue}`);
    // Weighted audits below 90, to act on.
    for (const [category, { auditRefs }] of Object.entries(lhr.categories)) {
      for (const ref of auditRefs) {
        const audit = lhr.audits[ref.id];
        if (ref.weight > 0 && audit.score !== null && audit.score < 0.9) {
          console.log(`  - [${category}] ${audit.title} (${Math.round(audit.score * 100)})`);
        }
      }
    }
  }
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
}
process.exit(failed ? 1 : 0);
