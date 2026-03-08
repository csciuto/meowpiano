import { NOTES, BASE_FREQS } from './notes.js';
import { state } from './state.js';

export let actx       = null;
export let analyser   = null;
export let masterGain = null;
export const noteBufs = {};  // note name → AudioBuffer

// "C#4" → "Cs4"  (# is not safe in a URL path segment)
function toFilename(note) { return note.replace('#', 's'); }

export function boot() {
  if (actx) return Promise.resolve();
  actx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = actx.createGain();
  masterGain.gain.value = 0.85;
  analyser = actx.createAnalyser();
  analyser.fftSize = 512;
  masterGain.connect(analyser);
  analyser.connect(actx.destination);

  return Promise.all(NOTES.map(n =>
    fetch(`sounds/notes/${toFilename(n.note)}.ogg`)
      .then(r => r.arrayBuffer())
      .then(ab => actx.decodeAudioData(ab))
      .then(buf => {
        noteBufs[n.note] = buf;
        if (!state.sampleDur) state.sampleDur = buf.duration;
      })
  ));
}

// ── Granular engine ───────────────────────────────────────────────────

function startGranular(buf, rateRef, ls, le) {
  const gainNode = actx.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(masterGain);

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
      env.gain.setValueAtTime(0,        nextTime);
      env.gain.linearRampToValueAtTime(1, nextTime + grainDur * 0.5);
      env.gain.linearRampToValueAtTime(0, nextTime + grainDur);

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
// useSustain — true: M→granular EO (holds until cutVoice); false: recording plays once
export function createVoice(noteName, freq, useSustain, ls, le) {
  const bend = Math.pow(2, state.pitchBend / 12);
  const rate = (freq / BASE_FREQS[noteName]) * bend;
  const t0   = actx.currentTime;
  const xEnd = t0 + ls + state.crossfade;

  const src = actx.createBufferSource();
  src.buffer = noteBufs[noteName];
  src.playbackRate.value = rate;
  src.loop = false;

  if (useSustain) {
    // M: recording fades out at loopStart
    const attackGain = actx.createGain();
    attackGain.gain.setValueAtTime(1.0, t0);
    attackGain.gain.setValueAtTime(1.0, t0 + ls);
    attackGain.gain.linearRampToValueAtTime(0, xEnd);
    src.connect(attackGain);
    attackGain.connect(masterGain);

    // EO: granular fades in as attack fades out; holds until cutVoice is called
    const rateRef  = { value: rate };
    const granular = startGranular(noteBufs[noteName], rateRef, ls, le);
    granular.gainNode.gain.setValueAtTime(0, t0 + ls);
    granular.gainNode.gain.linearRampToValueAtTime(1.0, xEnd);

    src.start();
    return { src, granular, freq, noteName, gain: granular.gainNode };
  } else {
    // No sustain: recording plays once in full
    const gain = actx.createGain();
    gain.gain.value = 1.0;
    src.connect(gain);
    gain.connect(masterGain);
    src.start();
    return { src, gain, granular: null };
  }
}

// ── Shared key-up / pedal-release helper ──────────────────────────────

function cutVoice(v, noteName) {
  if (!v.granular) return;           // non-sustain voice, nothing to cut
  const t = actx.currentTime;
  v.granular.stop();                 // stop scheduling new grains

  // Remove immediately so a subsequent noteOff can't double-cut
  if (state.liveVoices[noteName] === v) delete state.liveVoices[noteName];

  // Anchor current computed gain value then ramp to silence
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.linearRampToValueAtTime(0, t + state.crossfade);

  // Play W tail from loopEnd
  const tail = actx.createBufferSource();
  tail.buffer = noteBufs[noteName];
  tail.playbackRate.value = (v.freq / BASE_FREQS[v.noteName]) * Math.pow(2, state.pitchBend / 12);
  tail.connect(masterGain);
  tail.start(0, state.loopEnd);
  if (v.onEnd) tail.onended = v.onEnd;
}

// ── Live voices (keyboard / pointer interaction) ──────────────────────

export function noteOn(n, onEnd) {
  if (!noteBufs[n.note] || !actx) return;
  if (actx.state === 'suspended') actx.resume();
  if (state.liveVoices[n.note]) {
    const old = state.liveVoices[n.note];
    try { old.src.stop(); } catch (_) {}
    if (old.granular) old.granular.stop();
    delete state.liveVoices[n.note];
  }
  const v = createVoice(n.note, n.freq, state.sustain, state.loopStart, state.loopEnd);
  v.onEnd = onEnd;
  state.liveVoices[n.note] = v;
  if (n.el) n.el.classList.add('pressed');

  if (!v.granular) {
    // Non-sustain: cleanup when recording finishes
    v.src.onended = () => {
      if (state.liveVoices[n.note]?.src === v.src) {
        delete state.liveVoices[n.note];
        if (n.el) n.el.classList.remove('pressed');
        if (onEnd) onEnd();
      }
    };
  }
  // Granular voices: cleanup happens via cutVoice → tail.onended
}

export function noteOff(n) {
  const v = state.liveVoices[n.note];
  if (v && !state.sustain) cutVoice(v, n.note);
  if (n.el) n.el.classList.remove('pressed');
}

export function applySustainToLiveVoices(on) {
  if (on) return;
  Object.entries(state.liveVoices).forEach(([noteName, v]) => cutVoice(v, noteName));
}

export function applyLoopToLiveVoices() {
  // No-op: src never loops in this architecture.
}

export function applyPitchToLiveVoices(noteMap) {
  const bend = Math.pow(2, state.pitchBend / 12);
  Object.entries(state.liveVoices).forEach(([noteName, v]) => {
    const n = noteMap[noteName];
    if (!n || !v) return;
    const rate = (n.freq / BASE_FREQS[noteName]) * bend;
    v.src.playbackRate.value = rate;
    if (v.granular) v.granular.rateRef.value = rate;
  });
  // Also update playback voices so recorded pitch events affect already-playing notes
  Object.entries(state.pbVoices).forEach(([noteName, v]) => {
    if (!v) return;
    const rate = (v.freq / BASE_FREQS[noteName]) * bend;
    v.src.playbackRate.value = rate;
    if (v.granular) v.granular.rateRef.value = rate;
  });
}

// ── Playback voices (recorder playback) ──────────────────────────────

export function pbNoteOn(n, freq, useSustain, ls, le, dec, onEnd) {
  if (!noteBufs[n.note] || !actx) return;
  if (state.pbVoices[n.note]) {
    const old = state.pbVoices[n.note];
    try { old.src.stop(); } catch (_) {}
    if (old.granular) old.granular.stop();
    delete state.pbVoices[n.note];
  }
  const v = createVoice(n.note, freq, useSustain, ls, le);
  state.pbVoices[n.note] = v;
  if (!v.granular) {
    v.src.onended = () => {
      if (state.pbVoices[n.note]?.src === v.src) {
        delete state.pbVoices[n.note];
        if (onEnd) onEnd();
      }
    };
  }
  // Granular pb voices run until stopAllPbVoices
}

export function pbNoteOff(n, wasSustained) {
  // No-op: cutVoice / stopAllPbVoices handles granular voices.
}

export function pbSustainOn() {}
export function pbSustainOff() {}

export function stopAllPbVoices() {
  Object.values(state.pbVoices).forEach(v => {
    try { v.src.stop(); } catch (_) {}
    if (v.granular) v.granular.stop();
  });
  state.pbVoices = {};
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
