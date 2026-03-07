import { SAMPLE_ROOT } from './notes.js';
import { state } from './state.js';

export let actx       = null;
export let meowBuf    = null;
export let analyser   = null;
export let masterGain = null;

export function boot() {
  if (actx) return Promise.resolve();
  actx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = actx.createGain();
  masterGain.gain.value = 0.85;
  analyser = actx.createAnalyser();
  analyser.fftSize = 512;
  masterGain.connect(analyser);
  analyser.connect(actx.destination);

  return fetch('sounds/meow.ogg')
    .then(r => r.arrayBuffer())
    .then(ab => actx.decodeAudioData(ab))
    .then(buf => {
      meowBuf = buf;
      state.sampleDur = buf.duration;
    });
}

export function createVoice(freq, useSustain, ls, le, dec) {
  const src = actx.createBufferSource();
  src.buffer = meowBuf;
  src.playbackRate.value = (freq / SAMPLE_ROOT) * Math.pow(2, state.pitchBend / 12);
  src.loop = useSustain;
  src.loopStart = ls;
  src.loopEnd   = le;
  const gain = actx.createGain();
  const t0 = actx.currentTime;
  if (useSustain) {
    gain.gain.setValueAtTime(1.0, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dec);
  } else {
    gain.gain.setValueAtTime(1.0, t0);
  }
  src.connect(gain);
  gain.connect(masterGain);
  src.start();
  return { src, gain };
}

// ── Live voices (keyboard / pointer interaction) ──────────────────────

export function noteOn(n, onEnd) {
  if (!meowBuf || !actx) return;
  if (actx.state === 'suspended') actx.resume();
  if (state.liveVoices[n.note]) {
    try { state.liveVoices[n.note].src.stop(); } catch (_) {}
    delete state.liveVoices[n.note];
  }
  const v = createVoice(n.freq, state.sustain, state.loopStart, state.loopEnd, state.decay);
  state.liveVoices[n.note] = v;
  v.src.onended = () => {
    if (state.liveVoices[n.note]?.src === v.src) {
      delete state.liveVoices[n.note];
      if (n.el) n.el.classList.remove('pressed');
      if (onEnd) onEnd();
    }
  };
  if (n.el) n.el.classList.add('pressed');
}

export function noteOff(n) {
  const v = state.liveVoices[n.note];
  if (v && state.sustain) v.src.loop = false;
  if (n.el) n.el.classList.remove('pressed');
}

export function applySustainToLiveVoices(on) {
  Object.values(state.liveVoices).forEach(v => {
    if (!v) return;
    v.src.loop = on;
    if (on) { v.src.loopStart = state.loopStart; v.src.loopEnd = state.loopEnd; }
  });
}

export function applyLoopToLiveVoices() {
  Object.values(state.liveVoices).forEach(v => {
    if (v?.src.loop) { v.src.loopStart = state.loopStart; v.src.loopEnd = state.loopEnd; }
  });
}

export function applyPitchToLiveVoices(noteMap) {
  const mult = Math.pow(2, state.pitchBend / 12);
  Object.entries(state.liveVoices).forEach(([noteName, v]) => {
    const n = noteMap[noteName];
    if (n && v) v.src.playbackRate.value = (n.freq / SAMPLE_ROOT) * mult;
  });
}

// ── Playback voices (recorder playback) ──────────────────────────────

export function pbNoteOn(n, freq, useSustain, ls, le, dec, onEnd) {
  if (!meowBuf || !actx) return;
  if (state.pbVoices[n.note]) {
    try { state.pbVoices[n.note].src.stop(); } catch (_) {}
    delete state.pbVoices[n.note];
  }
  const v = createVoice(freq, useSustain, ls, le, dec);
  state.pbVoices[n.note] = v;
  v.src.onended = () => {
    if (state.pbVoices[n.note]?.src === v.src) {
      delete state.pbVoices[n.note];
      if (onEnd) onEnd();
    }
  };
}

export function pbNoteOff(n, wasSustained) {
  const v = state.pbVoices[n.note];
  if (v && wasSustained) v.src.loop = false;
}

export function pbSustainOn() {
  Object.values(state.pbVoices).forEach(v => {
    if (v) { v.src.loop = true; v.src.loopStart = state.loopStart; v.src.loopEnd = state.loopEnd; }
  });
}

export function pbSustainOff() {
  Object.values(state.pbVoices).forEach(v => { if (v) v.src.loop = false; });
}

export function stopAllPbVoices() {
  Object.values(state.pbVoices).forEach(v => { try { v.src.stop(); } catch (_) {} });
  state.pbVoices = {};
}
