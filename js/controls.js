import { state } from './state.js';
import { NOTES, OCTAVE_LABELS, applyOctaveShift } from './notes.js';
import {
  applySustainToLiveVoices,
  applyLoopToLiveVoices,
  applyPitchToLiveVoices,
  pbSustainOn, pbSustainOff,
  pbNoteOn, pbNoteOff,
  stopAllPbVoices,
  boot,
  noteBufs,
} from './audio.js';
import { noteMap } from './notes.js';
import { playable, songText, readSong, fitSong, fmtTime, LINK_CAP } from './song.js';

// ── Loop waveform canvas ──────────────────────────────────────────────

export function drawLoopWaveform() {
  const canvas = document.getElementById('loopCanvas');
  if (!canvas) return;
  const ref = noteBufs['A4'];
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!ref) return;

  const data = ref.getChannelData(0);
  const totalFrames = data.length;
  const dur = ref.duration;

  // Zero-crossing guide
  ctx.strokeStyle = 'rgba(100, 80, 150, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

  // Waveform: min/max peaks per pixel column
  ctx.fillStyle = 'rgba(150, 110, 255, 0.55)';
  for (let x = 0; x < W; x++) {
    const sf = Math.floor((x / W) * totalFrames);
    const ef = Math.floor(((x + 1) / W) * totalFrames);
    let mn = 0, mx = 0;
    for (let i = sf; i < ef; i++) {
      if (data[i] < mn) mn = data[i];
      if (data[i] > mx) mx = data[i];
    }
    const yMin = Math.round((1 - mx) / 2 * H);
    const yMax = Math.round((1 - mn) / 2 * H);
    ctx.fillRect(x, yMin, 1, Math.max(1, yMax - yMin));
  }

  const inX  = (state.loopStart / dur) * W;
  const outX = (state.loopEnd   / dur) * W;

  // Loop region tint
  ctx.fillStyle = 'rgba(255,45,120,0.08)';
  ctx.fillRect(inX, 0, outX - inX, H);

  // Crossfade zone near OUT
  const crossW = (state.crossfade / dur) * W;
  ctx.fillStyle = 'rgba(170,136,255,0.18)';
  ctx.fillRect(outX - crossW, 0, crossW, H);

  // IN marker (pink)
  ctx.strokeStyle = '#FF2D78';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(inX, 0); ctx.lineTo(inX, H); ctx.stroke();

  // OUT marker (purple)
  ctx.strokeStyle = '#AA88FF';
  ctx.beginPath(); ctx.moveTo(outX, 0); ctx.lineTo(outX, H); ctx.stroke();
}

// ── Sustain pedal ─────────────────────────────────────────────────────

export function setSustain(on) {
  state.sustain = on;
  if (state.isRec) {
    state.recEvents.push({ type: on ? 'sustain_on' : 'sustain_off', t: performance.now() - state.recStart });
  }
  applySustainToLiveVoices(on);
}

export function updateSustainUI() {
  const btn = document.getElementById('btnSustain');
  btn.style.color      = state.sustain ? '#080B14' : '#44DDFF';
  btn.style.background = state.sustain ? '#44DDFF' : 'transparent';
}

export function initSustain() {
  const btn = document.getElementById('btnSustain');
  const release = () => { setSustain(false); updateSustainUI(); };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    setSustain(true);
    updateSustainUI();
  });
  btn.addEventListener('pointerup',     release);
  btn.addEventListener('pointercancel', release);
}

// ── Octave buttons ────────────────────────────────────────────────────

export function setOctave(shift) {
  state.octaveShift = shift;
  if (state.isRec) {
    state.recEvents.push({ type: 'octave', shift, t: performance.now() - state.recStart });
  }
  applyOctaveShift(shift);
  document.querySelector('.octave-bar').textContent = OCTAVE_LABELS[String(shift)] || '';
  [-2, -1, 0, 1, 2].forEach(v => {
    const btn = document.getElementById('oct' + v);
    if (!btn) return;
    btn.style.background = (v === shift) ? '#AA88FF' : 'transparent';
    btn.style.color      = (v === shift) ? '#080B14' : '#AA88FF';
  });
}

export function initOctaveButtons() {
  [-2, -1, 0, 1, 2].forEach(v => {
    const btn = document.getElementById('oct' + v);
    if (btn) btn.addEventListener('click', () => setOctave(v));
  });
}

// ── Settings panel ────────────────────────────────────────────────────

let _renderHandles = () => {};

