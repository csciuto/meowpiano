// A small type-1 MIDI file built by hand: a tempo track, a named lead (running status, note-on velocity 0 as
// note-off, a pitch bend, the pedal), a bass with a program change and no name, and drums on channel 10.
const vlq = v => { const s = [v & 0x7f]; while ((v >>= 7)) s.push((v & 0x7f) | 0x80); return s.reverse(); };
const chunk = (id, body) => [...id].map(c => c.charCodeAt(0)).concat([body.length >>> 24, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255], body);
const text = (type, s) => [0xff, type, ...vlq(s.length), ...[...s].map(c => c.charCodeAt(0))];
const END = [0, 0xff, 0x2f, 0];

export function bandFile() {
  // 480 ticks a quarter. 120 bpm (500 ms a quarter) for the first bar, then 60 bpm (1000 ms a quarter).
  const tempo = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, ...vlq(1920), 0xff, 0x51, 3, 0x0f, 0x42, 0x40, ...END];
  const lead = [
    0, ...text(0x03, 'Lead Guitar'),
    0, 0x90, 60, 100,               // C4 at 0 ms
    ...vlq(480), 64, 100,           // running status: E4 at 500 ms
    0, 60, 0,                       // velocity 0: C4 off at 500 ms
    0, 0xb0, 64, 127,               // pedal down
    ...vlq(480), 0x80, 64, 0,       // E4 off at 1000 ms
    0, 0xe0, 0, 0x60,               // bend +1 semitone at 1000 ms
    ...vlq(960), 0x90, 72, 90,      // C5 at 2000 ms (bar two: 480 ticks = 1000 ms)
    ...vlq(480), 0x80, 72, 0,       // off at 3000 ms
    0, 0xb0, 64, 0,                 // pedal up
    ...END,
  ];
  const bass = [0, 0xc1, 33, 0, 0x91, 36, 100, ...vlq(1920), 0x81, 36, 0, 0, 0x91, 24, 100, ...vlq(480), 0x81, 24, 0, ...END];
  const drums = [0, 0x99, 38, 100, ...vlq(240), 0x89, 38, 0, ...END];
  return Uint8Array.from([
    ...chunk('MThd', [0, 1, 0, 4, 0x01, 0xe0]),
    ...chunk('MTrk', tempo), ...chunk('MTrk', lead), ...chunk('MTrk', bass), ...chunk('MTrk', drums),
  ]);
}
