/**
 * Songs as plain text: something to read, edit in any text editor, paste into a message or keep in a folder
 * of notes. SAVE's MIDI file is for other music programs; this is for people. Pure: no DOM, no audio.
 *
 *   # Meow Piano song
 *   title First meow
 *   tuning 440
 *   loop 0.26 0.46
 *   grain 0.1 0.5 0.02
 *
 *   0.000 C4 0.480
 *   0.000 E4+G4 0.480 v90
 *   0.500 pedal down
 *   1.200 bend 0.50
 *   1.500 bend release
 *   2.000 pedal up
 *   end 3.250
 *
 * Header lines (all optional): the name, A4 in Hz, the loop points in seconds, and the grain length,
 * scatter and crossfade. Then one line per thing that happens, starting with its time in seconds:
 *   a note:   time, pitch (C4 is middle C; sharps as C#4, flats as Db4), how long the key is held, and
 *             optionally v1 to v127 for how hard it was hit. Notes struck together can share a line with +.
 *   pedal:    "pedal down" or "pedal up"
 *   wheel:    "bend" and semitones (-2 to 2), or "bend release" to let it spring back
 *   loop:     "loop" and new loop points, when they change during the song
 * "end" gives the song's length. Lines starting with # are comments. Lines may come in any order.
 */
import { BASE_FREQS } from './notes.js';
import { keyFor, midiNote } from './midi.js';

