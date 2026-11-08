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
  await page.locator('#tuneSlider').evaluate(el => { el.value = '435'; el.dispatchEvent(new Event('input')); });
  await expect(page.locator('#tuneLbl')).toHaveText('435Hz');
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
  expect(await st(other, 'state.tuning')).toBe(435);
  await expect(other.locator('#tuneSlider')).toHaveValue('435');
  const pedal = await st(other, 'state.recEvents.filter(e => e.type.startsWith("sustain")).map(e => e.type)');
  expect(pedal).toEqual(['sustain_on', 'sustain_off']);
  await other.locator('#btnPlay').click();
  await expect(other.locator('#btnPlay')).not.toHaveClass(/ready/);
  await expect.poll(() => st(other, 'Object.keys(state.pbVoices).length'), { timeout: 3000 }).toBeGreaterThan(0);
  // you can see it play: keys light up, the progress bar runs, the wheel is in playback color
  await expect(other.locator('.key.played').first()).toBeVisible();
  await expect(other.locator('#seek')).toBeVisible();
  await expect(other.locator('#status')).toHaveText(/PLAYING 0:0\d \/ 0:0\d/);
  await expect(other.locator('#pitchThumb')).toHaveClass(/playback/);
  await other.locator('#btnStop').click();
  await expect(other.locator('.key.played')).toHaveCount(0);
  await expect(other.locator('#seek')).toHaveValue('0');
  await expect(other.locator('#pitchThumb')).not.toHaveClass(/playback/);
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

test('name a recording: the link and the saved file carry it @desktop', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('Enter');
  for (const k of ['a', 'g']) { await page.keyboard.down(k); await page.waitForTimeout(100); await page.keyboard.up(k); }
  await page.keyboard.press('Enter');
  const name = page.locator('#songName');
  await expect(name).toBeVisible();
  await expect(name).toHaveValue('');
  await name.click();
  await page.keyboard.type('Silas sings: a test');               // letters don't play, Enter doesn't record
  await page.keyboard.press('Enter');
  expect(await st(page, 'state.isRec')).toBe(false);
  expect(await st(page, 'Object.keys(state.liveVoices).length')).toBe(0);
  await expect(name).toHaveValue('Silas sings: a test');

  await page.locator('#btnShare').click();
  await expect(page.locator('#status')).toHaveText(/^link copied/);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator('#status')).toHaveText(/^Silas sings: a test · 0:0\d · press PLAY$/);
  await expect(other.locator('#songName')).toHaveValue('Silas sings: a test');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btnSave').click()]);
  expect(download.suggestedFilename()).toBe('Silas sings a test.mid');
  const { fromMidi } = await import('../js/midi.js');
  const { readFileSync } = await import('node:fs');
  expect(fromMidi(new Uint8Array(readFileSync(await download.path()))).title).toBe('Silas sings: a test');
});

test('help: linked from the piano, and Hear Canon in D loads it', async ({ page }) => {
  await expect(page.locator('#helpLink')).toBeVisible();
  await page.locator('#helpLink').click();
  await expect(page.locator('h1')).toHaveText('How to play Meow Piano');
  for (const img of await page.locator('figure img').all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth)).toBe(900);
  }
  await page.locator('a.hear').click();
  await expect(page.locator('#status')).toHaveText('Canon in D · 1:51 · press PLAY');
});
