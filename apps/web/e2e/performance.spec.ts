import { expect, test, type Page } from '@playwright/test';

// Acceptance criterion 13 / NFR Performance: < 200 ms to compare 500 lines and
// < 3 s for 10k lines (engine time in the worker), with no main-thread task
// over 50 ms while comparing. CI machines are slower than a mid-range laptop,
// so budgets are doubled there.
const SLACK = process.env.CI ? 2 : 1;

function script(statements: number, edited: boolean) {
  return Array.from({ length: statements }, (_, i) => {
    const bound = edited && i % 50 === 0 ? i + 1 : i;
    return `SELECT o.id, o.total, c.name AS customer_${i}
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'paid'
  AND o.total > ${bound}
  AND c.region IN ('eu', 'us')
GROUP BY o.id, o.total, c.name
HAVING count(*) > 1
ORDER BY o.total DESC
LIMIT 10;`;
  }).join('\n');
}

async function load(page: Page, side: 'left' | 'right', sql: string) {
  await page.getByTestId(`${side}-file-input`).setInputFiles({
    name: `${side}.sql`,
    mimeType: 'application/sql',
    buffer: Buffer.from(sql),
  });
}

/** Engine time of the latest comparison, from the "Up to date · N ms" pill. */
async function engineMs(page: Page): Promise<number> {
  const text = (await page.getByTestId('sync-status').textContent()) ?? '';
  return Number(/(\d+) ms/.exec(text)?.[1] ?? NaN);
}

test.beforeEach(async ({ browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || isMobile, 'Budgets are measured on desktop Chromium');
});

for (const { statements, budget } of [
  { statements: 50, budget: 200 },
  { statements: 1000, budget: 3000 },
]) {
  test(`compares ${statements * 10} lines within ${budget} ms without blocking the page`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    // Warm up the worker and parser, so the measurement is the comparison itself.
    await load(page, 'left', 'SELECT 1;');
    await load(page, 'right', 'SELECT 2;');
    await expect(page.getByTestId('sync-status')).toContainText('Up to date');

    await page.evaluate(() => {
      const w = window as unknown as { longTasks: number[] };
      w.longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.longTasks.push(Math.round(entry.duration));
      }).observe({ type: 'longtask' });
    });
    await load(page, 'left', script(statements, false));
    await load(page, 'right', script(statements, true));
    await expect(page.getByTestId('verdict')).toHaveText('Potentially semantic', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('sync-status')).toContainText('Up to date');

    const ms = await engineMs(page);
    const longTasks = await page.evaluate(
      () => (window as unknown as { longTasks: number[] }).longTasks,
    );
    console.log(
      `${statements * 10} lines: engine ${ms} ms, long tasks ${JSON.stringify(longTasks)}`,
    );
    expect(ms).toBeLessThan(budget * SLACK);
    expect(longTasks.filter((d) => d > 50 * SLACK)).toEqual([]);

    // Navigation stays instant on a large result.
    await page.keyboard.press('F7');
    await expect(page.getByTestId('diff-position')).toContainText('1 /');
  });
}
