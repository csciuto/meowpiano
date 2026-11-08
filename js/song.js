/**
 * Songs in a link: a recording (keys, pedal, pitch wheel, loop points) packed small enough to share in the
 * address after `#song=`. Pure: no DOM, no audio.
 *
 * Recorded events (state.recEvents), times in ms from the start of the take:
 *   {type:'on', note, freq, ls, le, t}   key down: note name, frequency (octave included), loop points
 *   {type:'off', note, t}                key up
 *   {type:'sustain_on'|'sustain_off', t} pedal
 *   {type:'pitch', bend, t}              wheel (or arrow keys) moved to `bend` semitones
 *   {type:'wheel_release', t}            wheel let go: it springs back to 0 by itself (springSteps)
 *
 * Packed format, version 2 (then deflate-raw, then base64url):
 *   version, header (loop in/out ms, crossfade ms, grain ms, scatter %, tuning: A4 in tenths of Hz; version 1 had no tuning, read as 440), then one record per note, pedal
 *   change, wheel point, wheel release or loop-point change, in time order. Times are 5 ms ticks since the
 *   previous record; how long a key is held is in 10 ms steps. Columns are stored apart (ops, times, keys, lengths, bends, loops) so they compress well.
 *   A note is one record: start, key (note + octave), and how long the key was held.
 *   Wheel drags keep only the points needed to stay within 0.04 semitone (4 cents, below what ears tell apart); playback ramps between them.
 */
import { NOTES, BASE_FREQS } from './notes.js';

export const TICK = 5;            // ms per time step (when things start)
export const LEN_TICK = 10;       // ms per step of how long a key is held: the release fades over 20 ms anyway
export const LINK_CAP = 8000;     // longest whole link we make: some chat apps and servers stop around 8 KB
const VERSION = 2;
const OP = { NOTE: 0, PED_ON: 1, PED_OFF: 2, BEND: 3, RELEASE: 4, LOOP: 5 };
const BEND_TOL = 4;               // hundredths of a semitone
const SPRING_STEPS = 20, SPRING_MS = 16;   // the wheel's spring-back (controls.js)
const RAMP_MS = 16;               // playback step between kept wheel points

const noteIndex = Object.fromEntries(NOTES.map((n, i) => [n.note, i]));

// ── varints ───────────────────────────────────────────────────────────

function putVar(out, v) {
  v = Math.max(0, Math.round(v));
  while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  out.push(v);
}
const zig = v => (v >= 0 ? v * 2 : -v * 2 - 1);
const unzig = v => (v & 1 ? -(v + 1) / 2 : v / 2);
function reader(bytes, start = 0) {
  let i = start;
  return {
    get pos() { return i; },
    var() {
      let v = 0, mul = 1, b;
      do {
        if (i >= bytes.length) throw new Error('song is cut short');
        b = bytes[i++]; v += (b & 0x7f) * mul; mul *= 128;
      } while (b & 0x80);
      return v;
    },
  };
}

// ── wheel ─────────────────────────────────────────────────────────────

/** The wheel's spring back to 0 from `from`, as pitch events starting at `t`. */
export function springSteps(from, t) {
  const out = [];
  for (let s = 1; s <= SPRING_STEPS; s++) {
    out.push({ type: 'pitch', bend: s === SPRING_STEPS ? 0 : from * (1 - s / SPRING_STEPS), t: t + s * SPRING_MS });
  }
  return out;
}

// Ramer–Douglas–Peucker on [tick, centi] points, error measured in centi (vertical)
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const span = pts[b][0] - pts[a][0];
      const k = span ? (pts[i][0] - pts[a][0]) / span : 0;
      const err = Math.abs(pts[i][1] - (pts[a][1] + (pts[b][1] - pts[a][1]) * k));
      if (err > worst) { worst = err; at = i; }
    }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ── encode ────────────────────────────────────────────────────────────

/**
 * Pack a take. `end` is when recording stopped (closes keys still down). `settings` = {loopStart, loopEnd,
 * crossfade, grainDur, grainOverlap, tuning}; tuning (A4 in Hz) defaults to 440.
 */