export function initSettings() {
  // Toggle panel
  document.getElementById('btnLoopEdit').addEventListener('click', function () {
    const p = document.getElementById('loopPanel');
    const open = p.style.display !== 'none';
    p.style.display = open ? 'none' : 'flex';
    this.innerHTML = open ? '&#x25B6;' : '&#x25C4;';
    if (!open) renderHandles(); // re-render after reveal so offsetWidth is valid
  });

  // Dual-handle loop-point slider
  const track  = document.getElementById('sliderTrack');
  const fill   = document.getElementById('sliderFill');
  const hS     = document.getElementById('handleStart');
  const hE     = document.getElementById('handleEnd');
  const lblS   = document.getElementById('lblStart');
  const lblE   = document.getElementById('lblEnd');
  const MIN_GAP = 0.02;
  let dragging = null;

  function posToVal(px) {
    return Math.max(0, Math.min(state.sampleDur, (px / track.offsetWidth) * state.sampleDur));
  }
  function valToPos(v) {
    return (v / state.sampleDur) * track.offsetWidth;
  }
  function renderHandles() {
    hS.style.left = valToPos(state.loopStart) + 'px';
    hE.style.left = valToPos(state.loopEnd)   + 'px';
    fill.style.left  = valToPos(state.loopStart) + 'px';
    fill.style.width = (valToPos(state.loopEnd) - valToPos(state.loopStart)) + 'px';
    lblS.textContent = state.loopStart.toFixed(2);
    lblE.textContent = state.loopEnd.toFixed(2);
    drawLoopWaveform();
  }

  function onMove(e) {
    if (!dragging) return;
    const rect = track.getBoundingClientRect();
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const v = Math.round(posToVal(px) * 100) / 100;
    if (dragging === 'start') {
      state.loopStart = Math.max(0, Math.min(v, state.loopEnd - MIN_GAP));
    } else {
      state.loopEnd = Math.min(state.sampleDur, Math.max(v, state.loopStart + MIN_GAP));
    }
    renderHandles();
    applyLoopToLiveVoices();
  }

  hS.addEventListener('pointerdown', e => { dragging = 'start'; hS.style.cursor = 'grabbing'; e.preventDefault(); });
  hE.addEventListener('pointerdown', e => { dragging = 'end';   hE.style.cursor = 'grabbing'; e.preventDefault(); });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', () => { dragging = null; hS.style.cursor = 'grab'; hE.style.cursor = 'grab'; });

  // Crossfade slider
  document.getElementById('crossfadeSlider').addEventListener('input', function () {
    state.crossfade = parseFloat(this.value);
    document.getElementById('crossfadeLbl').textContent = Math.round(state.crossfade * 1000) + 'ms';
    drawLoopWaveform();
  });

  // Grain size slider
  document.getElementById('grainSlider').addEventListener('input', function() {
    state.grainDur = parseFloat(this.value);
    document.getElementById('grainLbl').textContent = Math.round(state.grainDur * 1000) + 'ms';
  });

  // Scatter (overlap) slider
  document.getElementById('scatterSlider').addEventListener('input', function() {
    state.grainOverlap = parseFloat(this.value);
    document.getElementById('scatterLbl').textContent = Math.round(state.grainOverlap * 100) + '%';
  });

  // Copy button
  document.getElementById('btnCopyLoop').addEventListener('click', () => {
    const txt = `loopStart: ${state.loopStart.toFixed(3)}, loopEnd: ${state.loopEnd.toFixed(3)}, grainDur: ${state.grainDur}, grainOverlap: ${state.grainOverlap}`;
    navigator.clipboard.writeText(txt).catch(() => {});
  });

  _renderHandles = renderHandles;
  renderHandles();
}

// ── Pitch wheel ───────────────────────────────────────────────────────
// Drag the wheel, or hold ↑ / ↓; let go and it springs back to 0. A recording keeps the moves and one
// 'wheel_release' (playback rebuilds the spring-back, see song.js), not every step of the spring.

let renderWheel = () => {};
let springTimer = null, keyTimer = null, keyDir = 0, held = false;
const SPRING_STEPS = 20, STEP_MS = 16, KEY_RAMP_MS = 240;   // ↑ / ↓ reach the end of the wheel in 240 ms

function recordBend() {
  if (state.isRec) state.recEvents.push({ type: 'pitch', bend: state.pitchBend, t: performance.now() - state.recStart });
}
function grabWheel() {
  if (springTimer) { clearInterval(springTimer); springTimer = null; }
  held = true;
}
function setBend(v) {
  v = Math.round(Math.max(-state.pitchMax, Math.min(state.pitchMax, v)) * 100) / 100;
  if (v === state.pitchBend) return;
  state.pitchBend = v;
  renderWheel();
  recordBend();
}
function letGoWheel() {
  if (!held) return;
  held = false;
  if (state.isRec) state.recEvents.push({ type: 'wheel_release', t: performance.now() - state.recStart });
  const from = state.pitchBend;
  let step = 0;
  springTimer = setInterval(() => {
    step++;
    state.pitchBend = step >= SPRING_STEPS ? 0 : from * (1 - step / SPRING_STEPS);
    if (step >= SPRING_STEPS) { clearInterval(springTimer); springTimer = null; }
    renderWheel();
  }, STEP_MS);
}

