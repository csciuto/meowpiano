import { describe, it, expect } from 'vitest';
import { toText, fromText, isSongText, TEXT_HEAD } from '../js/songtext.js';
import { fromMidi, midiNote } from '../js/midi.js';
import { readFileSync } from 'node:fs';

const SET = { loopStart: 0.26, loopEnd: 0.46, crossfade: 0.02, grainDur: 0.1, grainOverlap: 0.5, tuning: 440 };
const on = (note, freq, t, extra = {}) => ({ type: 'on', note, freq, ls: 0.26, le: 0.46, t, ...extra });
const off = (note, t) => ({ type: 'off', note, t });
const shape = evs => evs.map(e => e.type === 'on' ? ['on', midiNote(e.freq), Math.round(e.t), e.vel === undefined ? null : Math.round(e.vel * 127)]
  : e.type === 'off' ? ['off', Math.round(e.t)] : e.type === 'pitch' ? ['pitch', e.bend, Math.round(e.t)] : [e.type, Math.round(e.t)]);

describe('songs as text', () => {
  const take = [
    on('C4', 261.63, 0), on('E4', 329.63, 0, { vel: 90 / 127 }), { type: 'sustain_on', t: 100 },
    off('C4', 480), off('E4', 480), { type: 'pitch', bend: 0.5, t: 600 }, on('A4', 220, 700),     // A3, played an octave down
    { type: 'wheel_release', t: 900 }, off('A4', 1500), { type: 'sustain_off', t: 2000 },
  ];

  it('writes one readable line per thing that happens', () => {
    const text = toText(take, 3250, { ...SET, title: 'First meow' });
    expect(text.split('\n')).toEqual([
      '# Meow Piano song', 'title First meow', 'tuning 440', 'loop 0.26 0.46', 'grain 0.1 0.5 0.02', '',
      '0.000 C4 0.480', '0.000 E4 0.480 v90', '0.100 pedal down', '0.600 bend 0.5', '0.700 A3 0.800',
      '0.900 bend release', '2.000 pedal up', 'end 3.250', '',
    ]);
    expect(isSongText(text)).toBe(true);
    expect(isSongText('MThd')).toBe(false);
  });

  it('reads back what it wrote: notes, octaves, velocity, pedal, wheel, name and settings', () => {
    const file = fromText(toText(take, 3250, { ...SET, title: 'First meow', tuning: 432 }));
    expect(file.title).toBe('First meow');
    expect(file.settings).toEqual({ ...SET, tuning: 432 });
    expect(file.parts).toEqual([{ id: 'song', name: 'Song', notes: 3, drums: false }]);
    const { events, end } = file.build(['song']);
    expect(end).toBe(3250);
    expect(shape(events).sort()).toEqual(shape(take).sort());
  });

  it('can be written by hand: chords with +, flats, comments, any order, Windows line ends', () => {
    const file = fromText('# Meow Piano song\r\n# my tune\r\n\r\n1.0 Bb3 0.5\r\n0 C4+E4+G4 1 v64\r\n0.5 pedal down\r\n');
    const { events, end } = file.build();
    expect(events.filter(e => e.type === 'on').map(e => [midiNote(e.freq), e.t])).toEqual([[60, 0], [64, 0], [67, 0], [58, 1000]]);
    expect(events.filter(e => e.type === 'on')[0].vel).toBeCloseTo(64 / 127);
    expect(end).toBe(1500);
    expect(file.settings).toBe(null);
    expect(new Set(events.filter(e => e.type === 'on').map(e => e.note)).size).toBe(4);     // four keys, none stealing another's
  });

  it('the same note struck again lets go first; two octaves of one note use two keys', () => {
    const { events } = fromText('0 C4 1\n0.5 C4 1\n0.6 C5 1').build();
    expect(events.map(e => [e.type, Math.round(e.t)])).toEqual([['on', 0], ['off', 500], ['on', 500], ['on', 600], ['off', 1500], ['off', 1600]]);
    const [first, , again, high] = events;
    expect(again.note).toBe(first.note);
    expect(high.note).not.toBe(first.note);
  });

  it('says which line it could not read, and why', () => {
    expect(() => fromText('0 C4 1\n1 H4 1')).toThrow('line 2: "H4" is not a note');
    expect(() => fromText('0 C4')).toThrow('line 1: a note needs how long it is held');
    expect(() => fromText('0 C4 1 loud')).toThrow('line 1: how hard a note is hit is v1 to v127');
    expect(() => fromText('soon C4 1')).toThrow('line 1: expected a time');
    expect(() => fromText('1 pedal sideways')).toThrow('line 1: pedal is "down" or "up"');
    expect(() => fromText('loop 0.2')).toThrow('line 1: "loop" needs 2 numbers');
    expect(fromText('# nothing here').parts).toEqual([]);
  });

  it('values are kept in range: bend within two semitones, tuning within the slider', () => {
    const file = fromText('tuning 900\n0 bend 7\n0 C4 1');
    expect(file.settings.tuning).toBe(466);
    expect(file.build().events.find(e => e.type === 'pitch').bend).toBe(2);
  });

  it('the Canon survives a trip through text', () => {
    const midi = fromMidi(new Uint8Array(readFileSync(new URL('../songs/canon-in-d.mid', import.meta.url))));
    const a = midi.build(midi.parts.map(p => p.id));
    const back = fromText(toText(a.events, a.end, { ...SET, title: midi.title })).build();
    const notes = evs => evs.filter(e => e.type === 'on').map(e => [midiNote(e.freq), Math.round(e.t), Math.round(e.vel * 127)]).sort((x, y) => x[1] - y[1] || x[0] - y[0]);
    expect(notes(back.events)).toEqual(notes(a.events));
    expect(Math.round(back.end)).toBe(Math.round(a.end));
    expect(toText(a.events, a.end, SET).startsWith(TEXT_HEAD)).toBe(true);
  });
});
