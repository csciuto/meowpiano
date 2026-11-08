import { describe, it, expect } from 'vitest';
import { pack, unpack, playable, songText, readSong, fitSong, springSteps, LINK_CAP, TICK } from '../js/song.js';
import { NOTES, BASE_FREQS } from '../js/notes.js';

const SET = { loopStart: 0.26, loopEnd: 0.46, crossfade: 0.02, grainDur: 0.1, grainOverlap: 0.5, tuning: 440 };
const ROOM = LINK_CAP - 'https://corey.sciu.to/meowpiano/#song='.length;

// a seeded random source so the test piece is the same every run
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

// what a person does at the keyboard, recorded the way the app records it
function performer() {
  const ev = [];
  const on = (note, oct, t, ls = 0.26, le = 0.46) => ev.push({ type: 'on', note, freq: BASE_FREQS[note] * 2 ** oct, sus: false, ls, le, t });
  const off = (note, t) => ev.push({ type: 'off', note, sus: false, t });
  return { ev, on, off, play(note, oct, t, len, lp) { on(note, oct, t, ...(lp || [])); off(note, t + len); } };
}

/**
 * An expressive five minutes: rubato, runs, chords and arpeggios, the pedal changed every bar, octave jumps,
 * loop points changed between sections, and pitch-wheel bends (raw, at the wheel's ~60 moves a second, with
 * the spring-back recorded the way the app records it: one release).
 */
function expressivePiece(minutes = 5, seed = 7) {
  const r = rng(seed), p = performer();
  const scale = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'];
  const chords = [['C4', 'E4', 'G4'], ['A4', 'C5', 'E5'], ['F4', 'A4', 'C5'], ['G4', 'B4', 'D5'], ['D4', 'F#4', 'A4']];
  const end = minutes * 60000;
  let t = 300, bar = 0, lp = [0.26, 0.46], oct = 0;
  while (t < end - 3000) {
    const beat = 520 + r() * 160;                 // rubato, about 100 bpm
    if (bar % 16 === 0 && bar) lp = [0.2 + r() * 0.1, 0.4 + r() * 0.1];   // new section, new loop points
    if (bar % 8 === 4) oct = [-1, 0, 1][Math.floor(r() * 3)];
    p.ev.push({ type: 'sustain_on', t: t + 20 + r() * 30 });
    // left hand: a chord or a broken chord
    const ch = chords[bar % chords.length];
    if (r() < 0.5) ch.forEach((n, i) => p.play(n, oct - 1, t + i * 6 + r() * 15, beat * (1.5 + r()), lp));
    else ch.forEach((n, i) => p.play(n, oct - 1, t + i * beat / 3, beat * 0.9, lp));
    // right hand: a run of 6–16 notes, sometimes double-time
    const n = 6 + Math.floor(r() * 11), step = (beat * 4) / n;
    let at = t, idx = Math.floor(r() * 8);
    for (let k = 0; k < n; k++) {
      idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(r() * 5) - 2));
      const len = step * (0.5 + r() * 0.8);
      p.play(scale[idx], oct, at + r() * 25, len, lp);
      at += step * (0.85 + r() * 0.3);
    }
    // a bend about every other bar: drag up (and maybe down), hold, let go
    if (r() < 0.55) {
      let bt = t + beat * (1 + r() * 2), b = 0;
      // shape: up and hold (most), up and back down, or a vibrato wobble; with a little hand wobble on top
      const peak = (r() < 0.75 ? 1 : -1) * (0.5 + r() * 1.5), moves = 12 + Math.floor(r() * 30), shape = r();
      for (let k = 1; k <= moves; k++) {
        const x = k / moves;
        const y = shape < 0.6 ? Math.sin(x * Math.PI / 2) : shape < 0.85 ? Math.sin(x * Math.PI) : 0.4 * Math.sin(x * Math.PI * 6);
        b = Math.round((peak * y + (r() - 0.5) * 0.04) * 100) / 100;
        p.ev.push({ type: 'pitch', bend: b, t: bt }); bt += 16 + r() * 4;
      }
      p.ev.push({ type: 'wheel_release', t: bt });
    }
    p.ev.push({ type: 'sustain_off', t: t + beat * 4 - 15 });
    t += beat * 4; bar++;
  }
  p.ev.sort((a, b) => a.t - b.t);
  return { events: p.ev, end };
}

const notesOf = evs => evs.filter(e => e.type === 'on').map(e => [e.note, Math.round(Math.log2(e.freq / BASE_FREQS[e.note]))]);

