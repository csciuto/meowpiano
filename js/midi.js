/**
 * Standard MIDI files in and out. Pure: no DOM, no audio.
 *
 * Reading: every (track, channel) with notes is a part. `fromMidi` lists the parts; `build` turns the chosen
 * ones into recorded events (song.js) so they play, show and share like a recording. Notes fold into the
 * range the piano reaches (C2–C8); every note plays at one loudness (velocity is ignored).
 *
 * Writing: one track, 1 tick = 1 ms, notes on channel 1 at velocity 100, the pedal as CC64, the wheel as pitch
 * bend (±2 semitones, the MIDI default). Loop points, grain settings and tuning ride along as text events
 * starting "meowpiano", so a file saved here opens with the same sound and name.
 */
import { NOTES, BASE_FREQS } from './notes.js';
import { playable, TICK } from './song.js';

const TAG = 'meowpiano';
const DRUM_CH = 9;   // channel 10
const FAMILIES = ['Piano', 'Chromatic perc.', 'Organ', 'Guitar', 'Bass', 'Strings', 'Ensemble', 'Brass',
  'Reed', 'Pipe', 'Synth lead', 'Synth pad', 'Synth FX', 'Ethnic', 'Percussive', 'Sound FX'];

// ── reading ───────────────────────────────────────────────────────────

function parseFile(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (at, n) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (bytes.length < 14 || str(0, 4) !== 'MThd') throw new Error('not a MIDI file');
  const hlen = dv.getUint32(4), ntrks = dv.getUint16(10), division = dv.getUint16(12);
  let at = 8 + hlen;
  const tracks = [];
  for (let n = 0; n < ntrks && at + 8 <= bytes.length; n++) {
    const len = dv.getUint32(at + 4);
    if (str(at, 4) !== 'MTrk') { at += 8 + len; n--; continue; }   // skip unknown chunks
    tracks.push(readTrack(bytes, at + 8, Math.min(bytes.length, at + 8 + len)));
    at += 8 + len;
  }
  return { division, tracks };
}

function readTrack(bytes, i, stop) {
  const evs = [];
  let tick = 0, status = 0;
  const vlq = () => { let v = 0, b; do { b = bytes[i++]; v = v * 128 + (b & 0x7f); } while (b & 0x80 && i < stop); return v; };
  while (i < stop) {
    tick += vlq();
    let b = bytes[i];
    if (b & 0x80) { status = b; i++; } else if (!status) break;   // running status
    const type = status & 0xf0, ch = status & 0x0f;
    if (status === 0xff) {
      const meta = bytes[i++], len = vlq(), data = bytes.subarray(i, i + len); i += len;
      status = 0;
      if (meta === 0x2f) { evs.push({ tick, kind: 'end' }); break; }
      if (meta === 0x51 && len === 3) evs.push({ tick, kind: 'tempo', us: (data[0] << 16) | (data[1] << 8) | data[2] });
      else if (meta === 0x03) evs.push({ tick, kind: 'name', text: String.fromCharCode(...data) });
      else if (meta === 0x01 || meta === 0x06) evs.push({ tick, kind: 'text', text: String.fromCharCode(...data) });
    } else if (status === 0xf0 || status === 0xf7) {
      i += vlq(); status = 0;
    } else if (type === 0xc0 || type === 0xd0) {
      const a = bytes[i++];
      if (type === 0xc0) evs.push({ tick, kind: 'program', ch, value: a });
    } else {
      const a = bytes[i++], c = bytes[i++];
      if (type === 0x90 && c > 0) evs.push({ tick, kind: 'on', ch, note: a });
      else if (type === 0x80 || type === 0x90) evs.push({ tick, kind: 'off', ch, note: a });
      else if (type === 0xb0 && a === 64) evs.push({ tick, kind: 'pedal', ch, down: c >= 64 });
      else if (type === 0xe0) evs.push({ tick, kind: 'bend', ch, value: a | (c << 7) });
    }
  }
  return evs;
}

/** Milliseconds for a tick, following tempo changes. */
function clock(division, tempos) {
  if (division & 0x8000) {   // SMPTE: frames per second × ticks per frame
    const fps = 256 - (division >> 8), tpf = division & 0xff;
    return tick => tick * 1000 / (fps * tpf);
  }
  const ppq = division || 480;
  const marks = [{ tick: 0, ms: 0, us: 500000 }];
  for (const t of tempos.sort((a, b) => a.tick - b.tick)) {
    const m = marks.at(-1);
    marks.push({ tick: t.tick, ms: m.ms + (t.tick - m.tick) * m.us / ppq / 1000, us: t.us });
  }
  return tick => {
    let m = marks[0];
    for (const k of marks) { if (k.tick <= tick) m = k; else break; }
    return m.ms + (tick - m.tick) * m.us / ppq / 1000;
  };
}

