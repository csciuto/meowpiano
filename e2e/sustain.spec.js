// Piano-style sustain: a note holds while its key is down, the pedal (Space)
// catches held notes and keeps released ones ringing, and releasing the pedal
// stops only notes whose keys are already up.
import { test, expect } from '@playwright/test';

const liveNotes = page => page.evaluate(async () =>
  Object.keys((await import('/js/state.js')).state.liveVoices).sort());

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#keyboard');
});

test('a held key sustains past the meow and stops on release', async ({ page }) => {
  await page.keyboard.down('a');
  await page.waitForTimeout(1000);          // longer than the 0.8 s recording
  expect(await liveNotes(page)).toEqual(['C4']);
  await page.keyboard.up('a');
  expect(await liveNotes(page)).toEqual([]);
});

test('pedal pressed while a key is held catches that note', async ({ page }) => {
  await page.keyboard.down('a');
  await page.waitForTimeout(400);
  await page.keyboard.down(' ');
  await page.keyboard.up('a');
  await page.waitForTimeout(400);
  expect(await liveNotes(page)).toEqual(['C4']);
  await page.keyboard.up(' ');
  expect(await liveNotes(page)).toEqual([]);
});

test('pedal release leaves notes whose keys are still down', async ({ page }) => {
  await page.keyboard.down(' ');
  await page.keyboard.down('a'); await page.keyboard.up('a');   // released under pedal
  await page.keyboard.down('s');                                // still held
  await page.waitForTimeout(400);
  expect(await liveNotes(page)).toEqual(['C4', 'D4']);
  await page.keyboard.up(' ');
  expect(await liveNotes(page)).toEqual(['D4']);
  await page.keyboard.up('s');
  expect(await liveNotes(page)).toEqual([]);
});
