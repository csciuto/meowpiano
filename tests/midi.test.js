import { describe, it, expect } from 'vitest';
import { fromMidi, toMidi, keyFor, midiNote } from '../js/midi.js';
import { BASE_FREQS } from '../js/notes.js';
import { bandFile } from './midiFixture.js';

const SET = { loopStart: 0.26, loopEnd: 0.46, crossfade: 0.02, grainDur: 0.1, grainOverlap: 0.5, tuning: 440 };
const ons = evs => evs.filter(e => e.type === 'on').map(e => [midiNote(e.freq), Math.round(e.t)]);

describe('reading MIDI files', () => {
  const file = fromMidi(bandFile());

  it('lists each instrument, named from the file, drums marked', () => {
    expect(file.parts).toEqual([
      { id: '1:0', name: 'Lead Guitar', notes: 3, drums: false },
      { id: '2:1', name: 'Bass', notes: 2, drums: false },
      { id: '3:9', name: 'Drums', notes: 1, drums: true },
    ]);
    expect(file.settings).toBe(null);
  });

  it('places notes in time through tempo changes, with running status and velocity-0 note-offs', () => {
    const { events, end } = file.build(['1:0']);
    expect(ons(events)).toEqual([[60, 0], [64, 500], [72, 2000]]);
    const off = events.find(e => e.type === 'off' && e.note === 'C4');
    expect(off.t).toBe(500);
    expect(events.filter(e => e.type.startsWith('sustain')).map(e => [e.type, e.t])).toEqual([['sustain_on', 500], ['sustain_off', 3000]]);
    const bend = events.filter(e => e.type === 'pitch');
    expect(bend.at(-1)).toEqual({ type: 'pitch', bend: 1, t: 1000 });
    expect(bend[0].bend).toBe(0);   // held at 0 until the step
    expect(end).toBe(3000);
  });

  it('keeps how hard each note was hit, and writes it back', () => {
    const { events, end } = file.build(['1:0']);
    const vels = evs => evs.filter(e => e.type === 'on').map(e => Math.round(e.vel * 127));
    expect(vels(events)).toEqual([100, 100, 90]);
    const again = fromMidi(toMidi(events, end, SET));
    expect(vels(again.build(again.parts.map(p => p.id)).events)).toEqual([100, 100, 90]);
    // a note played without a velocity (the computer keys) is written at 100
    const plain = fromMidi(toMidi([{ type: 'on', note: 'A4', freq: 440, ls: 0.26, le: 0.46, t: 0 }, { type: 'off', note: 'A4', t: 100 }], 200, SET));
    expect(vels(plain.build(plain.parts.map(p => p.id)).events)).toEqual([100]);
  });

  it('mixes the chosen parts; notes too low fold up into reach', () => {
    const { events } = file.build(['1:0', '2:1']);
    expect(ons(events)).toEqual([[60, 0], [36, 0], [64, 500], [72, 2000], [36, 2000]]);   // MIDI 24 (C1) → C2
  });

  it('a pitch in two octaves at once uses two key names, so neither cuts off the other', () => {
    const a = keyFor(72), b = keyFor(60, new Set([a.note]));
    expect(a).toEqual({ note: 'C5', oct: 0 });
    expect(b.note).not.toBe(a.note);
    expect(BASE_FREQS[b.note] * 2 ** b.oct).toBeCloseTo(261.63, 1);
  });

  it('rejects a file that is not MIDI', () => {
    expect(() => fromMidi(new TextEncoder().encode('hello there, not midi'))).toThrow();
  });
});

describe('writing MIDI files', () => {
  it('a take saved and opened again keeps notes, octaves, pedal, wheel and settings', () => {
    const ev = [
      { type: 'on', note: 'C4', freq: 261.63, ls: 0.26, le: 0.46, t: 0 },
      { type: 'sustain_on', t: 100 },
      { type: 'on', note: 'A4', freq: 880, ls: 0.2, le: 0.5, t: 250 },
      { type: 'off', note: 'C4', t: 400 },
      { type: 'pitch', bend: 1.5, t: 500 }, { type: 'wheel_release', t: 700 },
      { type: 'off', note: 'A4', t: 900 },
      { type: 'sustain_off', t: 1200 },
    ];
    const set = { ...SET, tuning: 435, grainDur: 0.07 };
    const back = fromMidi(toMidi(ev, 1500, set));
    expect(back.parts).toHaveLength(1);
    expect(back.settings).toEqual(set);
    const { events, end } = back.build([back.parts[0].id]);
    expect(end).toBe(1500);
    expect(ons(events)).toEqual([[60, 0], [81, 250]]);
    expect(events.find(e => e.type === 'on' && e.t === 250)).toMatchObject({ ls: 0.2, le: 0.5 });
    expect(events.filter(e => e.type === 'off').map(e => e.t)).toEqual([400, 900]);
    expect(events.filter(e => e.type.startsWith('sustain')).map(e => e.t)).toEqual([100, 1200]);
    const pitch = events.filter(e => e.type === 'pitch');
    expect(Math.max(...pitch.map(e => e.bend))).toBe(1.5);
    expect(pitch.at(-1).bend).toBe(0);   // the spring-back is in the file
  });
});

