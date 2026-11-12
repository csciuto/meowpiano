import { test, expect } from '@playwright/test';

// Smoke test: the app loads and renders without JavaScript errors.
// `npm run screenshot` also saves the preview image used for link previews
// and on https://corey.sciu.to/projects/.
const APP = '/';
const PREVIEW = 'preview.png';
const READY = '#keyboard';

test('app loads without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(APP);
  await expect(page.locator(READY).first()).toBeVisible();
  expect(errors).toEqual([]);
  if (process.env.UPDATE_PREVIEW) {
    await page.waitForTimeout(750);
    await page.screenshot({ path: PREVIEW });
  }
});

test('contact and a link back to the projects page', async ({ page }) => {
  for (const p of [APP]) {
    await page.goto(p);
    await expect(page.getByText(/corey\.sciuto\+\w+@gmail\.com/).first()).toBeAttached();
    await expect(page.locator('a[href="https://corey.sciu.to/projects/"]').first()).toBeAttached();
  }
});

test('footer shows the version', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('.version')).toHaveText(/^(dev|v1\.\d+)$/);
});

test('a number key moves the range label and the key names together', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator(READY).first()).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.locator('.octave-bar')).toHaveText('C3 <------- C4 -------> C5');
  await expect(page.locator('.key-note').first()).toHaveText('C3');
  await expect(page.locator('.key-note').last()).toHaveText('C5');
  await page.keyboard.press('3');
  await expect(page.locator('.octave-bar')).toHaveText('C4 <------- C5 -------> C6');
  await expect(page.locator('.key-note').first()).toHaveText('C4');
});
