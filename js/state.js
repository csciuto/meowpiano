/**
 * Single mutable state object shared across all modules.
 * Keeping it in one place makes it easy to snapshot, reset, and test.
 */
export const state = {
  // Audio sample
  sampleDur: 0.80,

  // Loop / envelope settings
  loopStart: 0.26,
  loopEnd:   0.46,
  crossfade: 0.020,

  // Granular sustain
  grainDur:     0.10,   // seconds per grain
  grainOverlap: 0.5,    // fraction of grainDur before next grain starts

  // Sustain pedal
  sustain: false,
  pbSustain: false,  // pedal state during recorder playback

  // Tuning: what A4 is, in Hz; every note moves with it
  tuning: 440,

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
  recEnd:    0,      // ms: when the take stopped
  songText:  '',     // the take as link text (after #song=)
  timers:    [],
};
