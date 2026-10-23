import { expect, test, type Page } from '@playwright/test';
import { fillBoth as fill, openTab } from './helpers';

/** Collect CSP violations and console errors from the start of the page. */
async function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return problems;
}

test('ships a strict Content-Security-Policy that the app never violates', async ({ page }) => {
  const problems = await watch(page);
  await page.goto('/');
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).not.toMatch(/[^-]'unsafe-eval'/);

  // PostgreSQL (WASM parser in a worker), formatting worker, export.
  await fill(page, 'SELECT a FROM t WHERE x = 1', 'SELECT a FROM t WHERE x = 2');
  await expect(page.getByTestId('verdict')).toHaveText('Potentially semantic');
  await page.getByRole('radio', { name: 'Formatted' }).check({ force: true });
  await expect(page.getByText('Formatted · read-only').first()).toBeVisible();
  // MySQL parser.
  await page.getByLabel('Dialect').selectOption('mysql');
  await expect(page.getByTestId('sync-status')).toContainText('Up to date');
  await openTab(page, 'Summary');
  await page
    .getByRole('region', { name: /Differences/ })
    .getByRole('button', { name: 'Export' })
    .click();
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'HTML' }).click(),
  ]);

  expect(problems).toEqual([]);
});

test('makes no requests to other origins', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (
      !r.url().startsWith('http://localhost:4173') &&
      !r.url().startsWith('blob:') &&
      !r.url().startsWith('data:')
    ) {
      external.push(r.url());
    }
  });
  await page.goto('/');
  await fill(page, 'SELECT 1', 'SELECT 2');
  await expect(page.getByTestId('verdict')).toHaveText('Potentially semantic');
  expect(external).toEqual([]);
});

test('is installable: manifest with icons', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ name: 'SQL Compare', display: 'standalone', start_url: '/' });
  for (const icon of manifest.icons as Array<{ src: string }>) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
});

// Acceptance criterion 12: works with the network disabled after the first load.
test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    // Wait until the precache is complete and the worker controls the page.
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
    }
    return registration.active?.state;
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SQL Compare');
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.getByTestId('verdict')).toHaveText('Potentially semantic');
  // Both parsers and the formatter come from the cache.
  expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(true);
  await page.getByLabel('Dialect').selectOption('mysql');
  await expect(page.getByTestId('sync-status')).toContainText('Up to date');
  await openTab(page, 'Left');
  await page.getByRole('radio', { name: 'Formatted' }).check({ force: true });
  await expect(page.getByText('Formatted · read-only').first()).toBeVisible();
  await context.setOffline(false);
});
