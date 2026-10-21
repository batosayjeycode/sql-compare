import { expect, test, type Page } from '@playwright/test';

const status = (page: Page) => page.getByTestId('diff-status');
const left = (page: Page) => page.getByLabel('Left SQL');
const right = (page: Page) => page.getByLabel('Right SQL');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('paste two queries and see a line and character diff', async ({ page }) => {
  await left(page).click();
  await page.keyboard.insertText('SELECT id, name\nFROM users\nWHERE active = 1');
  await right(page).click();
  await page.keyboard.insertText('SELECT id, name, email\nFROM users\nWHERE active = 1');

  await expect(status(page)).toHaveText('1 change · +1 −1 lines');
  // Changed line + inline character highlight on both sides.
  await expect(page.locator('.cm-merge-a .cm-changedLine')).toHaveCount(1);
  await expect(page.locator('.cm-merge-b .cm-changedLine')).toHaveCount(1);
  await expect(page.locator('.cm-merge-b .cm-changedText')).toContainText('email');
});

test('upload a file into each side', async ({ page }) => {
  await page.getByTestId('left-file-input').setInputFiles({
    name: 'before.sql',
    mimeType: 'application/sql',
    buffer: Buffer.from('SELECT 1;\n'),
  });
  await page.getByTestId('right-file-input').setInputFiles({
    name: 'after.sql',
    mimeType: 'application/sql',
    buffer: Buffer.from('SELECT 2;\n'),
  });

  await expect(page.getByText('before.sql')).toBeVisible();
  await expect(page.getByText('after.sql')).toBeVisible();
  await expect(status(page)).toHaveText('1 change · +1 −1 lines');
});

test('rejects unsupported uploads with a friendly error', async ({ page }) => {
  await page.getByTestId('left-file-input').setInputFiles({
    name: 'diagram.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  await expect(page.getByRole('alert')).toContainText("isn't a supported file type");
});

test('drop a file onto the right side', async ({ page }) => {
  const region = page.getByRole('region', { name: 'SQL editors' });
  const box = await region.boundingBox();
  if (!box) throw new Error('editor region not visible');

  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['SELECT dropped;'], 'dropped.sql'));
    return dt;
  });
  const point = { clientX: box.x + box.width * 0.75, clientY: box.y + box.height / 2 };
  await region.dispatchEvent('dragover', { dataTransfer, ...point });
  await expect(page.getByText('Drop to load as Modified')).toBeVisible();
  await region.dispatchEvent('drop', { dataTransfer, ...point });

  await expect(page.getByText('dropped.sql')).toBeVisible();
  await expect(right(page)).toHaveText('SELECT dropped;');
});

test('example, sync scroll and draft restore', async ({ page }) => {
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(status(page)).toContainText('change');

  // Both editors live in one scroll container, so they always scroll together.
  const scrollers = await page.locator('.cm-mergeView').count();
  expect(scrollers).toBe(1);

  await page.getByRole('combobox').selectOption('mysql');
  await page.getByRole('button', { name: /switch to light theme/i }).click();
  await page.waitForTimeout(500); // drafts are written with a 300 ms debounce
  await page.reload();

  await expect(left(page)).toContainText('INNER JOIN orders');
  await expect(page.getByRole('combobox')).toHaveValue('mysql');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('drafts are not restored when saving is turned off', async ({ page }) => {
  await page.getByLabel('Save drafts').uncheck();
  await left(page).click();
  await page.keyboard.insertText('SELECT private_stuff');
  await page.waitForTimeout(500);
  await page.reload();

  await expect(page.getByLabel('Save drafts')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Try an example' })).toBeVisible();
});
