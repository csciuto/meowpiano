import { SAMPLES, sampleFor } from './notes.js';
import { state } from './state.js';

export let actx       = null;
export let analyser   = null;
export let masterGain = null;
export const noteBufs = {};  // sample name (C2 … C8) → AudioBuffer
const bufFor = freq => noteBufs[sampleFor(freq).note];

// "C#4" → "Cs4"  (# is not safe in a URL path segment)
function toFilename(note) { return note.replace('#', 's'); }

/** Sound can start only after a click or key press on the page (browser rule; MIDI notes don't count). */
export const soundOn = () => !!actx && actx.state === 'running';
export function wake() { if (actx && actx.state === 'suspended') actx.resume(); }

export function boot() {
  if (actx) return Promise.resolve();
  actx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = actx.createGain();
  masterGain.gain.value = 0.85;
  analyser = actx.createAnalyser();
  analyser.fftSize = 512;
  masterGain.connect(analyser);
  analyser.connect(actx.destination);

  // the page's version goes on each sample's address, so a reload after an update never plays old sounds
  const version = document.querySelector('[title="Version"]')?.textContent || 'dev';
  return Promise.all(SAMPLES.map(n =>
    fetch(`sounds/notes/${toFilename(n.note)}.ogg?v=${version}`)
      .then(r => r.arrayBuffer())
      .then(ab => actx.decodeAudioData(ab))
      .then(buf => {
        noteBufs[n.note] = buf;
        if (!state.sampleDur) state.sampleDur = buf.duration;
      })
  ));
}

// ── Granular engine ───────────────────────────────────────────────────

// Grain envelope: a half sine. Grains start at random spots, so neighbors don't
// line up and their power (not amplitude) adds; at the default 50% overlap
// sin² + cos² = 1 keeps the level steady. A triangle dipped between grains and
// made a 20 Hz beat. √(2/3) matches the triangle's loudness.
export const GRAIN_CURVE = Float32Array.from({ length: 65 },
  (_, i) => Math.sin(Math.PI * i / 64) * Math.sqrt(2 / 3));

function startGranular(buf, rateRef, ls, le, out) {
  const gainNode = actx.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(out);

  let running = true;
  let nextTime = actx.currentTime;

  function tick() {
    if (!running) return;
    const horizon = actx.currentTime + 0.3;
    while (nextTime < horizon) {
      const grainDur = state.grainDur;
      const region   = le - ls - grainDur;
      const pos      = ls + (region > 0 ? Math.random() * region : 0);

      const g   = actx.createBufferSource();
      g.buffer             = buf;
      g.playbackRate.value = rateRef.value;  // read live so pitch bend takes effect

      const env = actx.createGain();
      env.gain.setValueCurveAtTime(GRAIN_CURVE, nextTime, grainDur);

      g.connect(env);
      env.connect(gainNode);
      g.start(nextTime, pos);
      g.stop(nextTime + grainDur);

      nextTime += grainDur * (1 - state.grainOverlap);
    }
    setTimeout(tick, 100);
  }

  tick();
  return { gainNode, rateRef, stop() { running = false; } };
}

// noteName  — e.g. "C#4"
// freq      — desired playback frequency
// useSustain — true: M→granular EO (holds until released); false: recording plays once
// vel       — how hard the key was hit, 0..1; leave out for full level
// pitch wheel and tuning together, as a playback-rate multiplier
const pitchMult = () => Math.pow(2, state.pitchBend / 12) * (state.tuning / 440);

/**
 * How loud a note is for how hard its key was hit (velocity 0..1). No velocity (the mouse, the computer
 * keyboard) is full level, as it always was; a MIDI key's usual 100 of 127 comes out about 3 dB under that.
 */
export const velocityGain = vel => (vel === undefined || vel === null ? 1 : Math.max(0, Math.min(1, vel)) ** 1.3);

export function createVoice(noteName, freq, useSustain, ls, le, vel) {
  // everything the voice plays (attack, held cloud, tail) goes through its own level
  const out = actx.createGain();
  out.gain.value = velocityGain(vel);
  out.connect(masterGain);
  const bend = pitchMult();
  const sample = sampleFor(freq), buf = noteBufs[sample.note], base = sample.freq;
  const rate = (freq / base) * bend;
  const t0   = actx.currentTime;
  const xEnd = t0 + ls + state.crossfade;

  const src = actx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.loop = false;

  if (useSustain) {
    // M: recording fades out at loopStart
    const attackGain = actx.createGain();
    attackGain.gain.setValueAtTime(1.0, t0);
    attackGain.gain.setValueAtTime(1.0, t0 + ls);
    attackGain.gain.linearRampToValueAtTime(0, xEnd);
    src.connect(attackGain);
    attackGain.connect(out);

    // EO: granular fades in as attack fades out; holds until released
    const rateRef  = { value: rate };
    const granular = startGranular(buf, rateRef, ls, le, out);
    granular.gainNode.gain.setValueAtTime(0, t0 + ls);
    granular.gainNode.gain.linearRampToValueAtTime(1.0, xEnd);

    src.start();
    return { src, granular, freq, noteName, buf, base, gain: granular.gainNode, attackGain, t0, ls, out };
  } else {
    // No sustain: recording plays once in full
    const gain = actx.createGain();
    gain.gain.value = 1.0;
    src.connect(gain);
    gain.connect(out);
    src.start();
    return { src, gain, granular: null, freq, buf, base, out };
  }
}

// ── Shared key-up / pedal-release helper ──────────────────────────────