function readSettings(text, into) {
  const kv = Object.fromEntries(text.slice(TAG.length).trim().split(/\s+/).map(p => p.split('=')));
  const num = k => (kv[k] !== undefined && isFinite(+kv[k]) ? +kv[k] : undefined);
  const map = { ls: 'loopStart', le: 'loopEnd', xf: 'crossfade', grain: 'grainDur', scatter: 'grainOverlap', a4: 'tuning' };
  for (const [k, name] of Object.entries(map)) if (num(k) !== undefined) into[name] = num(k);
  if (kv.title) try { into.title = decodeURIComponent(kv.title); } catch (_) {}
  return into;
}

/** The piano key and octave for MIDI note `m`, avoiding note names already sounding. */
export function keyFor(m, sounding = new Set()) {
  while (m < 36) m += 12;
  while (m > 108) m -= 12;
  const options = [0, 1, -1, 2, -2]
    .map(oct => ({ oct, i: m - 60 - 12 * oct }))
    .filter(o => o.i >= 0 && o.i < NOTES.length)
    .map(o => ({ note: NOTES[o.i].note, oct: o.oct }));
  return options.find(o => !sounding.has(o.note)) || options[0];
}

/**
 * Read a .mid file. Returns {parts, title, settings, build}: parts = [{id, name, notes, drums}] in the file's
 * order, title = the song's name if the file has one (else ''), settings = what a
 * file saved here carries (else null), build(ids) = {events, end} for the chosen parts.
 */
export function fromMidi(bytes) {
  const { division, tracks } = parseFile(bytes);
  const all = tracks.flatMap((evs, track) => evs.map(e => ({ ...e, track })));
  const ms = clock(division, all.filter(e => e.kind === 'tempo'));
  all.forEach((e, k) => { e.t = ms(e.tick); e.k = k; });
  all.sort((a, b) => a.t - b.t || a.k - b.k);

  // parts: a track's notes on one channel
  const parts = new Map();
  const names = {}, programs = {};
  let settings = null;
  for (const e of all) {
    if (e.kind === 'name' && !names[e.track]) names[e.track] = e.text.trim();
    if (e.kind === 'program' && programs[e.track + ':' + e.ch] === undefined) programs[e.track + ':' + e.ch] = e.value;
    if (e.kind === 'text' && e.text.startsWith(TAG + ' ') && !e.text.startsWith(TAG + ' loop')) settings = readSettings(e.text, settings || {});
    if (e.kind === 'on') {
      const id = e.track + ':' + e.ch;
      if (!parts.has(id)) parts.set(id, { id, track: e.track, ch: e.ch, notes: 0, drums: e.ch === DRUM_CH });
      parts.get(id).notes++;
    }
  }
  const list = [...parts.values()].sort((a, b) => a.track - b.track || a.ch - b.ch);   // the file's order
  const perTrack = {};
  list.forEach(p => { perTrack[p.track] = (perTrack[p.track] || 0) + 1; });
  for (const p of list) {
    const prog = programs[p.id];
    let name = names[p.track] || (p.drums ? 'Drums' : prog !== undefined ? FAMILIES[prog >> 3] : 'Channel ' + (p.ch + 1));
    if (perTrack[p.track] > 1) name += ' · ch ' + (p.ch + 1);
    p.name = name;
  }
  const lastT = all.reduce((m, e) => Math.max(m, e.t), 0);
  // the song's name: what a track without notes (the conductor track, usually) is called
  const withNotes = new Set(list.map(p => p.track));
  const title = settings?.title || Object.keys(names).map(Number).sort((a, b) => a - b).filter(t => !withNotes.has(t)).map(t => names[t]).find(Boolean) || '';

  function build(ids) {
    const chosen = new Set(ids);
    const events = [], sounding = new Map(), byName = new Map();   // part+midi note → note name; note name → count
    const pedals = new Map(), bends = new Map();
    let ls = settings?.loopStart ?? 0.26, le = settings?.loopEnd ?? 0.46, pedal = false, bend = 0, lastBendT = -Infinity, end = 0;
    const off = (key, t) => {
      const name = sounding.get(key);
      if (!name) return;
      sounding.delete(key);
      byName.set(name, byName.get(name) - 1);
      if (!byName.get(name)) byName.delete(name);
      events.push({ type: 'off', note: name, t });
      end = Math.max(end, t);
    };
    for (const e of all) {
      if (e.kind === 'text' && e.text.startsWith(TAG + ' loop')) {
        const [a, b] = e.text.split(/\s+/).slice(2).map(Number);
        if (isFinite(a) && isFinite(b)) { ls = a; le = b; }
        continue;
      }
      const id = e.track + ':' + e.ch;
      if (!chosen.has(id) && e.kind !== 'end') continue;
      if (e.kind === 'on') {
        const key = id + ':' + e.note;
        off(key, e.t);   // the same key struck again
        const k = keyFor(e.note, new Set(byName.keys()));
        sounding.set(key, k.note);
        byName.set(k.note, (byName.get(k.note) || 0) + 1);
        events.push({ type: 'on', note: k.note, freq: BASE_FREQS[k.note] * Math.pow(2, k.oct), ls, le, t: e.t });
        end = Math.max(end, e.t);
      } else if (e.kind === 'off') off(id + ':' + e.note, e.t);
      else if (e.kind === 'pedal') {
        pedals.set(id, e.down);
        const down = [...pedals.values()].some(Boolean);
        if (down !== pedal) { pedal = down; events.push({ type: down ? 'sustain_on' : 'sustain_off', t: e.t }); }
      } else if (e.kind === 'bend') {
        bends.set(id, e.value);
        const b = Math.round(Math.max(-2, Math.min(2, (e.value - 8192) / 8192 * 2)) * 100) / 100;
        if (b === bend) continue;
        // MIDI bends are steps: hold the old value until just before the new one (playback ramps between points)
        if (e.t - lastBendT > 16) events.push({ type: 'pitch', bend, t: Math.max(0, e.t - TICK) });
        events.push({ type: 'pitch', bend: b, t: e.t });
        bend = b; lastBendT = e.t;
      } else if (e.kind === 'end') end = Math.max(end, e.t);
    }
    for (const key of [...sounding.keys()]) off(key, lastT);
    if (pedal) events.push({ type: 'sustain_off', t: end });
    events.sort((a, b) => a.t - b.t);
    return { events, end };
  }

  return { parts: list.map(({ id, name, notes, drums }) => ({ id, name, notes, drums })), title, settings, build };
}

