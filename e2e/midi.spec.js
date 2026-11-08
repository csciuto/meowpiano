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

test('SAVE writes a MIDI file that opens to the same notes and settings @desktop', async ({ page }) => {
  await page.locator('#tuneSlider').evaluate(el => { el.value = '432'; el.dispatchEvent(new Event('input')); });
  await page.keyboard.press('Enter');
  for (const k of ['a', 'h']) { await page.keyboard.down(k); await page.waitForTimeout(120); await page.keyboard.up(k); }
  await page.keyboard.press('Enter');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btnSave').click()]);
  expect(download.suggestedFilename()).toMatch(/^meowpiano-\d{8}-\d{4}\.mid$/);
  await expect(page.locator('#saveToast')).toHaveText('MIDI SAVED!');
  const file = fromMidi(new Uint8Array(readFileSync(await download.path())));
  expect(file.settings.tuning).toBe(432);
  const { events } = file.build([file.parts[0].id]);
  expect(events.filter(e => e.type === 'on').map(e => e.note)).toEqual(['C4', 'A4']);
});

test('a link from an opened file; a file too long for a link keeps its first part @desktop', async ({ page, context }) => {
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
  await expect(page.locator('#status')).toHaveText(/link copied · first \d+:\d\d of 20:00/, { timeout: 15000 });
  await expect(page.locator('#shareToast')).toHaveText(/LINK COPIED! · FIRST \d+:\d\d/);
  expect(page.url().length).toBeLessThanOrEqual(8000);
});

test('a file that is not MIDI says so', async ({ page }) => {
  await page.setInputFiles('#midiFile', { name: 'x.mid', mimeType: 'audio/midi', buffer: Buffer.from('not midi at all') });
  await expect(page.locator('#status')).toHaveText("couldn't read that MIDI file");
});

test('a MIDI keyboard plays, bends, holds the pedal and records @desktop', async ({ page }) => {
  await page.addInitScript(() => {
    // a stand-in keyboard: the page sees one input named KeyStep 37
    const input = { name: 'KeyStep 37', onmidimessage: null };
    window.__fakeInput = input;
    navigator.requestMIDIAccess = async () => ({ inputs: new Map([['k', input]]), onstatechange: null });
  });
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText(/click a key/);
  await page.locator('#btnMidiIn').click();
  await expect(page.locator('#status')).toHaveText(/^KeyStep 37 connected/);
  await expect(page.locator('#btnMidiIn')).toHaveAttribute('aria-pressed', 'true');
  const send = bytes => page.evaluate(b => window.__fakeInput.onmidimessage({ data: b }), bytes);
  await page.keyboard.press('Enter');                         // record
  await page.keyboard.press('5');                             // app octave +2: MIDI notes ignore it
  for (const m of [48, 60, 64, 67, 72]) await send([0x90, m, 100]);   // C3 + a C major chord with two Cs
  await expect.poll(() => page.evaluate(async () => { const { state } = await import('/js/state.js'); return Object.keys(state.liveVoices).length; })).toBe(5);
  await send([0xb0, 64, 127]);                                // pedal down
  await send([0xe0, 0, 0x60]);                                // bend +1
  await page.waitForTimeout(200);
  await send([0xe0, 0, 0x40]);                                // strip let go: center
  for (const m of [48, 60, 64, 67, 72]) await send([0x80, m, 0]);
  await send([0xb0, 64, 0]);
  await page.keyboard.press('Enter');                         // stop
  const rec = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return state.recEvents;
  });
  const ons = rec.filter(e => e.type === 'on').map(e => Math.round(69 + 12 * Math.log2(e.freq / 440)));
  expect(ons).toEqual([48, 60, 64, 67, 72]);
  expect(new Set(rec.filter(e => e.type === 'on').map(e => e.note)).size).toBe(5);
  expect(rec.filter(e => e.type.startsWith('sustain')).map(e => e.type)).toEqual(['sustain_on', 'sustain_off']);
  const bends = rec.filter(e => e.type === 'pitch').map(e => e.bend);
  expect(bends).toContain(1);
  expect(bends.at(-1)).toBe(0);
  // remembered: the next visit reconnects without the button
  await page.reload();
  await expect(page.locator('#btnMidiIn')).toHaveAttribute('aria-pressed', 'true');
});

test('pause, ⏪ ⏩, and the seek bar start the song anywhere @desktop', async ({ page }) => {
  // a minute of C major chords, one every two seconds, each held a second and a half
  const file = await page.evaluate(async () => {
    const { toMidi } = await import('/js/midi.js');
    const ev = [];
    for (let t = 0; t < 60000; t += 2000) for (const [note, freq] of [['C4', 261.63], ['E4', 329.63], ['G4', 392]]) ev.push({ type: 'on', note, freq, ls: 0.26, le: 0.46, t }, { type: 'off', note, t: t + 1500 });
    ev.sort((a, b) => a.t - b.t);
    return Array.from(toMidi(ev, 60000, { loopStart: 0.26, loopEnd: 0.46, crossfade: 0.02, grainDur: 0.1, grainOverlap: 0.5, tuning: 440 }));
  });
  await page.setInputFiles('#midiFile', { name: 'chords.mid', mimeType: 'audio/midi', buffer: Buffer.from(file) });
  await expect(page.locator('#seek')).toBeVisible();
  const voices = () => st(page, 'Object.keys(state.pbVoices).length');

  await page.locator('#btnPlay').click();
  await expect(page.locator('#btnPlay')).toHaveText(/PAUSE/);
  await page.waitForTimeout(600);
  await page.locator('#btnPlay').click();                              // pause
  await expect(page.locator('#btnPlay')).toHaveText(/PLAY/);
  await expect(page.locator('#status')).toHaveText('PAUSED 0:01 / 1:00');
  expect(await voices()).toBe(0);

  await page.locator('#btnFwd').click();
  await expect(page.locator('#status')).toHaveText('PAUSED 0:11 / 1:00');
  await page.locator('#btnBack').click();
  await page.locator('#btnBack').click();
  await expect(page.locator('#status')).toHaveText('PAUSED 0:00 / 1:00');

  // drag to 30.5 s, in the middle of a held chord: playing from there sounds it at once
  await page.locator('#seek').evaluate(el => { el.value = '30500'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await expect(page.locator('#status')).toHaveText(/PAUSED 0:3[01] \/ 1:00/);
  await page.locator('#btnPlay').click();
  await expect.poll(voices, { timeout: 500 }).toBe(3);
  await expect(page.locator('#status')).toHaveText(/PLAYING 0:3\d \/ 1:00/);
  await page.locator('#btnFwd').click();                               // while playing
  await expect(page.locator('#status')).toHaveText(/PLAYING 0:4\d \/ 1:00/);
  await page.locator('#btnStop').click();
  await expect(page.locator('#seek')).toHaveValue('0');
  expect(await voices()).toBe(0);
});
