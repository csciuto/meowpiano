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
} from './audio.js';
import { noteMap } from './notes.js';

// ── Sustain pedal ─────────────────────────────────────────────────────

export function setSustain(on) {
  state.sustain = on;
  if (state.isRec) {
    state.recEvents.push({ type: on ? 'sustain_on' : 'sustain_off', t: performance.now() - state.recStart });
  }
  applySustainToLiveVoices(on);
}

function updateSustainUI() {
  const btn     = document.getElementById('btnSustain');
  const lockBtn = document.getElementById('btnSustainLock');
  btn.style.color      = state.sustain ? '#080B14' : '#44DDFF';
  btn.style.background = state.sustain ? '#44DDFF' : 'transparent';
  lockBtn.style.color      = state.sustainLocked ? '#080B14' : '#44DDFF';
  lockBtn.style.background = state.sustainLocked ? '#44DDFF' : 'rgba(68,221,255,0.08)';
  lockBtn.style.opacity    = '1';
  lockBtn.style.borderLeftColor = state.sustain ? '#080B14' : '#44DDFF';
}

export function initSustain() {
  const btn     = document.getElementById('btnSustain');
  const lockBtn = document.getElementById('btnSustainLock');

  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (state.sustainLocked) {
      state.sustainLocked = false;
      setSustain(false);
    } else {
      setSustain(true);
    }
    updateSustainUI();
  });
  btn.addEventListener('pointerup', () => {
    if (!state.sustainLocked) { setSustain(false); updateSustainUI(); }
  });
  btn.addEventListener('pointerleave', () => {
    if (!state.sustainLocked) { setSustain(false); updateSustainUI(); }
  });

  lockBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (state.sustainLocked) {
      state.sustainLocked = false;
      setSustain(false);
    } else {
      state.sustainLocked = true;
      setSustain(true);
    }
    updateSustainUI();
  });
}

// ── Octave buttons ────────────────────────────────────────────────────

export function setOctave(shift) {
  state.octaveShift = shift;
  if (state.isRec) {
    state.recEvents.push({ type: 'octave', shift, t: performance.now() - state.recStart });
  }
  applyOctaveShift(shift);
  document.querySelector('.octave-bar').textContent = OCTAVE_LABELS[String(shift)] || '';
  [-2, -1, 0].forEach(v => {
    const btn = document.getElementById('oct' + v);
    if (!btn) return;
    btn.style.background = (v === shift) ? '#AA88FF' : 'transparent';
    btn.style.color      = (v === shift) ? '#080B14' : '#AA88FF';
  });
}

export function initOctaveButtons() {
  [-2, -1, 0].forEach(v => {
    const btn = document.getElementById('oct' + v);
    if (btn) btn.addEventListener('click', () => setOctave(v));
  });
}

// ── Settings panel ────────────────────────────────────────────────────

export function initSettings() {
  // Toggle panel
  document.getElementById('btnLoopEdit').addEventListener('click', function () {
    const p = document.getElementById('loopPanel');
    const open = p.style.display !== 'none';
    p.style.display = open ? 'none' : 'flex';
    this.innerHTML = (open ? '&#x25BC;' : '&#x25B2;') + ' SETTINGS';
  });

  // Decay slider
  document.getElementById('decaySlider').addEventListener('input', function () {
    state.decay = parseFloat(this.value);
    document.getElementById('decayLbl').textContent = state.decay.toFixed(1) + 's';
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
  function renderWheel() {
    thumb.style.top = bendToY(state.pitchBend) + 'px';
    valLbl.textContent = (state.pitchBend >= 0 ? '+' : '') + state.pitchBend.toFixed(2);
    applyPitchToLiveVoices(noteMap);
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
    onStatus('PLAYING...', 'playing');
    const maxT = state.recEvents.reduce((m, e) => Math.max(m, e.t), 0);
    state.recEvents.forEach(ev => {
      state.timers.push(setTimeout(() => {
        if (ev.type === 'octave')       { return; }
        if (ev.type === 'sustain_on')   { pbSustainOn();  return; }
        if (ev.type === 'sustain_off')  { pbSustainOff(); return; }
        const n = noteMap[ev.note];
        if (!n) return;
        if (ev.type === 'on')  pbNoteOn(n, ev.freq, ev.sus, ev.ls, ev.le, ev.dec, onRefresh);
        if (ev.type === 'off') pbNoteOff(n, ev.sus);
        onRefresh();
      }, ev.t));
    });
    state.timers.push(setTimeout(() => {
      state.isPlay = false;
      pbSustainOff();
      if (state.loop) { state.timers = []; startPb(); } else onStatus('done');
    }, maxT + 800));
  }

  function stopPb() {
    state.timers.forEach(clearTimeout);
    state.timers = [];
    state.isPlay = false;
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
    if (state.isRec) {
      state.isRec = false;
      btnRecord.classList.remove('active');
      btnRecord.innerHTML = '&#x23FA; REC';
    }
    stopPb();
    state.loop = false;
    btnLoop.classList.remove('active');
    if (state.recEvents.length) { btnPlay.disabled = false; btnLoop.disabled = false; }
    onStatus('stopped');
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
