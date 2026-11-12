import { describe, it, expect, beforeEach } from 'vitest';
import { NOTES, BASE_FREQS, keyMap, noteMap, applyOctaveShift } from '../js/notes.js';

describe('NOTES', () => {
  it('has 25 notes (C4 through C6)', () => {
    expect(NOTES).toHaveLength(25);
    expect(NOTES[0].note).toBe('C4');
    expect(NOTES[NOTES.length - 1].note).toBe('C6');
  });

  it('has correct A4 frequency', () => {
    expect(noteMap['A4'].freq).toBe(440.00);
  });

  it('maps every key to a unique note', () => {
    const keys = NOTES.map(n => n.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(NOTES.length);
  });

  it('keyMap and noteMap cover all notes', () => {
    expect(Object.keys(keyMap)).toHaveLength(NOTES.length);
    expect(Object.keys(noteMap)).toHaveLength(NOTES.length);
  });
});

describe('BASE_FREQS', () => {
  it('is frozen at the canonical frequencies', () => {
    expect(BASE_FREQS['C4']).toBe(261.63);
    expect(BASE_FREQS['A4']).toBe(440.00);
    expect(BASE_FREQS['C6']).toBe(1046.5);
  });
});

describe('applyOctaveShift', () => {
  beforeEach(() => {
    // Reset to default (0-shift) before each test
    applyOctaveShift(0);
  });

  it('shift 0 leaves frequencies unchanged', () => {
    applyOctaveShift(0);
    NOTES.forEach(n => {
      expect(n.freq).toBeCloseTo(BASE_FREQS[n.note], 5);
    });
  });

  it('shift +1 doubles all frequencies', () => {
    applyOctaveShift(1);
    NOTES.forEach(n => {
      expect(n.freq).toBeCloseTo(BASE_FREQS[n.note] * 2, 3);
    });
  });

  it('shift -1 halves all frequencies', () => {
    applyOctaveShift(-1);
    NOTES.forEach(n => {
      expect(n.freq).toBeCloseTo(BASE_FREQS[n.note] / 2, 3);
    });
  });

  it('shift -2 quarters all frequencies', () => {
    applyOctaveShift(-2);
    NOTES.forEach(n => {
      expect(n.freq).toBeCloseTo(BASE_FREQS[n.note] / 4, 3);
    });
  });

  it('BASE_FREQS is never mutated by octave shifts', () => {
    applyOctaveShift(-2);
    expect(BASE_FREQS['A4']).toBe(440.00);
    applyOctaveShift(0);
  });
});

describe('range labels', () => {
  it('the line above the keys has the same shape in every range', async () => {
    const { OCTAVE_LABELS } = await import('../js/notes.js');
    expect(OCTAVE_LABELS['0']).toBe('C4 <------- C5 -------> C6');
    expect(OCTAVE_LABELS['-1']).toBe('C3 <------- C4 -------> C5');
    const shapes = new Set(Object.values(OCTAVE_LABELS).map(l => l.replace(/\d/g, 'n')));
    expect(shapes.size).toBe(1);
  });

  it('key names follow the range', async () => {
    const { shownNote } = await import('../js/notes.js');
    expect(shownNote('C4', 0)).toBe('C4');
    expect(shownNote('C#4', 2)).toBe('C#6');
    expect(shownNote('C6', -2)).toBe('C4');
  });
});

describe('one sample per semitone, so no range is sped up or slowed down', () => {
  it('every pitch the five ranges can play has its own file, at its own pitch', async () => {
    const { SAMPLES, sampleFor } = await import('../js/notes.js');
    const { existsSync } = await import('node:fs');
    expect(SAMPLES).toHaveLength(73);
    expect(SAMPLES[0].note).toBe('C2');
    expect(SAMPLES[72].note).toBe('C8');
    for (const s of SAMPLES) expect(existsSync(`sounds/notes/${s.note.replace('#', 's')}.ogg`), s.note).toBe(true);
    for (const shift of [-2, -1, 0, 1, 2]) {
      for (const n of NOTES) {
        const freq = BASE_FREQS[n.note] * 2 ** shift;
        const rate = freq / sampleFor(freq).freq;
        expect(Math.abs(rate - 1), `${n.note} ${shift}`).toBeLessThan(0.001);
      }
    }
    expect(sampleFor(440).note).toBe('A4');
    expect(sampleFor(20).note).toBe('C2');      // out of range: the nearest end
    expect(sampleFor(9000).note).toBe('C8');
  });
});
