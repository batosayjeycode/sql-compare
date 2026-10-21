import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('app shell renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SQL Compare/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SQL Compare');
  await expect(page.getByLabel('Left SQL')).toBeVisible();
  await expect(page.getByLabel('Right SQL')).toBeVisible();
});

test('no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
});

for (const theme of ['dark', 'light'] as const) {
  test(`no serious accessibility violations with a diff (${theme})`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    if (theme === 'light') {
      await page.getByRole('button', { name: /switch to light theme/i }).click();
    }
    await page.getByRole('button', { name: 'Try an example' }).click();
    await expect(page.locator('.cm-changedLine').first()).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious).toEqual([]);
  });
}

test('no serious accessibility violations with long files', async ({ page }) => {
  await page.goto('/');
  const longSql = Array.from(
    { length: 200 },
    (_, i) => `SELECT ${i} AS col_${i}, 'a fairly long string literal to exceed the width' FROM t;`,
  ).join('\n');
  await page.getByLabel('Left SQL').click();
  await page.keyboard.insertText(longSql);
  await page.getByLabel('Right SQL').click();
  await page.keyboard.insertText(longSql.replace('SELECT 7 ', 'SELECT 8 '));
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
});
