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

export function initPitchWheel() {
  const track  = document.getElementById('pitchTrack');
  const thumb  = document.getElementById('pitchThumb');
  const valLbl = document.getElementById('pitchVal');
  const TRACK_H = 164, THUMB_H = 32;
  const travel  = TRACK_H - THUMB_H;
  let dragging = false, startY = 0, startBend = 0;

  function bendToY(bend) {
    return (travel / 2) * (1 - bend / state.pitchMax);
  }
  let _lastRecordedBend = null;
  function renderWheel() {
    thumb.style.top = bendToY(state.pitchBend) + 'px';
    valLbl.textContent = (state.pitchBend >= 0 ? '+' : '') + state.pitchBend.toFixed(2);
    applyPitchToLiveVoices(noteMap);
    if (state.isRec && state.pitchBend !== _lastRecordedBend) {
      _lastRecordedBend = state.pitchBend;
      state.recEvents.push({ type: 'pitch', bend: state.pitchBend, t: performance.now() - state.recStart });
    }
  }

  track.addEventListener('pointerdown', e => {
    dragging = true; startY = e.clientY; startBend = state.pitchBend;
    thumb.classList.add('active');
    track.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  track.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    state.pitchBend = Math.round(
      Math.max(-state.pitchMax, Math.min(state.pitchMax,
        startBend - (dy / (travel / 2)) * state.pitchMax
      )) * 100
    ) / 100;
    renderWheel();
  });

  function release() {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove('active');
    const from = state.pitchBend;
    let step = 0;
    const steps = 20;
    const interval = setInterval(() => {
      step++;
      state.pitchBend = from * (1 - step / steps);
      if (step >= steps) { state.pitchBend = 0; clearInterval(interval); }
      renderWheel();
    }, 16);
  }
  track.addEventListener('pointerup',     release);
  track.addEventListener('pointercancel', release);

  renderWheel();
}

// ── Transport (record / play / stop / clear) ─────────────────────────

export function initTransport(onRefresh, onStatus) {
  const btnRecord = document.getElementById('btnRecord');
  const btnPlay   = document.getElementById('btnPlay');
  const btnLoop   = document.getElementById('btnLoop');
  const btnStop   = document.getElementById('btnStop');
  const btnClear  = document.getElementById('btnClear');

  function startPb() {
    if (!state.recEvents.length) return;
    state.isPlay = true;
    btnPlay.classList.add('active');
    onStatus('PLAYING...', 'playing');
    const maxT = state.recEvents.reduce((m, e) => Math.max(m, e.t), 0);
    state.recEvents.forEach(ev => {
      state.timers.push(setTimeout(() => {
        if (ev.type === 'octave')       { return; }
        if (ev.type === 'sustain_on')   { pbSustainOn();  return; }
        if (ev.type === 'sustain_off')  { pbSustainOff(); return; }
        if (ev.type === 'pitch') {
          state.pitchBend = ev.bend;
          applyPitchToLiveVoices(noteMap);
          return;
        }
        const n = noteMap[ev.note];
        if (!n) return;
        if (ev.type === 'on')  pbNoteOn(n, ev.freq, ev.sus, ev.ls, ev.le, ev.dec, onRefresh);
        if (ev.type === 'off') pbNoteOff(n, ev.sus);
        onRefresh();
      }, ev.t));
    });
    state.timers.push(setTimeout(() => {
      state.isPlay = false;
      btnPlay.classList.remove('active');
      stopAllPbVoices();
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

  btnRecord.addEventListener('click', () => {
    if (state.isPlay) stopPb();
    if (state.isRec) {
      state.isRec = false;
      btnRecord.classList.remove('active');
      btnRecord.innerHTML = '&#x23FA; REC';
      onStatus('recorded ' + ((performance.now() - state.recStart) / 1000).toFixed(2) + 's');
      if (state.recEvents.length) { btnPlay.disabled = false; btnLoop.disabled = false; }
    } else {
      state.recEvents = [];
      state.isRec = true;
      state.recStart = performance.now();
      state.loop = false;
      btnLoop.classList.remove('active');
      btnRecord.classList.add('active');
      btnRecord.innerHTML = '&#x25CF; REC';
      btnPlay.disabled = true;
      btnLoop.disabled = true;
      onStatus('RECORDING...', 'recording');
      boot();
    }
  });

  btnPlay.addEventListener('click', () => {
    if (state.isRec) return;
    if (state.isPlay) { stopPb(); onStatus('stopped'); } else startPb();
  });

  btnLoop.addEventListener('click', () => {
    if (btnLoop.disabled) return;
    state.loop = !state.loop;
    btnLoop.classList.toggle('active', state.loop);
    if (state.loop && !state.isPlay && state.recEvents.length) startPb();
  });

  btnStop.addEventListener('click', () => {
    let msg = 'stopped';
    if (state.isRec) {
      state.isRec = false;
      btnRecord.classList.remove('active');
      btnRecord.innerHTML = '&#x23FA; REC';
      msg = 'recorded ' + ((performance.now() - state.recStart) / 1000).toFixed(2) + 's';
    }
    stopPb();
    state.loop = false;
    btnLoop.classList.remove('active');
    if (state.recEvents.length) { btnPlay.disabled = false; btnLoop.disabled = false; }
    onStatus(msg);
  });

  btnClear.addEventListener('click', () => {
    if (state.isPlay || state.isRec) return;
    state.recEvents = [];
    btnPlay.disabled = true;
    btnLoop.disabled = true;
    state.loop = false;
    btnLoop.classList.remove('active');
    onStatus('cleared');
  });
}
