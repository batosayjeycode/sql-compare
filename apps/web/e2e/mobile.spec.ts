import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fillBoth } from './helpers';

// PLAN §4.3: below 900px, tabs Left | Right | Diff | Summary, inline diff by
// default, and previous/next and the filters in a bar at the bottom.

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Small-screen layout');
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const bottomBar = (page: Page) => page.getByRole('navigation', { name: 'Differences' });

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
}

test('panes are tabs, and the diff tab is inline', async ({ page }) => {
  await expect(tab(page, 'Diff')).toHaveAttribute('aria-selected', 'true');
  await fillBoth(page, 'SELECT a FROM t WHERE x = 1', 'SELECT a, b FROM t WHERE x = 2');

  // Diff tab: one inline editor.
  await expect(page.getByTestId('merge-view')).toHaveAttribute('data-layout', 'unified');
  await expect(page.getByLabel('Left SQL')).toHaveCount(0);
  await expect(page.locator('.cm-deletedChunk').first()).toBeVisible();

  // Left tab: the original alone, editable, with its highlights.
  await tab(page, 'Left').click();
  await expect(page.getByLabel('Left SQL')).toBeVisible();
  await expect(page.getByLabel('Right SQL')).toHaveCount(0);
  await expect(page.locator('.cm-scMark.cm-sc-semantic', { hasText: '1' })).toBeVisible();
  await expect(page.getByText('Modified', { exact: true })).toHaveCount(0);

  // Arrow keys move between tabs.
  await tab(page, 'Left').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Right')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Right')).toBeFocused();
});

test('summary entries open the diff at that difference', async ({ page }) => {
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(tab(page, 'Summary')).toContainText('4');
  await tab(page, 'Summary').click();
  const list = page.getByRole('region', { name: /Differences/ });
  await list.getByRole('button').filter({ hasText: 'INNER to LEFT' }).click();
  await expect(tab(page, 'Diff')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.cm-scActive')).toHaveText('left');
  await expect(bottomBar(page).getByTestId('diff-position')).toHaveText('3 / 5');
});

test('the bottom bar steps through differences and filters them', async ({ page }) => {
  await page.getByRole('button', { name: 'Try an example' }).click();
  const bar = bottomBar(page);
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: /Next/ }).click();
  await expect(bar.getByTestId('diff-position')).toHaveText('1 / 5');
  await bar.getByRole('button', { name: /Next/ }).click();
  await expect(bar.getByTestId('diff-position')).toHaveText('2 / 5');
  await bar.getByRole('button', { name: /^Formatting \d+$/ }).click();
  await expect(bar.getByTestId('diff-position')).toHaveText(/\/ 10$/);
  // The bar stays on screen while the page scrolls.
  await page.mouse.wheel(0, 2000);
  await expect(bar).toBeInViewport();
});

test('side-by-side is still available on small screens', async ({ page }) => {
  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.getByRole('radio', { name: 'Side-by-side' }).check({ force: true });
  await expect(page.getByTestId('merge-view')).toHaveAttribute('data-layout', 'split');
  await expect(page.getByLabel('Left SQL')).toBeVisible();
});

for (const name of ['Left', 'Diff', 'Summary']) {
  test(`no serious accessibility violations on the ${name} tab`, async ({ page }) => {
    await page.getByRole('button', { name: 'Try an example' }).click();
    await tab(page, name).click();
    await page.waitForTimeout(800);
    expect(await seriousViolations(page)).toEqual([]);
  });
}
