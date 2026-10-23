import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const LEFT = 'SELECT a, b\nFROM t\nJOIN u ON t.id = u.id\nWHERE x = 1';
const RIGHT = 'select a, b, c\nfrom t\nleft join u on t.id = u.id\nwhere x = 2';

const panel = (page: Page) => page.getByRole('region', { name: /Differences/ });
const entries = (page: Page) =>
  panel(page).getByRole('button', { name: /^(Semantic|Structural|Formatting|Unknown):/ });
const position = (page: Page) => page.getByTestId('diff-position');

async function fill(page: Page) {
  await page.getByLabel('Left SQL').click();
  await page.keyboard.insertText(LEFT);
  await page.getByLabel('Right SQL').click();
  await page.keyboard.insertText(RIGHT);
  await expect(entries(page)).toHaveCount(3);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

// Acceptance criterion 11.
test('clicking a summary entry scrolls to it and highlights it on both sides', async ({ page }) => {
  await fill(page);
  await expect(panel(page)).toContainText('JOIN u changed from INNER to LEFT');
  await entries(page).filter({ hasText: 'INNER to LEFT' }).click();
  await expect(position(page)).toHaveText('2 / 3');
  const active = page.locator('.cm-scActive');
  await expect(active.first()).toBeVisible();
  // Insertion point on the left, `left` on the right.
  await expect(page.locator('.cm-merge-b .cm-scActive')).toHaveText('left');
  await expect(page.locator('.cm-merge-a .cm-scInsert.cm-scActive')).toHaveCount(1);
});

test('n / p and F7 / Shift+F7 cycle through differences', async ({ page }) => {
  await fill(page);
  await page.getByRole('heading', { name: /Differences/ }).click();
  await page.keyboard.press('n');
  await expect(position(page)).toHaveText('1 / 3');
  await page.keyboard.press('n');
  await page.keyboard.press('n');
  await expect(position(page)).toHaveText('3 / 3');
  await page.keyboard.press('n');
  await expect(position(page)).toHaveText('1 / 3');
  await page.keyboard.press('Shift+F7');
  await expect(position(page)).toHaveText('3 / 3');
  await page.keyboard.press('p');
  await expect(position(page)).toHaveText('2 / 3');
  await expect(entries(page).nth(1)).toHaveAttribute('aria-current', 'true');
  // F7 also works from inside an editor; n types there.
  await page.getByLabel('Right SQL').click();
  await page.keyboard.press('F7');
  await expect(position(page)).toHaveText('3 / 3');
});

// Acceptance criterion 9.
test('categories are separate and each can be toggled', async ({ page }) => {
  await fill(page);
  await expect(page.locator('.cm-scMark.cm-sc-semantic').first()).toBeVisible();
  await expect(page.locator('.cm-scMark.cm-sc-formatting')).toHaveCount(0);

  await page.getByRole('button', { name: /^Formatting \d+$/ }).click();
  await expect(page.locator('.cm-scMark.cm-sc-formatting').first()).toBeVisible();
  await expect(
    entries(page)
      .filter({ hasText: /Keyword case|Whitespace/ })
      .first(),
  ).toBeVisible();

  await page.getByRole('button', { name: /^Semantic \d+$/ }).click();
  await expect(page.locator('.cm-scMark.cm-sc-semantic')).toHaveCount(0);
  await expect(page.locator('.cm-scGutterMark.cm-sc-semantic')).toHaveCount(0);
});

test('highlights follow the formatted view', async ({ page }) => {
  await fill(page);
  await page.getByRole('radio', { name: 'Formatted' }).check({ force: true });
  await expect(
    page.locator('.cm-merge-b .cm-scMark.cm-sc-semantic', { hasText: 'LEFT' }),
  ).toBeVisible();
  await expect(
    page.locator('.cm-merge-a .cm-scMark.cm-sc-semantic', { hasText: '1' }),
  ).toBeVisible();
});

test('hovering a highlight highlights its counterpart', async ({ page }) => {
  await fill(page);
  await page.locator('.cm-merge-a .cm-scMark', { hasText: '1' }).hover();
  await expect(page.locator('.cm-merge-b .cm-scHover')).toHaveText('2');
});

test('inline mode shows one editor with the same highlights', async ({ page }) => {
  await fill(page);
  await page.getByRole('radio', { name: 'Inline' }).check({ force: true });
  await expect(page.getByLabel('Left SQL')).toHaveCount(0);
  await expect(page.locator('.cm-deletedChunk').first()).toBeVisible();
  await entries(page).filter({ hasText: 'x = 2' }).click();
  await expect(page.locator('.cm-scActive')).toHaveText('2');
});

test('exports the report as Markdown, HTML and JSON', async ({ page }) => {
  await fill(page);
  await panel(page).getByRole('button', { name: 'Export' }).click();
  for (const [format, ext] of [
    ['Markdown', 'md'],
    ['HTML', 'html'],
    ['JSON', 'json'],
  ] as const) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: format, exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^sql-compare-report-\\d{8}-\\d{4}\\.${ext}$`),
    );
    const text = await readFile((await download.path())!, 'utf8');
    if (ext === 'md') expect(text).toContain('JOIN `u` changed from INNER to LEFT');
    if (ext === 'html') expect(text).toContain('<code>u</code>');
    if (ext === 'json') expect(JSON.parse(text).stats.semantic).toBe(3);
  }
});

test('the panel docks to the right and resizes with the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Narrow screens stack the panel below the editors');
  await fill(page);
  await page.getByRole('button', { name: 'Dock panel to the right' }).click();
  const box = async () => (await panel(page).boundingBox())!;
  const before = (await box()).width;
  await page.getByRole('separator', { name: 'Resize differences panel' }).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect((await box()).width).toBeGreaterThan(before);
});

test('no serious accessibility violations with the panel and highlights', async ({ page }) => {
  await fill(page);
  await entries(page).first().click();
  await page.getByRole('button', { name: /^Formatting \d+$/ }).click();
  await page.waitForTimeout(1000);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
});
