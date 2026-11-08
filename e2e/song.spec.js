// Recording, sharing a recording as a link, and the arrow / number keys.
import { test, expect } from '@playwright/test';

const st = (page, f) => page.evaluate(async (f) => {
  const { state } = await import('/js/state.js');
  return new Function('state', 'return ' + f)(state);
}, f);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#keyboard');
  await expect(page.locator('#status')).toHaveText(/click a key/);   // samples loaded
});

test('↑ bends up while held and springs back on release; a recording keeps one release @desktop', async ({ page }) => {
  await page.keyboard.press('Enter');                          // record
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(400);
  expect(await st(page, 'state.pitchBend')).toBe(2);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(500);
  expect(await st(page, 'state.pitchBend')).toBe(0);
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(100); await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(400);
  expect(await st(page, 'state.pitchBend')).toBe(0);
  const types = await st(page, 'state.recEvents.map(e => e.type)');
  expect(types.filter(t => t === 'wheel_release')).toHaveLength(2);
  // the spring-back isn't recorded step by step: the last move before each release is the drag's
  expect(await st(page, 'state.recEvents.filter(e => e.type === "pitch" && e.bend === 0).length')).toBe(0);
});

test('1–5 pick the octave @desktop', async ({ page }) => {
  await page.keyboard.press('5');
  expect(await st(page, 'state.octaveShift')).toBe(2);
  await page.keyboard.press('1');
  expect(await st(page, 'state.octaveShift')).toBe(-2);
  await page.keyboard.press('3');
  expect(await st(page, 'state.octaveShift')).toBe(0);
});

test('record, share, and the link plays the same notes in a new tab @desktop', async ({ page, context }) => {
  await expect(page.locator('#btnShare')).toBeDisabled();
  await page.keyboard.press('Enter');
  await page.keyboard.press('4');                              // octave +1
  for (const k of ['a', 'd', 'g']) { await page.keyboard.down(k); await page.waitForTimeout(120); await page.keyboard.up(k); }
  await page.keyboard.down(' '); await page.keyboard.down('k'); await page.waitForTimeout(150); await page.keyboard.up('k'); await page.keyboard.up(' ');
  await page.keyboard.press('3');
  await page.waitForTimeout(1100);                             // the link meter ticks once
  await expect(page.locator('#status')).toHaveText(/RECORDING 0:0\d · LINK \d+%/);
  await page.keyboard.press('Enter');                          // stop
  await expect(page.locator('#status')).toHaveText(/recorded 0:0\d · LINK \d+%/);
  await expect(page.locator('#btnShare')).toBeEnabled();
  const recorded = await st(page, 'state.recEvents.filter(e => e.type === "on").map(e => [e.note, Math.round(e.freq)])');
  expect(recorded).toEqual([['C4', 523], ['E4', 659], ['G4', 784], ['C5', 1047]]);

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#btnShare').click();
  await expect(page.locator('#status')).toHaveText(/link (copied|in the address bar) · \d+ chars/);
  await expect(page.locator('#shareToast')).toHaveClass(/show/);
  await expect(page.locator('#shareToast')).toHaveText(/LINK COPIED!|LINK IN ADDRESS BAR/);
  await expect(page.locator('#shareToast')).not.toHaveClass(/show/, { timeout: 4000 });
  expect(page.url()).toMatch(/#song=[\w-]+$/);

  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator('#status')).toHaveText(/song loaded · 0:0\d · press PLAY/);
  await expect(other.locator('#btnPlay')).toBeEnabled();
  await expect(other.locator('#playToast')).toHaveClass(/show/);
  await expect(other.locator('#playToast')).toHaveText(/SONG LOADED · 0:0\d/);
  await expect(other.locator('#btnPlay')).toHaveClass(/ready/);
  const loaded = await st(other, 'state.recEvents.filter(e => e.type === "on").map(e => [e.note, Math.round(e.freq)])');
  expect(loaded).toEqual(recorded);
  const pedal = await st(other, 'state.recEvents.filter(e => e.type.startsWith("sustain")).map(e => e.type)');
  expect(pedal).toEqual(['sustain_on', 'sustain_off']);
  await other.locator('#btnPlay').click();
  await expect(other.locator('#btnPlay')).not.toHaveClass(/ready/);
  await expect.poll(() => st(other, 'Object.keys(state.pbVoices).length'), { timeout: 3000 }).toBeGreaterThan(0);
  // you can see it play: keys light up, the progress bar runs, the wheel is in playback color
  await expect(other.locator('.key.played').first()).toBeVisible();
  await expect(other.locator('#progress')).toHaveClass(/on/);
  await expect(other.locator('#status')).toHaveText(/PLAYING 0:0\d \/ 0:0\d/);
  await expect(other.locator('#pitchThumb')).toHaveClass(/playback/);
  await other.locator('#btnStop').click();
  await expect(other.locator('.key.played')).toHaveCount(0);
  await expect(other.locator('#progress')).not.toHaveClass(/on/);
});

test('a damaged link says so', async ({ page }) => {
  await page.goto('/#song=bm90LWEtc29uZw');
  await expect(page.locator('#status')).toHaveText('that song link is damaged');
});

test('Clear removes the take and the link', async ({ page }) => {
  await page.locator('#btnRecord').click();
  await page.locator('.key').first().dispatchEvent('pointerdown');
  await page.waitForTimeout(100);
  await page.locator('.key').first().dispatchEvent('pointerup');
  await page.locator('#btnStop').click();
  await expect(page.locator('#btnShare')).toBeEnabled();
  await page.locator('#btnShare').click();
  await page.locator('#btnClear').click();
  await expect(page.locator('#btnShare')).toBeDisabled();
  expect(page.url()).not.toContain('#song=');
});