// Release a voice the way a piano damper would. Released before the loop
// region starts, the meow just plays out once in full (a quick tap sounds
// like the whole recording). Released later, the granular hold fades and the
// "W" tail plays.
function releaseVoice(v, noteName, voices) {
  if (!v.granular) return;
  const t = actx.currentTime;
  if (t < v.t0 + v.ls) {
    v.granular.stop();
    if (voices[noteName] === v) delete voices[noteName];
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(0, t);
    v.attackGain.gain.cancelScheduledValues(t);
    v.attackGain.gain.setValueAtTime(1.0, t);
    if (v.onEnd) v.src.onended = v.onEnd;
    return;
  }
  cutVoice(v, noteName, voices);
}

function cutVoice(v, noteName, voices = state.liveVoices) {
  if (!v.granular) return;           // non-sustain voice, nothing to cut
  const t = actx.currentTime;
  v.granular.stop();                 // stop scheduling new grains

  // Remove immediately so a subsequent noteOff can't double-cut
  if (voices[noteName] === v) delete voices[noteName];

  // Anchor current computed gain value then ramp to silence
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.linearRampToValueAtTime(0, t + state.crossfade);

  // Play W tail from loopEnd
  const tail = actx.createBufferSource();
  tail.buffer = v.buf;
  tail.playbackRate.value = (v.freq / v.base) * pitchMult();
  tail.connect(v.out);
  tail.start(0, state.loopEnd);
  if (v.onEnd) tail.onended = v.onEnd;
}

// ── Live voices (keyboard / pointer interaction) ──────────────────────

export function noteOn(n, onEnd) {
  if (!actx || !bufFor(n.freq)) return;
  if (actx.state === 'suspended') actx.resume();
  if (state.liveVoices[n.note]) {
    const old = state.liveVoices[n.note];
    try { old.src.stop(); } catch (_) {}
    if (old.granular) old.granular.stop();
    delete state.liveVoices[n.note];
  }
  // Like a piano: the note holds while the key is down, and the pedal keeps it
  // going after the key comes up (including notes already held when the pedal
  // goes down). Cleanup happens in releaseVoice / cutVoice.
  const v = createVoice(n.note, n.freq, true, state.loopStart, state.loopEnd, n.vel);
  v.onEnd = onEnd;
  v.fixed = !!n.fixed;   // a MIDI keyboard note: its own pitch, not the app's octave
  state.liveVoices[n.note] = v;
}

export function noteOff(n) {
  const v = state.liveVoices[n.note];
  if (v) {
    if (state.sustain) v.keyUp = true;
    else releaseVoice(v, n.note, state.liveVoices);
  }
}

// Pedal up releases notes whose keys are already up; held keys keep sounding.
export function applySustainToLiveVoices(on) {
  if (on) return;
  Object.entries(state.liveVoices).forEach(([noteName, v]) => {
    if (v.keyUp) releaseVoice(v, noteName, state.liveVoices);
  });
}

export function applyLoopToLiveVoices() {
  // No-op: src never loops in this architecture.
}

export function applyPitchToLiveVoices(noteMap) {
  const bend = pitchMult();
  Object.entries(state.liveVoices).forEach(([noteName, v]) => {
    const n = noteMap[noteName];
    if (!n || !v) return;
    const rate = ((v.fixed ? v.freq : n.freq) / v.base) * bend;
    v.src.playbackRate.value = rate;
    if (v.granular) v.granular.rateRef.value = rate;
  });
  // Also update playback voices so recorded pitch events affect already-playing notes
  Object.entries(state.pbVoices).forEach(([noteName, v]) => {
    if (!v) return;
    const rate = (v.freq / v.base) * bend;
    v.src.playbackRate.value = rate;
    if (v.granular) v.granular.rateRef.value = rate;
  });
}

// ── Playback voices (recorder playback) ──────────────────────────────

export function pbNoteOn(n, freq, useSustain, ls, le, dec, onEnd, vel) {
  if (!actx || !bufFor(freq)) return;
  if (state.pbVoices[n.note]) {
    const old = state.pbVoices[n.note];
    try { old.src.stop(); } catch (_) {}
    if (old.granular) old.granular.stop();
    delete state.pbVoices[n.note];
  }
  const v = createVoice(n.note, freq, true, ls, le, vel);
  v.onEnd = onEnd;
  state.pbVoices[n.note] = v;
}

// Playback replays keys and pedal with the same rules as live play.
export function pbNoteOff(n) {
  const v = state.pbVoices[n.note];
  if (!v) return;
  if (state.pbSustain) v.keyUp = true;
  else releaseVoice(v, n.note, state.pbVoices);
}

export function pbSustainOn() { state.pbSustain = true; }
export function pbSustainOff() {
  state.pbSustain = false;
  Object.entries(state.pbVoices).forEach(([noteName, v]) => {
    if (v.keyUp) releaseVoice(v, noteName, state.pbVoices);
  });
}

export function stopAllPbVoices() {
  Object.values(state.pbVoices).forEach(v => {
    try { v.src.stop(); } catch (_) {}
    if (v.granular) v.granular.stop();
  });
  state.pbVoices = {};
  state.pbSustain = false;
}

// ── Loop preview ──────────────────────────────────────────────────────

let _previewVoice = null;

export function startLoopPreview() {
  stopLoopPreview();
  if (!noteBufs['A4'] || !actx) return;
  if (actx.state === 'suspended') actx.resume();
  _previewVoice = createVoice('A4', 440, true, state.loopStart, state.loopEnd);
}

export function stopLoopPreview() {
  if (_previewVoice) {
    try { _previewVoice.src.stop(); } catch (_) {}
    if (_previewVoice.granular) _previewVoice.granular.stop();
    _previewVoice = null;
  }
}

export function isLoopPreviewing() { return !!_previewVoice; }
