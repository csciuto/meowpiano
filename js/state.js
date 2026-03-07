/**
 * Single mutable state object shared across all modules.
 * Keeping it in one place makes it easy to snapshot, reset, and test.
 */
export const state = {
  // Audio sample
  sampleDur: 0.80,

  // Loop / envelope settings
  loopStart: 0.10,
  loopEnd:   0.60,
  decay:     20.0,

  // Sustain pedal
  sustain:       false,
  sustainLocked: false,

  // Pitch wheel
  pitchBend: 0,
  pitchMax:  2,

  // Octave transposition
  octaveShift: 0,

  // Active voices: note-name → {src, gain}
  liveVoices: {},
  pbVoices:   {},

  // Recorder
  isRec:     false,
  isPlay:    false,
  loop:      false,
  recStart:  0,
  recEvents: [],
  timers:    [],
};
