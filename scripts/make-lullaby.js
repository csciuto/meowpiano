// Writes songs/brahms-lullaby.mid: Brahms's Lullaby (Wiegenlied, Op. 49 No. 4; public domain), sequenced
// here as a second demo for meowpiano. Run: node scripts/make-lullaby.js
//
// F major, 3/4, 66 to the quarter. Two tracks after a conductor track: the melody, and a waltz
// accompaniment (bass note, then two chord notes). Played twice, the second time softer; the last two
// bars slow down. Velocities are gentle throughout, so it also shows the piano following how hard notes are hit.
import { writeFileSync } from 'node:fs';

const PPQ = 480, Q = PPQ, E = Q / 2, H = 2 * Q, BAR = 3 * Q;
const N = name => {                                            // 'Bb4' → MIDI note
  const m = name.match(/^([A-G])([b#]?)(-?\d)$/);
  return 12 * (+m[3] + 1) + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};

// the tune, bar by bar: [note, length]. It starts with a two-note pickup, and each bar ends with the next one's.
const PICKUP = [['A4', E], ['A4', E]];
const TUNE = [
  [['C5', H], ['A4', E], ['A4', E]],
  [['C5', H], ['A4', E], ['C5', E]],
  [['F5', Q], ['E5', Q + E], ['D5', E]],
  [['D5', Q], ['C5', Q], ['G4', E], ['A4', E]],
  [['Bb4', Q], ['G4', Q], ['G4', E], ['A4', E]],
  [['Bb4', H], ['G4', E], ['Bb4', E]],
  [['E5', E], ['D5', E], ['C5', Q], ['E5', Q]],
  [['F5', H], ['F4', E], ['F4', E]],
  [['F5', H], ['D5', E], ['Bb4', E]],
  [['C5', H], ['A4', E], ['F4', E]],
  [['Bb4', Q], ['C5', Q], ['D5', Q]],
  [['C5', H], ['F4', E], ['F4', E]],
  [['F5', H], ['D5', E], ['Bb4', E]],
  [['C5', H], ['A4', E], ['F4', E]],
  [['Bb4', Q], ['A4', Q], ['G4', Q]],
  [['F4', BAR]],
];
// one chord a bar: [bass, two notes above it]
const F = ['F2', 'C3', 'A3'], C7 = ['C3', 'E3', 'Bb3'], Bb = ['Bb2', 'D3', 'F3'];
const CHORDS = [F, F, F, C7, C7, C7, C7, F, Bb, F, C7, F, Bb, F, C7, F];

function vlq(v) { const s = [v & 0x7f]; while ((v >>= 7)) s.push((v & 0x7f) | 0x80); return s.reverse(); }
function track(events) {                                       // events: [tick, ...bytes]
  events.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0));   // note-offs (0x80) before note-ons
  const out = []; let last = 0;
  for (const [t, ...bytes] of events) { out.push(...vlq(t - last), ...bytes); last = t; }
  out.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, out.length >>> 24, (out.length >> 16) & 255, (out.length >> 8) & 255, out.length & 255, ...out];
}
const text = (t, type, s) => { const b = [...Buffer.from(s)]; return [t, 0xff, type, ...vlq(b.length), ...b]; };
const note = (ev, ch, t, n, len, vel) => { ev.push([t, 0x90 | ch, N(n), vel], [t + Math.round(len * 0.94), 0x80 | ch, N(n), 0]); };

const PASSES = 2, START = Q;                  // the pickup fills the last beat of an opening bar: start one beat in
const melody = [text(0, 0x03, 'Melody'), [0, 0xc0, 10]];        // program 10: music box
const comp = [text(0, 0x03, 'Accompaniment'), [0, 0xc1, 0]];
for (let pass = 0; pass < PASSES; pass++) {
  const base = START + Q + pass * TUNE.length * BAR;            // where this pass's first full bar starts
  const soft = pass ? 14 : 0;
  if (pass === 0) PICKUP.reduce((t, [n, len]) => (note(melody, 0, t, n, len, 62), t + len), base - Q);
  TUNE.forEach((bar, b) => {
    const lastBar = pass === PASSES - 1 && b === TUNE.length - 1;
    // going round again: the final note is shortened to make room for the pickup into the next pass
    if (b === TUNE.length - 1 && !lastBar) bar = [['F4', H], ...PICKUP];
    let t = base + b * BAR;
    for (const [n, len] of bar) {
      // the first beat leans a little; the short notes are lighter
      const vel = (t === base + b * BAR ? 78 : len === E ? 64 : 70) - soft;
      note(melody, 0, t, n, lastBar ? len * 1.6 : len, vel);
      t += len;
    }
    const [bass, mid, top] = CHORDS[b], at = base + b * BAR;
    note(comp, 1, at, bass, lastBar ? BAR * 1.6 : Q * 2.6, 54 - soft / 2);
    if (!lastBar) { note(comp, 1, at + Q, mid, Q, 44 - soft / 2); note(comp, 1, at + 2 * Q, top, Q, 44 - soft / 2); }
    else { note(comp, 1, at, mid, BAR * 1.6, 40 - soft / 2); note(comp, 1, at, top, BAR * 1.6, 40 - soft / 2); }
  });
}
const endBar = START + Q + PASSES * TUNE.length * BAR;         // where the last bar ends

// conductor: name, meter, tempo, and the slowing over the last two bars
const cond = [text(0, 0x03, "Brahms' Lullaby"), text(0, 0x02, 'Brahms, Op. 49 No. 4, public domain; sequenced for meowpiano'),
  [0, 0xff, 0x58, 4, 3, 2, 24, 8]];
const tempo = (t, bpm) => { const us = Math.round(60e6 / bpm); cond.push([t, 0xff, 0x51, 3, us >> 16, (us >> 8) & 255, us & 255]); };
tempo(0, 66);
for (let b = 0; b < 6; b++) tempo(endBar - 2 * BAR + b * Q, 66 - b * 4);

const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, PPQ >> 8, PPQ & 255];
const file = Uint8Array.from([...head, ...track(cond), ...track(melody), ...track(comp)]);
writeFileSync(new URL('../songs/brahms-lullaby.mid', import.meta.url), file);
console.log('songs/brahms-lullaby.mid', file.length, 'bytes');
