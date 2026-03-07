import { state } from './state.js';
import { NOTES, keyMap, noteMap } from './notes.js';
import { boot, noteOn, noteOff, analyser } from './audio.js';
import { initKeyboard } from './keyboard.js';
import {
  setSustain,
  setOctave,
  initSustain,
  initOctaveButtons,
  initSettings,
  initPitchWheel,
  initTransport,
} from './controls.js';

// ── Display helpers ───────────────────────────────────────────────────

function refreshDisplay() {
  const notes = new Set([
    ...Object.keys(state.liveVoices),
    ...Object.keys(state.pbVoices),
  ]);
  document.getElementById('activeNotes').innerHTML =
    [...notes].sort().map(n => `<div class="note-pill">${n}</div>`).join('');
}

function setStatus(text, cls) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = 'status ' + (cls || '');
}

// ── Note on / off wrappers (audio + recording) ────────────────────────

function on(n) {
  noteOn(n, refreshDisplay);
  if (state.isRec) {
    state.recEvents.push({
      type: 'on', note: n.note, freq: n.freq,
      sus: state.sustain, ls: state.loopStart, le: state.loopEnd,
      dec: state.decay, t: performance.now() - state.recStart,
    });
  }
  refreshDisplay();
}

function off(n) {
  noteOff(n);
  if (state.isRec) {
    state.recEvents.push({
      type: 'off', note: n.note, sus: state.sustain,
      t: performance.now() - state.recStart,
    });
  }
  refreshDisplay();
}

// ── Keyboard shortcuts ────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.key === ' ') {
    if (state.sustainLocked) { state.sustainLocked = false; setSustain(false); }
    else setSustain(true);
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter') {
    document.getElementById('btnRecord').click();
    e.preventDefault();
    return;
  }
  const n = keyMap[e.key.toLowerCase()];
  if (n) { boot().then(() => on(n)); e.preventDefault(); }
});

document.addEventListener('keyup', e => {
  if (e.key === ' ') {
    if (!state.sustainLocked) setSustain(false);
    return;
  }
  const n = keyMap[e.key.toLowerCase()];
  if (n) off(n);
});

// ── Waveform visualizer ───────────────────────────────────────────────

function initVisualizer() {
  const cv = document.getElementById('waveCanvas');
  const cc = cv.getContext('2d');
  (function draw() {
    requestAnimationFrame(draw);
    // analyser is lazily set after boot(); skip until ready
    const an = analyser;
    if (!an) return;
    const b = new Uint8Array(an.frequencyBinCount);
    an.getByteTimeDomainData(b);
    cc.clearRect(0, 0, cv.width, cv.height);
    cc.lineWidth = 2;
    cc.strokeStyle = 'rgba(255,45,120,0.8)';
    cc.shadowColor = '#FF2D78';
    cc.shadowBlur  = 10;
    cc.beginPath();
    for (let i = 0; i < b.length; i++) {
      const x = i * cv.width / b.length;
      const y = (b[i] / 128) * cv.height / 2;
      i ? cc.lineTo(x, y) : cc.moveTo(x, y);
    }
    cc.lineTo(cv.width, cv.height / 2);
    cc.stroke();
    cc.shadowBlur = 0;
  })();
}

// ── Floating cat decorations ──────────────────────────────────────────

function initDecorations() {
  ['&#x1F431;','&#x1F638;','&#x1F63A;','&#x1F43E;','&#x1F63B;','&#x1F640;','&#x1F63D;'].forEach(g => {
    const d = document.createElement('div');
    d.className = 'cat-float';
    d.innerHTML = g;
    d.style.cssText =
      `left:${Math.random() * 100}vw;` +
      `font-size:${14 + Math.random() * 28}px;` +
      `animation-duration:${14 + Math.random() * 22}s;` +
      `animation-delay:${-Math.random() * 30}s;`;
    document.body.appendChild(d);
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────

initKeyboard(on, off);
initSustain();
initOctaveButtons();
initSettings();
initPitchWheel();
initTransport(refreshDisplay, setStatus);
initVisualizer();
initDecorations();

boot().then(() => setStatus('click a key or press keyboard'));
