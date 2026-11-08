// Writes songs/canon-in-d.mid: Pachelbel's Canon in D (the composition is public domain), sequenced here
// for meowpiano's tests and as a demo. Run: node scripts/make-canon.js
//
// Four tracks after a conductor track: Violin I, II and III play the same line two bars apart (a canon),
// over the Basso continuo's eight-note ground. Quarter = 60; the last two bars slow down (tempo changes),
// and Violin I's last note has a little vibrato (pitch bend).
import { writeFileSync } from 'node:fs';

const PPQ = 480, Q = PPQ, E = Q / 2, S = Q / 4;
const D_MAJOR = [1, 2, 4, 6, 7, 9, 11];                    // C# D E F# G A B as pitch classes, low to high
const N = name => {                                            // 'F#5' → MIDI note
  const m = name.match(/^([A-G])(#?)(-?\d)$/);
  return 12 * (+m[3] + 1) + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
};
const step = (note, k) => {                                    // move k steps along the D major scale
  const d = Math.floor(note / 12) * 7 + D_MAJOR.indexOf(note % 12) + k;
  return Math.floor(d / 7) * 12 + D_MAJOR[((d % 7) + 7) % 7];
};

// the ground (one note a beat) and its chords: D A Bm F#m G D G A
const GROUND = ['D3', 'A2', 'B2', 'F#2', 'G2', 'D2', 'G2', 'A2'].map(N);
const CHORDS = [['D', 'F#', 'A'], ['A', 'C#', 'E'], ['B', 'D', 'F#'], ['F#', 'A', 'C#'], ['G', 'B', 'D'], ['D', 'F#', 'A'], ['G', 'B', 'D'], ['A', 'C#', 'E']];

// the violin line, two bars (eight beats) at a time: [notes, length each]
const LINE_A = ['F#5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'B4', 'C#5'].map(N);
const LINE_B = ['D5', 'C#5', 'B4', 'A4', 'G4', 'F#4', 'G4', 'E4'].map(N);
const V = {
  A: [LINE_A, Q],
  B: [LINE_B, Q],
  C: [['D4', 'F#4', 'A4', 'G4', 'F#4', 'D4', 'F#4', 'E4', 'D4', 'B3', 'D4', 'A4', 'G4', 'B4', 'A4', 'G4'].map(N), E],
  turns: [LINE_A.flatMap(t => [t, step(t, 1), t, step(t, -1)]), S],               // a turn around each note
  runs: [LINE_A.flatMap(t => [step(t, 3), step(t, 2), step(t, 1), t]), S],        // a run down onto each note
  arps: [CHORDS.flatMap(([r]) => {                                                // root and third of each chord
    const root = N(r + '4') > N('B4') ? N(r + '3') : N(r + '4');
    return [root, step(root, 2)];
  }), E],
  lilt: [LINE_B.flatMap(t => [t, step(t, 1)]), E],                                // each note with the one above
};
const PLAN = ['A', 'B', 'C', 'turns', 'runs', 'arps', 'lilt', 'C', 'B', 'A'];
const CYCLE = 8 * Q;

function vlq(v) { const s = [v & 0x7f]; while ((v >>= 7)) s.push((v & 0x7f) | 0x80); return s.reverse(); }
function track(events) {                                       // events: [tick, ...bytes]
  events.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0));   // note-offs (0x80) before note-ons
  const out = []; let last = 0;
  for (const [t, ...bytes] of events) { out.push(...vlq(t - last), ...bytes); last = t; }
  out.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, out.length >>> 24, (out.length >> 16) & 255, (out.length >> 8) & 255, out.length & 255, ...out];
}
const text = (t, type, s) => { const b = [...Buffer.from(s)]; return [t, 0xff, type, ...vlq(b.length), ...b]; };
const note = (ev, ch, t, n, len, vel) => { ev.push([t, 0x90 | ch, n, vel], [t + Math.round(len * 0.92), 0x80 | ch, n, 0]); };

const cycles = 1 + PLAN.length + 2;          // the ground alone, then the line, then the last violin finishing
const endTick = cycles * CYCLE;

// conductor: name, meter, tempo, and the slowing in the last two bars
const cond = [text(0, 0x03, 'Canon in D'), text(0, 0x02, 'Pachelbel, public domain; sequenced for meowpiano'),
  [0, 0xff, 0x58, 4, 4, 2, 24, 8]];
const tempo = (t, bpm) => { const us = Math.round(60e6 / bpm); cond.push([t, 0xff, 0x51, 3, us >> 16, (us >> 8) & 255, us & 255]); };
tempo(0, 60);
for (let b = 0; b < 8; b++) tempo(endTick - CYCLE + b * Q, 60 - b * 2.5);

// bass: the ground over and over, then the last D held
const bass = [text(0, 0x03, 'Basso continuo'), [0, 0xc3, 42]];
for (let c = 0; c < cycles; c++) GROUND.forEach((n, i) => note(bass, 3, c * CYCLE + i * Q, n, Q, 80 + (i % 2 ? 0 : 8)));
note(bass, 3, endTick, N('D2'), 4 * Q / 0.92, 84);

// violins: the same line, each entering two bars after the one before
const violins = ['Violin I', 'Violin II', 'Violin III'].map((name, v) => {
  const ev = [text(0, 0x03, name), [0, 0xc0 | v, 40]];
  PLAN.forEach((key, k) => {
    const [notes, len] = V[key], start = (1 + v + k) * CYCLE;
    notes.forEach((n, i) => note(ev, v, start + i * len, n, len, 72 + ((i * 7 + v * 3) % 20)));
  });
  return ev;
});
// the last chord, held, with a little vibrato on Violin I's top D
const last = { 0: 'D5', 1: 'A4', 2: 'F#4' };
violins.forEach((ev, v) => note(ev, v, endTick, N(last[v]), 4 * Q / 0.92, 70));
for (let k = 0; k <= 24; k++) {
  const b = 8192 + Math.round(Math.sin(k / 24 * Math.PI * 10) * 300 * Math.min(1, k / 6));   // ±0.07 semitone
  violins[0].push([endTick + Q + k * (2 * Q / 24), 0xe0, b & 0x7f, b >> 7]);
}
violins[0].push([endTick + 3 * Q + S, 0xe0, 0, 0x40]);

const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 5, PPQ >> 8, PPQ & 255];
const file = Uint8Array.from([...head, ...track(cond), ...violins.flatMap(track), ...track(bass)]);
writeFileSync(new URL('../songs/canon-in-d.mid', import.meta.url), file);
console.log('songs/canon-in-d.mid', file.length, 'bytes');