/** ↑ (dir 1) or ↓ (dir -1) pressed: bend that way until the key comes up. */
export function keyBendStart(dir) {
  if (keyDir === dir) return;
  keyDir = dir;
  grabWheel();
  clearInterval(keyTimer);
  const perStep = state.pitchMax * STEP_MS / KEY_RAMP_MS;
  keyTimer = setInterval(() => setBend(state.pitchBend + dir * perStep), STEP_MS);
}
export function keyBendStop(dir) {
  if (keyDir !== dir) return;
  keyDir = 0;
  clearInterval(keyTimer); keyTimer = null;
  letGoWheel();
}

export function initPitchWheel() {
  const track  = document.getElementById('pitchTrack');
  const thumb  = document.getElementById('pitchThumb');
  const valLbl = document.getElementById('pitchVal');
  const TRACK_H = 164, THUMB_H = 32;
  const travel  = TRACK_H - THUMB_H;
  let dragging = false, startY = 0, startBend = 0;

  renderWheel = () => {
    thumb.style.top = (travel / 2) * (1 - state.pitchBend / state.pitchMax) + 'px';
    valLbl.textContent = (state.pitchBend >= 0 ? '+' : '') + state.pitchBend.toFixed(2);
    applyPitchToLiveVoices(noteMap);
  };

  track.addEventListener('pointerdown', e => {
    grabWheel();
    dragging = true; startY = e.clientY; startBend = state.pitchBend;
    thumb.classList.add('active');
    track.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  track.addEventListener('pointermove', e => {
    if (!dragging) return;
    setBend(startBend - ((e.clientY - startY) / (travel / 2)) * state.pitchMax);
  });
  function release() {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove('active');
    letGoWheel();
  }
  track.addEventListener('pointerup',     release);
  track.addEventListener('pointercancel', release);

  renderWheel();
}

// ── Transport (record / play / stop / clear / share) ─────────────────
// A take is kept as it will be shared: when recording stops it goes through the link format (song.js), so
// what plays here is what a link plays. Recording stops itself before the link would pass LINK_CAP.

const settingsNow = () => ({ loopStart: state.loopStart, loopEnd: state.loopEnd, crossfade: state.crossfade, grainDur: state.grainDur, grainOverlap: state.grainOverlap });
const linkBase = () => location.origin + location.pathname + '#song=';
const linkRoom = () => LINK_CAP - linkBase().length;
const FULL_MARGIN = 250;   // characters: stop a little early, a second of dense playing fits in this

let _status = () => {}, _setReady = () => {};

/** Open the song in the address, if there is one. Returns true if it loaded. */
export async function loadSongFromLink() {
  const m = location.hash.match(/^#song=([\w-]+)$/);
  if (!m) return false;
  try {
    const song = await readSong(m[1]);
    applySettings(song.settings);
    state.recEvents = song.events; state.recEnd = song.end; state.songText = m[1];
    _setReady(true);
    _status('song loaded · ' + fmtTime(song.end) + ' · press PLAY');
    return true;
  } catch (e) {
    _status("that song link is damaged");
    return false;
  }
}
function applySettings(st) {
  state.loopStart = st.loopStart; state.loopEnd = st.loopEnd;
  _renderHandles();
  for (const [id, v] of [['crossfadeSlider', st.crossfade], ['grainSlider', st.grainDur], ['scatterSlider', st.grainOverlap]]) {
    const el = document.getElementById(id);
    el.value = v; el.dispatchEvent(new Event('input'));
  }
}

export function initTransport(onRefresh, onStatus) {
  const btnRecord = document.getElementById('btnRecord');
  const btnPlay   = document.getElementById('btnPlay');
  const btnLoop   = document.getElementById('btnLoop');
  const btnStop   = document.getElementById('btnStop');
  const btnClear  = document.getElementById('btnClear');
  const btnShare  = document.getElementById('btnShare');
  _status = onStatus;
  _setReady = on => { btnPlay.disabled = btnLoop.disabled = btnShare.disabled = !on; };
  let watch = null, recSettings = null;

  function startPb() {
    if (!state.recEvents.length) return;
    state.isPlay = true;
    btnPlay.classList.add('active');
    onStatus('PLAYING...', 'playing');
    const evs = playable(state.recEvents);
    const maxT = Math.max(state.recEnd || 0, evs.reduce((m, e) => Math.max(m, e.t), 0));
    evs.forEach(ev => {
      state.timers.push(setTimeout(() => {
        if (ev.type === 'sustain_on')   { pbSustainOn();  return; }
        if (ev.type === 'sustain_off')  { pbSustainOff(); return; }
        if (ev.type === 'pitch') {
          state.pitchBend = ev.bend;
          applyPitchToLiveVoices(noteMap);
          return;
        }
        const n = noteMap[ev.note];
        if (!n) return;
        if (ev.type === 'on')  pbNoteOn(n, ev.freq, true, ev.ls, ev.le, ev.dec, onRefresh);
        if (ev.type === 'off') pbNoteOff(n);
        onRefresh();
      }, ev.t));
    });
    state.timers.push(setTimeout(() => {
      state.isPlay = false;
      btnPlay.classList.remove('active');
      stopAllPbVoices();
      state.pitchBend = 0;
      if (state.loop) { state.timers = []; startPb(); } else onStatus('done');
    }, maxT + 800));
  }

  function stopPb() {
    state.timers.forEach(clearTimeout);
    state.timers = [];
    state.isPlay = false;
    btnPlay.classList.remove('active');
    stopAllPbVoices();
    onRefresh();
  }

  function startRec() {
    state.recEvents = [];
    state.songText = '';
    state.isRec = true;
    state.recStart = performance.now();
    recSettings = settingsNow();
    state.loop = false;
    btnLoop.classList.remove('active');
    btnRecord.classList.add('active');
    btnRecord.innerHTML = '&#x25CF; REC';
    _setReady(false);
    onStatus('RECORDING 0:00', 'recording');
    boot();
    // the link fills as you play: show how full, and stop before it's too long
    watch = setInterval(async () => {
      if (!state.isRec) return;
      const t = performance.now() - state.recStart;
      const len = (await songText(state.recEvents, t, recSettings)).length;
      if (!state.isRec) return;
      if (len > linkRoom() - FULL_MARGIN) { finishRec('link full: recorded '); return; }
      onStatus('RECORDING ' + fmtTime(t) + ' · LINK ' + Math.round(100 * len / linkRoom()) + '%', 'recording');
    }, 1000);
  }

  // stop recording and keep the take as its link holds it (cut to fit, if it ran over)
  async function finishRec(msg = 'recorded ') {
    if (!state.isRec) return;
    state.isRec = false;
    clearInterval(watch);
    btnRecord.classList.remove('active');
    btnRecord.innerHTML = '&#x23FA; REC';
    const end = performance.now() - state.recStart, raw = state.recEvents;
    if (!raw.length) { onStatus('nothing recorded'); return; }
    const fit = await fitSong(raw, end, recSettings, linkRoom());
    const song = await readSong(fit.text);
    state.recEvents = song.events; state.recEnd = song.end; state.songText = fit.text;
    _setReady(song.events.length > 0);
    onStatus((fit.cut ? 'link full: recorded ' : msg) + fmtTime(song.end) + ' · LINK ' + Math.round(100 * fit.text.length / linkRoom()) + '%');
  }

  btnRecord.addEventListener('click', () => {
    if (state.isPlay) stopPb();
    if (state.isRec) finishRec(); else startRec();
  });

  btnPlay.addEventListener('click', () => {
    if (state.isRec) return;
    if (state.isPlay) { stopPb(); onStatus('stopped'); } else boot().then(startPb);
  });

  btnLoop.addEventListener('click', () => {
    if (btnLoop.disabled) return;
    state.loop = !state.loop;
    btnLoop.classList.toggle('active', state.loop);
    if (state.loop && !state.isPlay && state.recEvents.length) boot().then(startPb);
  });

  btnStop.addEventListener('click', () => {
    if (state.isRec) finishRec();
    else onStatus('stopped');
    stopPb();
    state.loop = false;
    btnLoop.classList.remove('active');
  });

  btnClear.addEventListener('click', () => {
    if (state.isPlay || state.isRec) return;
    state.recEvents = [];
    state.songText = '';
    _setReady(false);
    state.loop = false;
    btnLoop.classList.remove('active');
    if (location.hash) history.replaceState(null, '', location.pathname);
    onStatus('cleared');
  });

  btnShare.addEventListener('click', async () => {
    if (!state.songText) return;
    const url = linkBase() + state.songText;
    history.replaceState(null, '', url);
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch (_) {}
    onStatus((copied ? 'link copied' : 'link in the address bar') + ' · ' + url.length.toLocaleString('en-US') + ' chars');
  });
}