describe('the Canon in D test file (songs/canon-in-d.mid, made by scripts/make-canon.js)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fitSong, LINK_CAP } = await import('../js/song.js');
  const file = fromMidi(new Uint8Array(readFileSync(new URL('../songs/canon-in-d.mid', import.meta.url))));
  const all = file.build(file.parts.map(p => p.id));

  it('has its name, and four instruments in the file’s order', () => {
    expect(file.title).toBe('Canon in D');
    expect(file.parts.map(p => [p.name, p.notes])).toEqual([['Violin I', 161], ['Violin II', 161], ['Violin III', 161], ['Basso continuo', 105]]);
  });

  it('slows down at the end (tempo changes) and ends on a D major chord with vibrato', () => {
    const bass = file.build([file.parts[3].id]).events.filter(e => e.type === 'on');
    const gap = (i) => bass[i + 1].t - bass[i].t;
    expect(gap(0)).toBeCloseTo(1000, 0);                     // quarter = 60
    expect(gap(bass.length - 2)).toBeGreaterThan(1150);      // slower in the last bar
    const lastOns = all.events.filter(e => e.type === 'on').slice(-4).map(e => midiNote(e.freq) % 12).sort((a, b) => a - b);
    expect(lastOns).toEqual([2, 2, 6, 9]);                   // D, D, F#, A
    const bends = all.events.filter(e => e.type === 'pitch');
    expect(Math.max(...bends.map(e => Math.abs(e.bend)))).toBeLessThan(0.1);
    expect(bends.at(-1).bend).toBe(0);
  });

  it("help.html's Hear Canon in D link opens this song", async () => {
    const { readSong } = await import('../js/song.js');
    const html = readFileSync(new URL('../help.html', import.meta.url), 'utf8');
    const song = await readSong(html.match(/#song=([\w-]+)">▶ Hear Canon/)[1]);
    expect(song.settings.title).toBe('Canon in D');
    expect(song.events.filter(e => e.type === 'on').length).toBe(588);
    expect(song.events.filter(e => e.type === 'on').every(e => e.vel > 0.5 && e.vel < 0.75)).toBe(true);   // the file's dynamics
  });

  it('every note is in D major, and all of it fits in one link', async () => {
    const pcs = new Set(all.events.filter(e => e.type === 'on').map(e => midiNote(e.freq) % 12));
    expect([...pcs].every(pc => [1, 2, 4, 6, 7, 9, 11].includes(pc))).toBe(true);
    const fit = await fitSong(all.events, all.end, { ...SET, title: file.title }, LINK_CAP - 'https://corey.sciu.to/meowpiano/#song='.length);
    expect(fit.cut).toBe(false);
  });
});

describe("the Brahms' Lullaby demo file (songs/brahms-lullaby.mid, made by scripts/make-lullaby.js)", async () => {
  const { readFileSync } = await import('node:fs');
  const file = fromMidi(new Uint8Array(readFileSync(new URL('../songs/brahms-lullaby.mid', import.meta.url))));
  const all = file.build(file.parts.map(p => p.id));
  const notes = all.events.filter(e => e.type === 'on');

  it('has its name and two parts: the melody and its accompaniment', () => {
    expect(file.title).toBe("Brahms' Lullaby");
    expect(file.parts.map(p => p.name)).toEqual(['Melody', 'Accompaniment']);
  });

  it('is in F major, in three, played twice, about a minute and a half', () => {
    const pcs = new Set(notes.map(e => midiNote(e.freq) % 12));
    expect([...pcs].every(pc => [0, 2, 4, 5, 7, 9, 10].includes(pc))).toBe(true);
    const melody = file.build(['1:0']).events.filter(e => e.type === 'on');
    expect(melody.length).toBe(102);
    expect(melody.slice(0, 5).map(e => midiNote(e.freq))).toEqual([69, 69, 72, 69, 69]);   // A A C, A A (C)
    expect(midiNote(melody.at(-1).freq)).toBe(65);                                         // ends on F
    expect(all.end / 1000).toBeGreaterThan(80);
    expect(all.end / 1000).toBeLessThan(100);
  });

  it('is played gently, and softer the second time', () => {
    const vel = notes.map(e => e.vel * 127);
    expect(Math.max(...vel)).toBeLessThan(85);
    const half = notes.length / 2, mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(vel.slice(half))).toBeLessThan(mean(vel.slice(0, half)) - 5);
  });

  it("help.html's Hear Brahms' Lullaby link opens this song, dynamics included", async () => {
    const { readSong } = await import('../js/song.js');
    const html = readFileSync(new URL('../help.html', import.meta.url), 'utf8');
    const song = await readSong(html.match(/#song=([\w-]+)">▶ Hear Brahms/)[1]);
    expect(song.settings.title).toBe("Brahms' Lullaby");
    const back = song.events.filter(e => e.type === 'on');
    expect(back.length).toBe(notes.length);
    expect(back.map(e => Math.round(e.vel * 127))).toEqual(notes.map(e => Math.round(e.vel * 127)));
  });
});
