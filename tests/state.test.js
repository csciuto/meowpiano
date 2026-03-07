import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../js/state.js';

describe('state defaults', () => {
  it('starts with sustain off', () => {
    expect(state.sustain).toBe(false);
    expect(state.sustainLocked).toBe(false);
  });

  it('starts with zero pitch bend', () => {
    expect(state.pitchBend).toBe(0);
    expect(state.pitchMax).toBe(2);
  });

  it('starts with sensible loop points within the sample', () => {
    expect(state.loopStart).toBeGreaterThanOrEqual(0);
    expect(state.loopEnd).toBeGreaterThan(state.loopStart);
    expect(state.loopEnd).toBeLessThanOrEqual(state.sampleDur);
  });

  it('starts with no active recording', () => {
    expect(state.isRec).toBe(false);
    expect(state.isPlay).toBe(false);
    expect(state.recEvents).toHaveLength(0);
    expect(state.timers).toHaveLength(0);
  });

  it('starts with empty voice maps', () => {
    expect(Object.keys(state.liveVoices)).toHaveLength(0);
    expect(Object.keys(state.pbVoices)).toHaveLength(0);
  });
});

describe('state mutations', () => {
  beforeEach(() => {
    // Reset mutable fields
    state.sustain       = false;
    state.sustainLocked = false;
    state.pitchBend     = 0;
    state.octaveShift   = 0;
    state.isRec         = false;
    state.isPlay        = false;
    state.loop          = false;
    state.recEvents     = [];
    state.timers        = [];
    state.liveVoices    = {};
    state.pbVoices      = {};
  });

  it('can toggle sustain', () => {
    state.sustain = true;
    expect(state.sustain).toBe(true);
    state.sustain = false;
    expect(state.sustain).toBe(false);
  });

  it('can accumulate rec events', () => {
    state.recEvents.push({ type: 'on', note: 'A4', t: 0 });
    state.recEvents.push({ type: 'off', note: 'A4', t: 200 });
    expect(state.recEvents).toHaveLength(2);
    expect(state.recEvents[0].note).toBe('A4');
  });

  it('pitchBend clamps are enforced by caller convention', () => {
    // state itself doesn't enforce bounds — the pitch wheel does.
    // Just verify we can write arbitrary values.
    state.pitchBend = 1.5;
    expect(state.pitchBend).toBe(1.5);
  });
});
