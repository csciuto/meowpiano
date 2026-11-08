// Opening a MIDI file, choosing instruments, saving MIDI, and making a link from a file.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bandFile } from '../tests/midiFixture.js';
import { fromMidi } from '../js/midi.js';

const st = (page, f) => page.evaluate(async (f) => {
  const { state } = await import('/js/state.js');
  return new Function('state', 'return ' + f)(state);
}, f);
const open = page => page.setInputFiles('#midiFile', { name: 'band.mid', mimeType: 'audio/midi', buffer: Buffer.from(bandFile()) });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText(/click a key/);
});

test('open a MIDI file: instruments listed, drums off, choose what plays', async ({ page }) => {
  await open(page);
  await expect(page.locator('#status')).toHaveText('band · 0:03 · 5 notes · press PLAY');
  await expect(page.locator('#playToast')).toHaveClass(/show/);
  await expect(page.locator('#parts')).toBeVisible();
  const boxes = page.locator('#partList input');
  await expect(boxes).toHaveCount(3);
  await expect(page.locator('#partList label')).toHaveText(['Lead Guitar · 3', 'Bass · 2', 'Drums · 1']);
  await expect(boxes.nth(2)).not.toBeChecked();
  await boxes.nth(1).uncheck();
  await expect(page.locator('#status')).toHaveText('band · 0:03 · 3 notes · press PLAY');
  await boxes.nth(0).uncheck();
  await expect(page.locator('#status')).toHaveText('band · 0:03 · 0 notes');
  await expect(page.locator('#btnPlay')).toBeDisabled();
  await boxes.nth(2).check();
  await page.locator('#btnPlay').click();
  await expect.poll(() => st(page, 'Object.keys(state.pbVoices).length'), { timeout: 3000 }).toBeGreaterThan(0);
  await page.locator('#btnStop').click();
  await page.locator('#btnClear').click();
  await expect(page.locator('#parts')).toBeHidden();
});

test('MIDI saves a file that opens to the same notes and settings @desktop', async ({ page }) => {
  await page.locator('#tuneSlider').evaluate(el => { el.value = '432'; el.dispatchEvent(new Event('input')); });
  await page.locator('label:has(input[value="midi"])').click();
  await expect(page.locator('#btnShare')).toHaveText(/SAVE/);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1100);
  await expect(page.locator('#status')).toHaveText(/^RECORDING 0:0\d$/);   // no link meter
  for (const k of ['a', 'h']) { await page.keyboard.down(k); await page.waitForTimeout(120); await page.keyboard.up(k); }
  await page.keyboard.press('Enter');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btnShare').click()]);
  expect(download.suggestedFilename()).toMatch(/^meowpiano-\d{8}-\d{4}\.mid$/);
  await expect(page.locator('#shareToast')).toHaveText('MIDI SAVED!');
  const file = fromMidi(new Uint8Array(readFileSync(await download.path())));
  expect(file.settings.tuning).toBe(432);
  const { events } = file.build([file.parts[0].id]);
  expect(events.filter(e => e.type === 'on').map(e => e.note)).toEqual(['C4', 'A4']);
  // and the choice is remembered
  await page.reload();
  await expect(page.locator('#btnShare')).toHaveText(/SAVE/);
});

test('a link from an opened file, and a file too long for a link says how much it holds @desktop', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await page.locator('#btnShare').click();
  await expect(page.locator('#status')).toHaveText(/^link copied · \d+ chars/);
  expect(page.url()).toMatch(/#song=[\w-]+$/);
  await expect(page.locator('#parts')).toBeVisible();   // a link of a file keeps the instrument list

  // a long file: 20 minutes of 16th notes
  const long = await page.evaluate(async () => {
    const { toMidi } = await import('/js/midi.js');
    const ev = [], names = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5'];
    let seed = 3;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let t = 0; t < 20 * 60000; t += 125) {   // a melody that doesn't repeat, so it doesn't compress away
      const note = names[Math.floor(r() * names.length)], at = t + Math.floor(r() * 20);
      ev.push({ type: 'on', note, freq: 300, ls: 0.26, le: 0.46, t: at }, { type: 'off', note, t: at + 40 + Math.floor(r() * 80) });
    }
    ev.sort((a, b) => a.t - b.t);
    return Array.from(toMidi(ev, 20 * 60000, { loopStart: 0.26, loopEnd: 0.46, crossfade: 0.02, grainDur: 0.1, grainOverlap: 0.5, tuning: 440 }));
  });
  await page.setInputFiles('#midiFile', { name: 'long.mid', mimeType: 'audio/midi', buffer: Buffer.from(long) });
  await expect(page.locator('#status')).toHaveText(/long · 20:00 · 9,600 notes/);
  await expect(page.locator('#parts')).toBeHidden();   // one instrument: nothing to choose
  expect(page.url()).not.toContain('#song=');
  await page.locator('#btnShare').click();
  await expect(page.locator('#status')).toHaveText(/link copied · holds the first \d+:\d\d of 20:00/, { timeout: 15000 });
  await expect(page.locator('#shareToast')).toHaveText(/LINK COPIED! · FIRST \d+:\d\d/);
  expect(page.url().length).toBeLessThanOrEqual(8000);
});

test('a file that is not MIDI says so', async ({ page }) => {
  await page.setInputFiles('#midiFile', { name: 'x.mid', mimeType: 'audio/midi', buffer: Buffer.from('not midi at all') });
  await expect(page.locator('#status')).toHaveText("couldn't read that MIDI file");
});
