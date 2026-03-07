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
