import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Every page, checked with axe. Add new pages here: [name, path, selector that appears once it has rendered].
const PAGES = [['Meow Piano', '/', '#btnStop']];

for (const [name, path, ready] of PAGES) {
  test(`${name}: no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(ready).first()).toBeVisible();
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0].target}`)).toEqual([]);
  });
}
