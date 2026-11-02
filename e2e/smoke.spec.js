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
  await page.waitForLoadState('networkidle');
  await expect(page.locator(READY).first()).toBeVisible();
  expect(errors).toEqual([]);
  if (process.env.UPDATE_PREVIEW) {
    await page.waitForTimeout(750);
    await page.screenshot({ path: PREVIEW });
  }
});
