import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../js/state.js';

describe('state defaults', () => {
  it('starts with sustain off', () => {
    expect(state.sustain).toBe(false);
    expect(state.sustainLocked).toBeUndefined();
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

  it('starts with crossfade and no decay', () => {
    expect(state.crossfade).toBe(0.020);
    expect(state.decay).toBeUndefined();
  });

  it('starts with granular sustain defaults', () => {
    expect(state.grainDur).toBe(0.10);
    expect(state.grainOverlap).toBe(0.5);
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
    state.sustain = false;
    state.pitchBend     = 0;
    state.octaveShift   = 0;
    state.isRec         = false;
    state.isPlay        = false;
    state.loop          = false;
    state.recEvents     = [];
    state.timers        = [];
    state.liveVoices    = {};
    state.pbVoices      = {};
    state.crossfade    = 0.020;
    state.grainDur     = 0.10;
    state.grainOverlap = 0.5;
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

  it('records pitch bend events with correct structure', () => {
    state.isRec = true;
    state.recStart = performance.now() - 500;
    const bend = 1.25;
    const t = performance.now() - state.recStart;
    state.recEvents.push({ type: 'pitch', bend, t });
    expect(state.recEvents).toHaveLength(1);
    const ev = state.recEvents[0];
    expect(ev.type).toBe('pitch');
    expect(ev.bend).toBe(1.25);
    expect(ev.t).toBeGreaterThanOrEqual(0);
  });

  it('can interleave note and pitch events for playback', () => {
    state.recEvents.push({ type: 'on',    note: 'A4', freq: 440, sus: false, ls: 0.26, le: 0.46, t: 0 });
    state.recEvents.push({ type: 'pitch', bend: 1.0,  t: 100 });
    state.recEvents.push({ type: 'pitch', bend: 0,    t: 300 });
    state.recEvents.push({ type: 'off',   note: 'A4', sus: false, t: 500 });
    expect(state.recEvents).toHaveLength(4);
    expect(state.recEvents.filter(e => e.type === 'pitch')).toHaveLength(2);
    expect(state.recEvents.find(e => e.type === 'pitch').bend).toBe(1.0);
  });

  it('pitchBend clamps are enforced by caller convention', () => {
    // state itself doesn't enforce bounds — the pitch wheel does.
    // Just verify we can write arbitrary values.
    state.pitchBend = 1.5;
    expect(state.pitchBend).toBe(1.5);
  });
});
