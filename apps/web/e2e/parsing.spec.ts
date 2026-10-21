import { expect, test, type Page } from '@playwright/test';

async function setInputs(page: Page, left: string, right: string) {
  await page.getByLabel('Left SQL').click();
  await page.keyboard.insertText(left);
  await page.getByLabel('Right SQL').click();
  await page.keyboard.insertText(right);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('PostgreSQL parse errors show their location inline and in the header', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setInputs(page, 'SELECT 1;\nSELECT (a FROM t;', 'SELECT 1;\nSELECT a FROM t;');

  const pill = page.getByRole('button', { name: 'Parse error L2:11' });
  await expect(pill).toBeVisible();
  await expect(page.locator('.cm-merge-a .cm-lintRange-error')).toHaveText('FROM');
  await expect(page.locator('.cm-merge-a .cm-stmtBadge-error')).toBeVisible();
  await expect(page.locator('.cm-merge-a .cm-gutter-lint .cm-lint-marker-error')).toHaveCount(1);

  // Hovering the underline explains the error.
  await page.locator('.cm-merge-a .cm-lintRange-error').hover();
  await expect(page.locator('.cm-tooltip-lint')).toContainText('syntax error at or near "FROM"');

  await pill.click();
  await expect(page.getByLabel('Left SQL')).toBeFocused();
  // The right side still parses, so the diff is a token-level fallback.
  await expect(page.getByTestId('verdict')).toHaveText('Unknown (unparsed SQL)');
  expect(errors).toEqual([]);
});

test('fixing the error clears the markers', async ({ page }) => {
  await setInputs(page, 'SELECT (a FROM t', 'SELECT a FROM t');
  await expect(page.getByRole('button', { name: /Parse error/ })).toBeVisible();
  await page.getByLabel('Left SQL').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('SELECT a FROM t');
  await expect(page.getByRole('button', { name: /Parse error/ })).toBeHidden();
  await expect(page.locator('.cm-stmtBadge')).toHaveCount(0);
  await expect(page.getByTestId('verdict')).toHaveText('Identical');
});

test('MySQL: stored programs and unsupported statements are compared as text', async ({ page }) => {
  await page.getByLabel('Dialect').selectOption('mysql');
  const left = `DELIMITER $$
CREATE PROCEDURE p()
BEGIN
  SELECT 1;
END$$
DELIMITER ;
SET NAMES utf8;
SELECT \`a\` FROM t LIMIT 1, 10;`;
  await setInputs(page, left, left.replace('SELECT 1;', 'SELECT 2;'));
  await expect(page.getByText('2 compared as text')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Parse error/ })).toHaveCount(0);
  await expect(page.getByTestId('verdict')).toHaveText('Unknown (unparsed SQL)');
});

test('garbage input never breaks the app', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const garbage = "'unterminated $$ /* (( `x \\ ;;; SELECT FROM WHERE ))) 😀 \u0000";
  await setInputs(page, garbage, garbage + ' x');
  await expect(page.getByTestId('verdict')).not.toHaveText('Comparing…');
  await expect(page.getByTestId('verdict')).toBeVisible();
  for (const dialect of ['mysql', 'generic', 'postgresql']) {
    await page.getByLabel('Dialect').selectOption(dialect);
    await expect(page.getByTestId('verdict')).not.toHaveText('Comparing…');
  }
  // Still editable and comparing.
  await page.getByLabel('Right SQL').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(garbage);
  await expect(page.getByTestId('verdict')).toHaveText('Identical');
  expect(errors).toEqual([]);
});

test('parsers run in a worker and load from this site only', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await setInputs(page, 'SELECT 1', 'SELECT 2');
  await expect(page.getByTestId('verdict')).toHaveText('Potentially semantic');
  expect(page.workers().length).toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => u.includes('libpg-query.wasm'))).toHaveLength(1);
  const offsite = requests.filter((u) => !u.startsWith(origin) && !u.includes('fonts.g'));
  expect(offsite).toEqual([]);
});