export function pack(events, end, settings) {
  const recs = [];   // {tick, op, ...}
  const tk = t => Math.max(0, Math.round(t / TICK));
  const open = {};
  const closeNote = (note, t) => { const r = open[note]; if (r) { r.dur = Math.max(1, Math.round((t - r.t) / LEN_TICK)); delete open[note]; } };
  let ls = Math.round(settings.loopStart * 1000), le = Math.round(settings.loopEnd * 1000);
  let drag = [];
  const flushDrag = () => {
    for (const [tick, c] of simplify(drag, BEND_TOL)) recs.push({ tick, op: OP.BEND, c });
    drag = [];
  };
  for (const ev of events) {
    if (ev.type === 'pitch') { drag.push([tk(ev.t), Math.round(ev.bend * 100)]); continue; }
    if (ev.type === 'wheel_release') { flushDrag(); recs.push({ tick: tk(ev.t), op: OP.RELEASE }); continue; }
    if (ev.type === 'on') {
      const i = noteIndex[ev.note];
      if (i === undefined) continue;
      const nls = Math.round(ev.ls * 1000), nle = Math.round(ev.le * 1000);
      if (nls !== ls || nle !== le) { ls = nls; le = nle; recs.push({ tick: tk(ev.t), op: OP.LOOP, ls, le }); }
      closeNote(ev.note, ev.t);
      const oct = Math.max(-2, Math.min(2, Math.round(Math.log2(ev.freq / BASE_FREQS[ev.note]))));
      const r = { tick: tk(ev.t), t: ev.t, op: OP.NOTE, key: i + NOTES.length * (oct + 2), dur: 0 };
      recs.push(r); open[ev.note] = r;
    } else if (ev.type === 'off') closeNote(ev.note, ev.t);
    else if (ev.type === 'sustain_on') recs.push({ tick: tk(ev.t), op: OP.PED_ON });
    else if (ev.type === 'sustain_off') recs.push({ tick: tk(ev.t), op: OP.PED_OFF });
  }
  flushDrag();
  for (const note of Object.keys(open)) closeNote(note, end);
  recs.sort((a, b) => a.tick - b.tick);   // stable: same-tick records keep their order

  const ops = [], times = [], keys = [], durs = [], bends = [], loops = [];
  let prev = 0, lastC = 0;
  for (const r of recs) {
    ops.push(r.op); putVar(times, r.tick - prev); prev = r.tick;
    if (r.op === OP.NOTE) { keys.push(r.key); putVar(durs, r.dur); }
    else if (r.op === OP.BEND) { putVar(bends, zig(r.c - lastC)); lastC = r.c; }
    else if (r.op === OP.RELEASE) lastC = 0;
    else if (r.op === OP.LOOP) { putVar(loops, r.ls); putVar(loops, r.le); }
  }
  const head = [VERSION];
  putVar(head, settings.loopStart * 1000); putVar(head, settings.loopEnd * 1000);
  putVar(head, settings.crossfade * 1000); putVar(head, settings.grainDur * 1000); putVar(head, settings.grainOverlap * 100);
  putVar(head, (settings.tuning ?? 440) * 10);
  putVar(head, tk(end));
  for (const col of [ops, times, keys, durs, bends, loops]) putVar(head, col.length);
  return Uint8Array.from([...head, ...ops, ...times, ...keys, ...durs, ...bends, ...loops]);
}

/** Unpack to {events, end, settings}; events in the recorded form, time order. */
export function unpack(bytes) {
  const h = reader(bytes);
  const version = bytes[0];
  if (version !== 1 && version !== VERSION) throw new Error('unknown song version');
  h.var();
  const settings = {
    loopStart: h.var() / 1000, loopEnd: h.var() / 1000, crossfade: h.var() / 1000,
    grainDur: h.var() / 1000, grainOverlap: h.var() / 100,
  };
  settings.tuning = version >= 2 ? h.var() / 10 : 440;
  const end = h.var() * TICK;
  const lens = [0, 0, 0, 0, 0, 0].map(() => h.var());
  let at = h.pos;
  const cols = lens.map(n => { const s = at; at += n; return s; });
  if (at > bytes.length) throw new Error('song is cut short');
  const ops = bytes.subarray(cols[0], cols[0] + lens[0]), keys = bytes.subarray(cols[2], cols[2] + lens[2]);
  const times = reader(bytes, cols[1]), durs = reader(bytes, cols[3]), bends = reader(bytes, cols[4]), loops = reader(bytes, cols[5]);

  const events = [];
  let tick = 0, ki = 0, c = 0, ls = settings.loopStart, le = settings.loopEnd;
  for (const op of ops) {
    tick += times.var();
    const t = tick * TICK;
    if (op === OP.NOTE) {
      const key = keys[ki++], i = key % NOTES.length, oct = Math.floor(key / NOTES.length) - 2;
      const n = NOTES[i], dur = durs.var() * LEN_TICK;
      if (!n) continue;
      const note = n.note;
      events.push({ type: 'on', note, freq: BASE_FREQS[note] * Math.pow(2, oct), ls, le, t });
      events.push({ type: 'off', note, t: t + dur });
    } else if (op === OP.PED_ON) events.push({ type: 'sustain_on', t });
    else if (op === OP.PED_OFF) events.push({ type: 'sustain_off', t });
    else if (op === OP.BEND) { c += unzig(bends.var()); events.push({ type: 'pitch', bend: c / 100, t }); }
    else if (op === OP.RELEASE) { c = 0; events.push({ type: 'wheel_release', t }); }
    else if (op === OP.LOOP) { ls = loops.var() / 1000; le = loops.var() / 1000; }
  }
  // key-ups were placed by length; put everything back in time order (stable for ties)
  events.sort((a, b) => a.t - b.t);
  return { events, end, settings };
}

/**
 * Events ready to schedule: wheel releases become the spring-back, and kept wheel points are joined by
 * ramps, as the wheel moved when it was played. A new drag cuts off a spring still running.
 */