// ── writing ───────────────────────────────────────────────────────────

function vlq(out, v) {
  v = Math.max(0, Math.round(v));
  const stack = [v & 0x7f];
  while ((v = Math.floor(v / 128))) stack.push((v & 0x7f) | 0x80);
  while (stack.length) out.push(stack.pop());
}
const textBytes = s => Array.from(s, ch => ch.charCodeAt(0) & 0xff);
export const midiNote = freq => Math.round(69 + 12 * Math.log2(freq / 440));

/** A take as a .mid file (Uint8Array). `settings` as in song.js. */
export function toMidi(events, end, settings) {
  const out = [];
  let last = 0;
  const at = t => { const tick = Math.max(last, Math.round(t)); vlq(out, tick - last); last = tick; };
  const meta = (t, type, s) => { at(t); const b = textBytes(s); out.push(0xff, type); vlq(out, b.length); out.push(...b); };
  meta(0, 0x03, 'meowpiano');
  at(0); out.push(0xff, 0x51, 3, 0x07, 0xa1, 0x20);   // 500,000 µs a quarter: with 500 ticks a quarter, 1 tick = 1 ms
  const f = n => +n.toFixed(4);
  meta(0, 0x01, `${TAG} ls=${f(settings.loopStart)} le=${f(settings.loopEnd)} xf=${f(settings.crossfade)} grain=${f(settings.grainDur)} scatter=${f(settings.grainOverlap)} a4=${settings.tuning ?? 440}${settings.title ? ' title=' + encodeURIComponent(settings.title) : ''}`);
  let ls = settings.loopStart, le = settings.loopEnd;
  const held = {};   // note name → MIDI note
  for (const e of playable(events)) {
    if (e.type === 'on') {
      if (e.ls !== ls || e.le !== le) { ls = e.ls; le = e.le; meta(e.t, 0x06, `${TAG} loop ${f(ls)} ${f(le)}`); }
      const m = Math.max(0, Math.min(127, midiNote(e.freq)));
      if (held[e.note] !== undefined) { at(e.t); out.push(0x80, held[e.note], 0); }
      held[e.note] = m;
      at(e.t); out.push(0x90, m, 100);
    } else if (e.type === 'off') {
      if (held[e.note] === undefined) continue;
      at(e.t); out.push(0x80, held[e.note], 0); delete held[e.note];
    } else if (e.type === 'sustain_on' || e.type === 'sustain_off') {
      at(e.t); out.push(0xb0, 64, e.type === 'sustain_on' ? 127 : 0);
    } else if (e.type === 'pitch') {
      const v = Math.max(0, Math.min(16383, Math.round(8192 + e.bend / 2 * 8192)));
      at(e.t); out.push(0xe0, v & 0x7f, v >> 7);
    }
  }
  for (const m of Object.values(held)) { at(end); out.push(0x80, m, 0); }
  at(end); out.push(0xff, 0x2f, 0);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xf4,   // format 0, one track, 500 ticks a quarter
    0x4d, 0x54, 0x72, 0x6b, (out.length >>> 24) & 0xff, (out.length >>> 16) & 0xff, (out.length >>> 8) & 0xff, out.length & 0xff];
  return Uint8Array.from([...head, ...out]);
}