export const TEXT_HEAD = '# Meow Piano song';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pitchName = m => NAMES[m % 12] + (Math.floor(m / 12) - 1);
function pitchMidi(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  const midi = 12 * (+m[3] + 1) + STEP[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return midi >= 0 && midi <= 127 ? midi : null;
}
const sec = ms => (ms / 1000).toFixed(3);
const num = n => String(+(+n).toFixed(4));

/** Does this text look like one of ours? */
export const isSongText = text => text.replace(/^﻿/, '').trimStart().startsWith(TEXT_HEAD);

/** A take as text. `settings` as in song.js. */
export function toText(events, end, settings) {
  const head = [TEXT_HEAD];
  if (settings.title) head.push('title ' + settings.title.replace(/\s+/g, ' ').trim());
  head.push('tuning ' + num(settings.tuning ?? 440));
  head.push(`loop ${num(settings.loopStart)} ${num(settings.loopEnd)}`);
  head.push(`grain ${num(settings.grainDur)} ${num(settings.grainOverlap)} ${num(settings.crossfade)}`);

  const rows = [];      // [time ms, order, text]
  const open = {};      // note name -> its row, waiting for the key to come up
  let ls = settings.loopStart, le = settings.loopEnd, k = 0;
  const close = (note, t) => {
    const r = open[note];
    if (!r) return;
    r.len = Math.max(1, t - r.t);
    delete open[note];
  };
  for (const e of events) {
    if (e.type === 'on') {
      if (e.ls !== undefined && (e.ls !== ls || e.le !== le)) { ls = e.ls; le = e.le; rows.push({ t: e.t, k: k++, text: `loop ${num(ls)} ${num(le)}` }); }
      close(e.note, e.t);
      const r = { t: e.t, k: k++, pitch: pitchName(Math.max(0, Math.min(127, midiNote(e.freq)))), len: 0, vel: e.vel };
      rows.push(r); open[e.note] = r;
    } else if (e.type === 'off') close(e.note, e.t);
    else if (e.type === 'sustain_on') rows.push({ t: e.t, k: k++, text: 'pedal down' });
    else if (e.type === 'sustain_off') rows.push({ t: e.t, k: k++, text: 'pedal up' });
    else if (e.type === 'pitch') rows.push({ t: e.t, k: k++, text: 'bend ' + (+e.bend.toFixed(2)) });
    else if (e.type === 'wheel_release') rows.push({ t: e.t, k: k++, text: 'bend release' });
  }
  for (const note of Object.keys(open)) close(note, end);
  rows.sort((a, b) => a.t - b.t || a.k - b.k);
  const body = rows.map(r => r.text !== undefined ? `${sec(r.t)} ${r.text}`
    : `${sec(r.t)} ${r.pitch} ${sec(r.len)}${r.vel === undefined ? '' : ' v' + Math.max(1, Math.min(127, Math.round(r.vel * 127)))}`);
  return [...head, '', ...body, 'end ' + sec(end), ''].join('\n');
}

/**
 * Read a song's text. Returns what midi.js's fromMidi returns ({parts, title, settings, build}), so OPEN
 * treats both kinds of file alike. A line it can't read is an error that names the line.
 */
export function fromText(text) {
  const settings = {};
  let title = '', endAt = null;
  const items = [];     // {t, order, kind, ...}
  const bad = (n, why) => { throw new Error(`line ${n}: ${why}`); };
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim(), n = i + 1;
    if (!line || line.startsWith('#')) return;
    const w = line.split(/\s+/);
    const nums = (from, count) => {
      const v = w.slice(from, from + count).map(Number);
      if (v.length !== count || v.some(x => !isFinite(x))) bad(n, `"${w[from - 1]}" needs ${count} number${count > 1 ? 's' : ''}`);
      return v;
    };
    if (w[0] === 'title') { title = line.slice(5).trim().slice(0, 80); return; }
    if (w[0] === 'tuning') { settings.tuning = Math.max(415, Math.min(466, nums(1, 1)[0])); return; }
    if (w[0] === 'loop') { [settings.loopStart, settings.loopEnd] = nums(1, 2); return; }
    if (w[0] === 'grain') { [settings.grainDur, settings.grainOverlap, settings.crossfade] = nums(1, 3); return; }
    if (w[0] === 'end') { endAt = nums(1, 1)[0] * 1000; return; }
    const t = +w[0] * 1000;
    if (!isFinite(t) || t < 0 || w.length < 2) bad(n, 'expected a time in seconds, then a note, "pedal" or "bend"');
    const order = items.length;
    if (w[1] === 'pedal') {
      if (w[2] !== 'down' && w[2] !== 'up') bad(n, 'pedal is "down" or "up"');
      items.push({ t, order, kind: w[2] === 'down' ? 'sustain_on' : 'sustain_off' });
    } else if (w[1] === 'bend') {
      if (w[2] === 'release') items.push({ t, order, kind: 'wheel_release' });
      else items.push({ t, order, kind: 'pitch', bend: Math.max(-2, Math.min(2, nums(2, 1)[0])) });
    } else if (w[1] === 'loop') {
      const [a, b] = nums(2, 2);
      items.push({ t, order, kind: 'loop', ls: a, le: b });
    } else {
      const len = +w[2] * 1000;
      if (!isFinite(len) || len <= 0) bad(n, 'a note needs how long it is held, in seconds');
      let vel;
      if (w[3] !== undefined) {
        const m = /^v(\d{1,3})$/.exec(w[3]);
        if (!m || +m[1] < 1 || +m[1] > 127) bad(n, 'how hard a note is hit is v1 to v127');
        vel = +m[1] / 127;
      }
      for (const name of w[1].split('+')) {
        const midi = pitchMidi(name);
        if (midi === null) bad(n, `"${name}" is not a note (try C4, F#3 or Bb5)`);
        const strike = items.length;      // ties a key-up to its own key-down
        items.push({ t, order, kind: 'on', midi, vel, strike });
        items.push({ t: t + len, order, kind: 'off', midi, strike });
      }
    }
  });

  // in time order; at the same moment keys come up before others go down, as when a note is struck again
  items.sort((a, b) => a.t - b.t || (a.kind === 'off' ? 0 : 1) - (b.kind === 'off' ? 0 : 1) || a.order - b.order);
  const notes = items.filter(e => e.kind === 'on').length;

  function build() {
    const events = [], held = new Map(), byName = new Map();   // MIDI note -> {key name, strike}; key name -> how many hold it
    let ls = settings.loopStart ?? 0.26, le = settings.loopEnd ?? 0.46, end = 0;
    // `strike`: only the key-up that belongs to the note now sounding lets it go; a note struck again was
    // already let go at that moment, and its first key-up, arriving later, must not cut the second short
    const release = (midi, t, strike) => {
      const h = held.get(midi);
      if (!h || (strike !== undefined && h.strike !== strike)) return;
      const name = h.name;
      held.delete(midi);
      byName.set(name, byName.get(name) - 1);
      if (!byName.get(name)) byName.delete(name);
      events.push({ type: 'off', note: name, t });
    };
    for (const e of items) {
      end = Math.max(end, e.t);
      if (e.kind === 'loop') { ls = e.ls; le = e.le; }
      else if (e.kind === 'on') {
        release(e.midi, e.t);
        const key = keyFor(e.midi, new Set(byName.keys()));
        held.set(e.midi, { name: key.note, strike: e.strike });
        byName.set(key.note, (byName.get(key.note) || 0) + 1);
        events.push({ type: 'on', note: key.note, freq: BASE_FREQS[key.note] * Math.pow(2, key.oct), ls, le, t: e.t, ...(e.vel !== undefined && { vel: e.vel }) });
      } else if (e.kind === 'off') release(e.midi, e.t, e.strike);
      else if (e.kind === 'pitch') events.push({ type: 'pitch', bend: e.bend, t: e.t });
      else events.push({ type: e.kind, t: e.t });
    }
    return { events, end: Math.max(end, endAt ?? 0) };
  }

  return { parts: notes ? [{ id: 'song', name: 'Song', notes, drums: false }] : [], title, settings: Object.keys(settings).length ? settings : null, build };
}
