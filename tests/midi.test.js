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
