import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function setInputs(page: Page, left: string, right: string) {
  await page.getByLabel('Left SQL').click();
  await page.keyboard.insertText(left);
  await page.getByLabel('Right SQL').click();
  await page.keyboard.insertText(right);
}

async function expectNoSeriousViolations(page: Page) {
  // Audit settled panels, not a frame of their fade-in.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

// Acceptance criterion 5.
test('INNER JOIN vs JOIN with a quoted table is structural-only', async ({ page }) => {
  await setInputs(
    page,
    'SELECT a FROM t INNER JOIN u ON t.id = u.id',
    'SELECT a FROM "t" JOIN u ON t.id = u.id',
  );
  await expect(page.getByTestId('verdict')).toHaveText('Equivalent (structural)');
  await page.getByRole('button', { name: /Transformations/ }).click();
  const panel = page.getByRole('group', { name: /Transformations applied/ });
  await expect(panel).toContainText('Canonical join keywords');
  await expect(panel).toContainText('Remove redundant identifier quotes');
});

// Acceptance criterion 6.
test('reordered AND: semantic with a hint at L2, structural with Aggressive', async ({ page }) => {
  await setInputs(
    page,
    'SELECT a FROM t WHERE x=1 AND y=2',
    'SELECT a FROM t WHERE y = 2 AND x = 1',
  );
  await expect(page.getByTestId('verdict')).toHaveText('Potentially semantic');
  await expect(page.getByText(/may be structural under aggressive normalization/)).toBeVisible();

  await page.getByRole('button', { name: 'Normalize: L2' }).click();
  await page.getByRole('checkbox', { name: /Aggressive normalization/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('verdict')).toHaveText('Equivalent (structural)');

  // The setting survives a reload.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Normalize: L3 · Aggressive' })).toBeVisible();
});

test('the Normalized view diffs only what normalization could not explain', async ({ page }) => {
  await setInputs(
    page,
    'select U.Name as N from Users U inner join Orders O on O.UserId = U.Id where U.Active != 0;',
    'SELECT u.name n FROM users u JOIN orders o ON o.userid = u.id WHERE u.active <> 1',
  );
  await expect(page.getByTestId('verdict')).toHaveText('Potentially semantic');
  await page.getByRole('radio', { name: 'Normalized' }).check();
  await expect(page.getByText('Normalized · read-only')).toHaveCount(2);
  // Only the 0 → 1 change is left on a changed line.
  await expect(page.locator('.cm-merge-a .cm-changedLine')).toHaveCount(1);
  await expect(page.locator('.cm-merge-a .cm-changedText')).toHaveText('0');
  await expect(page.locator('.cm-merge-b .cm-changedText')).toHaveText('1');
});

test('no serious accessibility violations with the normalization panels open', async ({ page }) => {
  await setInputs(page, 'select a from t where b != 1', 'SELECT a FROM t WHERE b <> 2');
  await expect(page.getByTestId('verdict')).toHaveText('Potentially semantic');
  await page.getByRole('button', { name: 'Normalize: L2' }).click();
  await expectNoSeriousViolations(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Transformations/ }).click();
  await expectNoSeriousViolations(page);
});
