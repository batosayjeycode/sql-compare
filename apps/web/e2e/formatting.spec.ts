import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const left = (page: Page) => page.getByLabel('Left SQL');
const right = (page: Page) => page.getByLabel('Right SQL');

async function typeInto(page: Page, label: string, text: string) {
  await page.getByLabel(label).click();
  await page.keyboard.insertText(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

// Acceptance criterion 4.
test('whitespace, comments and keyword case only → formatting-only', async ({ page }) => {
  await typeInto(page, 'Left SQL', 'SELECT a, b FROM t WHERE x = 1 AND y IS NULL;');
  await typeInto(
    page,
    'Right SQL',
    '-- tidy\nselect a,\n  b\nfrom t\nwhere x = 1\n  and y is null;',
  );
  await expect(page.getByTestId('verdict')).toHaveText('Formatting only');
  const counts = page.getByRole('list', { name: 'Differences by category' });
  await expect(counts).toContainText('Semantic0');
  await expect(counts).toContainText('Structural0');
});

test('a real change is reported as potentially semantic', async ({ page }) => {
  await typeInto(page, 'Left SQL', 'SELECT a FROM t WHERE x = 1');
  await typeInto(page, 'Right SQL', 'select a from t where x = 2');
  await expect(page.getByTestId('verdict')).toHaveText('Potentially semantic');
  await expect(page.getByRole('list', { name: 'Differences by category' })).toContainText(
    'Semantic1',
  );
});

// Acceptance criterion 3.
test('formatted view is read-only and the original stays byte-identical', async ({ page }) => {
  const original = 'select  a,b\n  from t   where x=1 -- keep me\n';
  await typeInto(page, 'Left SQL', original);
  await typeInto(page, 'Right SQL', 'select a, b from t where x = 1');

  await page.getByRole('radio', { name: 'Formatted' }).check();
  await expect(left(page)).toContainText('SELECT');
  await expect(page.getByText('Formatted · read-only')).toHaveCount(2);
  // Diffing the two formatted views leaves only the commented last line as a raw change.
  await expect(page.getByTestId('diff-status')).toContainText('1 change');

  await left(page).click();
  await page.keyboard.insertText('XYZ');
  await expect(left(page)).not.toContainText('XYZ');

  for (let i = 0; i < 3; i++) {
    await page.getByRole('radio', { name: 'Original' }).check();
    await page.getByRole('radio', { name: 'Formatted' }).check();
  }
  await page.getByRole('radio', { name: 'Original' }).check();
  const text = await left(page).evaluate((el) =>
    Array.from(el.querySelectorAll('.cm-line'))
      .map((l) => l.textContent)
      .join('\n'),
  );
  expect(text).toBe(original);
});

test('format options change the formatted output', async ({ page }) => {
  await typeInto(page, 'Left SQL', 'SELECT a FROM t');
  await typeInto(page, 'Right SQL', 'SELECT b FROM t');
  await page.getByRole('button', { name: 'Formatting options' }).click();
  // The popover must paint above the editor panes, not behind them.
  const reset = page.getByRole('button', { name: 'Reset to defaults' });
  const box = await reset.boundingBox();
  if (!box) throw new Error('reset button not visible');
  const onTop = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.textContent ?? '',
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(onTop).toBe('Reset to defaults');
  await page.getByLabel('Keyword case').selectOption('lower');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Keyword case')).toBeHidden();

  await page.getByRole('button', { name: 'Format right side' }).click();
  await expect(right(page)).toContainText('from');
  await expect(right(page)).not.toContainText('FROM');
  await expect(left(page)).toContainText('SELECT a FROM t');
});

test('unformattable SQL shows a warning and stays on the original', async ({ page }) => {
  await typeInto(page, 'Left SQL', 'SELECT (a FROM t');
  await page.getByRole('button', { name: 'Format left side' }).click();
  await expect(page.getByText(/Couldn't format original SQL/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Format left side' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('no serious accessibility violations with options open and formatted view', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.getByRole('radio', { name: 'Formatted' }).check();
  await page.getByRole('button', { name: 'Formatting options' }).click();
  // Audit the settled panel, not a frame of its fade-in.
  await page
    .getByRole('group', { name: 'Formatting options' })
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
});