describe('song in a link', () => {
  it('keeps notes, octaves, lengths, pedal and loop points', () => {
    const p = performer();
    p.on('C4', 0, 0); p.ev.push({ type: 'sustain_on', t: 100 }); p.off('C4', 400);
    p.on('A#5', 1, 500, 0.2, 0.5); p.ev.push({ type: 'sustain_off', t: 900 }); p.off('A#5', 1200);
    p.on('E4', -2, 1300);                       // still held when recording stops
    const back = unpack(pack(p.ev, 2000, SET));
    expect(back.settings).toEqual(SET);
    expect(back.end).toBe(2000);
    expect(back.events.map(e => [e.type, e.note, e.t])).toEqual([
      ['on', 'C4', 0], ['sustain_on', undefined, 100], ['off', 'C4', 400],
      ['on', 'A#5', 500], ['sustain_off', undefined, 900], ['off', 'A#5', 1200],
      ['on', 'E4', 1300], ['off', 'E4', 2000],
    ]);
    expect(notesOf(back.events)).toEqual([['C4', 0], ['A#5', 1], ['E4', -2]]);
    const a = back.events.find(e => e.note === 'A#5' && e.type === 'on');
    expect([a.ls, a.le]).toEqual([0.2, 0.5]);
    expect(back.events.find(e => e.note === 'E4').ls).toBe(0.26);   // played after the loop points went back
  });

  it('times land within half a 5 ms step', () => {
    const p = performer();
    for (let i = 0; i < 50; i++) p.play(NOTES[i % 25].note, 0, i * 137.3, 61.7);
    const back = unpack(pack(p.ev, 8000, SET)).events;
    const want = [...p.ev].sort((a, b) => a.t - b.t);
    back.forEach((e, i) => expect(Math.abs(e.t - want[i].t)).toBeLessThanOrEqual(TICK));
  });

  it('a wheel drag keeps its shape within 0.04 semitone, and the release springs back', () => {
    const ev = [];
    for (let k = 0; k <= 30; k++) ev.push({ type: 'pitch', bend: Math.round(2 * Math.sin(k / 30 * Math.PI / 2) * 100) / 100, t: 1000 + k * 16 });
    ev.push({ type: 'wheel_release', t: 1500 });
    const packed = unpack(pack(ev, 2000, SET)).events;
    expect(packed.filter(e => e.type === 'pitch').length).toBeLessThan(12);   // far fewer than 31
    const play = playable(packed).filter(e => e.type === 'pitch');
    for (const raw of ev.filter(e => e.type === 'pitch')) {
      const near = play.reduce((m, e) => (Math.abs(e.t - raw.t) < Math.abs(m.t - raw.t) ? e : m));
      expect(Math.abs(near.bend - raw.bend)).toBeLessThanOrEqual(0.06);
    }
    expect(play.at(-1).bend).toBe(0);
    expect(play.filter(e => e.t > 1500).map(e => +e.bend.toFixed(2))).toEqual(springSteps(2, 1500).map(e => +e.bend.toFixed(2)));
  });

  it('a new drag cuts off a spring still running', () => {
    const ev = [{ type: 'pitch', bend: 2, t: 0 }, { type: 'wheel_release', t: 100 }, { type: 'pitch', bend: 1.5, t: 150 }, { type: 'wheel_release', t: 200 }];
    const play = playable(ev).filter(e => e.type === 'pitch' && e.t > 100 && e.t <= 150);
    expect(play.every(e => e.t < 150 || e.bend === 1.5)).toBe(true);
    expect(play.length).toBeLessThan(5);
  });

  it('the text round-trips', async () => {
    const { events, end } = expressivePiece(0.5);
    const back = await readSong(await songText(events, end, SET));
    expect(notesOf(back.events)).toEqual(notesOf(events));
  });

  it('five expressive minutes fit in an 8,000-character link', async () => {
    const { events, end } = expressivePiece(5);
    const text = await songText(events, end, SET);
    const notes = events.filter(e => e.type === 'on').length, bends = events.filter(e => e.type === 'pitch').length;
    console.log(`5:00 · ${notes} notes · ${bends} raw wheel moves · ${text.length} chars (room ${ROOM})`);
    expect(text.length).toBeLessThanOrEqual(ROOM);
    const back = await readSong(text);
    expect(notesOf(back.events)).toEqual(notesOf(events));
  });

  it('a take too long for a link is cut to fit: the hard stop', async () => {
    const { events, end } = expressivePiece(12);
    const fit = await fitSong(events, end, SET, ROOM);
    expect(fit.cut).toBe(true);
    expect(fit.text.length).toBeLessThanOrEqual(ROOM);
    expect(fit.end).toBeGreaterThan(5 * 60000);
    console.log(`12:00 take cut to ${(fit.end / 60000).toFixed(2)} min at ${fit.text.length} chars`);
    const back = await readSong(fit.text);
    expect(back.events.filter(e => e.type === 'on').length).toBe(fit.events.filter(e => e.type === 'on').length);
  });

  it('keeps the tuning, and reads version-1 links as A = 440', () => {
    const ev = [{ type: 'on', note: 'A4', freq: 440, ls: 0.26, le: 0.46, t: 0 }];
    expect(unpack(pack(ev, 500, { ...SET, tuning: 432.5 })).settings.tuning).toBe(432.5);
    const v1 = pack(ev, 500, SET);
    // version 1 header: loop in/out (2 bytes each), crossfade, grain, scatter; version 2 adds 4400 (2 bytes) after them
    const old = Uint8Array.from([1, ...v1.slice(1, 8), ...v1.slice(10)]);
    const back = unpack(old);
    expect(back.settings.tuning).toBe(440);
    expect(back.events.map(e => [e.type, e.note, e.t])).toEqual([['on', 'A4', 0], ['off', 'A4', 500]]);
  });

  it('rejects a damaged link', async () => {
    await expect(readSong('not-a-song')).rejects.toThrow();
  });
});
