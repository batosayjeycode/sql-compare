import type { Page } from '@playwright/test';

/** Small screens show the panes as tabs (Left / Right / Diff / Summary). */
export async function isTabbed(page: Page): Promise<boolean> {
  return (await page.getByRole('tablist', { name: 'Panes' }).count()) > 0;
}

export async function openTab(page: Page, name: 'Left' | 'Right' | 'Diff' | 'Summary') {
  if (await isTabbed(page)) await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
}

/** Type SQL into both sides, on wide screens and in the small-screen tabs; ends on the diff. */
export async function fillBoth(page: Page, left: string, right: string) {
  await openTab(page, 'Left');
  await page.getByLabel('Left SQL').click();
  await page.keyboard.insertText(left);
  await openTab(page, 'Right');
  await page.getByLabel('Right SQL').click();
  await page.keyboard.insertText(right);
  await openTab(page, 'Diff');
}