export function playable(events) {
  const out = [];
  let bend = 0, spring = null;   // spring: pending pitch steps
  const flushSpring = upTo => {
    if (!spring) return;
    for (const s of spring) if (s.t < upTo) out.push(s);
    spring = null;
  };
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'pitch') {
      flushSpring(ev.t);
      const prev = out.length && lastPitch(out);
      // ramp from the previous point of the same drag
      if (prev && prev.drag && ev.t - prev.t > RAMP_MS) {
        for (let t = prev.t + RAMP_MS; t < ev.t; t += RAMP_MS) {
          out.push({ type: 'pitch', bend: prev.bend + (ev.bend - prev.bend) * (t - prev.t) / (ev.t - prev.t), t, drag: true });
        }
      }
      out.push({ type: 'pitch', bend: ev.bend, t: ev.t, drag: true });
      bend = ev.bend;
    } else if (ev.type === 'wheel_release') {
      flushSpring(ev.t);
      const lp = lastPitch(out); if (lp) lp.drag = false;
      spring = springSteps(bend, ev.t); bend = 0;
    } else out.push(ev);
  }
  flushSpring(Infinity);
  return out.sort((a, b) => a.t - b.t).map(({ drag, ...e }) => e);
}
function lastPitch(out) {
  for (let i = out.length - 1; i >= 0; i--) if (out[i].type === 'pitch') return out[i];
  return null;
}

/**
 * Where a song stands at time `at`, for starting playback there: the pedal, the wheel, and the notes
 * sounding (key still down, or key up but held by the pedal; `up` says which). `evs` are playable() events.
 */
export function stateAt(evs, at) {
  let pedal = false, bend = 0;
  const down = new Map();   // note name → {on, up}
  for (const e of evs) {
    if (e.t >= at) break;
    if (e.type === 'sustain_on') pedal = true;
    else if (e.type === 'sustain_off') { pedal = false; for (const [k, v] of down) if (v.up) down.delete(k); }
    else if (e.type === 'pitch') bend = e.bend;
    else if (e.type === 'wheel_release') bend = 0;   // raw events: the spring is short, call it back at 0
    else if (e.type === 'on') down.set(e.note, { on: e, up: false });
    else if (e.type === 'off') {
      const v = down.get(e.note);
      if (v) { if (pedal) v.up = true; else down.delete(e.note); }
    }
  }
  return { pedal, bend, sounding: [...down.values()].map(v => ({ ...v.on, up: v.up })) };
}

// ── link text ─────────────────────────────────────────────────────────

async function squeeze(bytes, mode) {
  const s = new Blob([bytes]).stream().pipeThrough(mode === 'in' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, ch => ch.charCodeAt(0));
}

/** The text after `#song=` for a take. */
export async function songText(events, end, settings) {
  return b64url(await squeeze(pack(events, end, settings), 'in'));
}

/** Read the text after `#song=`. */
export async function readSong(text) {
  return unpack(await squeeze(unb64url(text), 'out'));
}

/**
 * The take from `at` on, starting at 0 as it stood at `at`: the pedal down if it was, the wheel where it was,
 * and notes still sounding struck again (and let go at once if only the pedal held them).
 */
export function slice(events, at) {
  if (at <= 0) return events;
  const s = stateAt(events, at);
  const head = [];
  if (s.pedal) head.push({ type: 'sustain_on', t: 0 });
  if (s.bend) head.push({ type: 'pitch', bend: s.bend, t: 0 });
  for (const e of s.sounding) {
    head.push({ ...e, up: undefined, t: 0 });
    if (e.up) head.push({ type: 'off', note: e.note, t: 0 });
  }
  return head.concat(events.filter(e => e.t >= at).map(e => ({ ...e, t: e.t - at })));
}

/**
 * The take cut, if needed, so its text fits in `room` characters. `keep` 'first' keeps the beginning (a song
 * opened from a file), 'last' the end (a recording: the warm-up goes, what was just played stays). Returns
 * {text, events, end, cut, from} where events and end are what the link holds and `from` is where it starts.
 */
export async function fitSong(events, end, settings, room, keep = 'first') {
  let text = await songText(events, end, settings);
  if (text.length <= room) return { text, events, end, cut: false, from: 0 };
  let best = { text: await songText([], 0, settings), events: [], end: 0, from: end };
  if (keep === 'last') {   // binary search the earliest start that fits
    let lo = 0, hi = end;
    while (hi - lo > 50) {
      const mid = (lo + hi) / 2, part = slice(events, mid);
      const t = await songText(part, end - mid, settings);
      if (t.length <= room) { hi = mid; best = { text: t, events: part, end: end - mid, from: mid }; } else lo = mid;
    }
  } else {                 // binary search the latest end that fits
    let lo = 0, hi = end;
    while (hi - lo > 50) {
      const mid = (lo + hi) / 2, part = events.filter(e => e.t < mid);
      const t = await songText(part, mid, settings);
      if (t.length <= room) { lo = mid; best = { text: t, events: part, end: mid, from: 0 }; } else hi = mid;
    }
  }
  return { ...best, cut: true };
}

export const fmtTime = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
