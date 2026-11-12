import { state } from './state.js';
import { NOTES, keyMap, noteMap, BASE_FREQS, TOP_MIDI } from './notes.js';
import { initMidiIn } from './vendor/midi-in.js';
import { keyFor } from './midi.js';
import { boot, noteOn, noteOff, analyser, soundOn, wake } from './audio.js';
import { initKeyboard } from './keyboard.js';
import {
  setSustain,
  setOctave,
  initSustain,
  initOctaveButtons,
  initSettings,
  initPitchWheel,
  initTransport,
  keyBendStart,
  keyBendStop,
  midiBend,
  loadSongFromLink,
  updateSustainUI,
  onOctaveChange,
} from './controls.js';
onOctaveChange(() => refreshDisplay());


// ── Display helpers ───────────────────────────────────────────────────

// Keys light by the pitch actually sounding: pink for keys you hold, green for playback. The keyboard shows
// two octaves; keys held outside them are counted at the edges (◀ 2 / 3 ▶), and the octave buttons move the
// view. The pills name every pitch sounding, held by a key or the pedal.
const PITCH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiOf = f => Math.round(69 + 12 * Math.log2(f / 440));
function refreshDisplay() {
  const low = 60 + 12 * state.octaveShift;
  const lit = new Map(), sounding = new Set();
  let below = 0, above = 0;
  for (const [voices, cls] of [[state.pbVoices, 'played'], [state.liveVoices, 'pressed']]) {
    for (const v of Object.values(voices)) {
      if (!v || !v.freq) continue;
      const m = midiOf(v.freq);
      sounding.add(m);
      if (v.keyUp) continue;   // key up, the pedal holding it
      const i = m - low;
      if (i < 0) below++; else if (i >= NOTES.length) above++; else lit.set(i, cls);
    }
  }
  NOTES.forEach((n, i) => {
    if (!n.el) return;
    n.el.classList.toggle('pressed', lit.get(i) === 'pressed');
    n.el.classList.toggle('played', lit.get(i) === 'played');
  });
  document.getElementById('lowMore').textContent = below ? '\u25C0 ' + below : '';
  document.getElementById('highMore').textContent = above ? above + ' \u25B6' : '';
  document.getElementById('activeNotes').innerHTML = [...sounding].sort((a, b) => a - b)
    .map(m => `<div class="note-pill">${PITCH[m % 12]}${Math.floor(m / 12) - 1}</div>`).join('');
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
      type: 'on', note: n.note, freq: n.freq, ...(n.vel !== undefined && { vel: n.vel }),
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

// ── A MIDI keyboard ───────────────────────────────────────────────────
// Each MIDI note gets a piano key at its own pitch (two octaves of one note use two keys, so neither cuts
// the other off); the key lights up and the note records like any other.

const midiHeld = {};   // MIDI note → the key playing it
const midiIn = initMidiIn(document.getElementById('btnMidiIn'), {
  noteOn(m, vel) {
    if (m > TOP_MIDI) return;   // above C7: no meow up there
    if (midiHeld[m]) off(midiHeld[m]);
    const k = keyFor(m, new Set(Object.keys(state.liveVoices)));
    const n = { ...noteMap[k.note], freq: BASE_FREQS[k.note] * Math.pow(2, k.oct), fixed: true, vel };
    midiHeld[m] = n;
    boot().then(() => on(n));
  },
  noteOff(m) { const n = midiHeld[m]; if (n) { delete midiHeld[m]; off(n); } },
  sustain(down) { if (down !== state.sustain) { setSustain(down); updateSustainUI(); } },
  bend: v => midiBend(Math.round(v * 200) / 100),      // the wheel bends two semitones each way; whole cents
  allOff() {   // MIDI turned off: let go of everything it was holding
    for (const m of Object.keys(midiHeld)) this.noteOff(m);
    if (state.sustain) { setSustain(false); updateSustainUI(); }
    midiBend(0);
  },
  status: text => setStatus(text + (text.endsWith('connected') && !soundOn() ? ' · click once for sound' : '')),
  active(on) { document.getElementById('btnMidiIn').setAttribute('aria-pressed', String(on)); },
}, { storageKey: 'meowpiano.midiIn' });
window.__midiIn = midiIn.feed;   // test hook: bytes as if a keyboard sent them

for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, wake);

// ── Keyboard shortcuts ────────────────────────────────────────────────

const OCTAVE_KEYS = { 1: -2, 2: -1, 3: 0, 4: 1 };

document.addEventListener('keydown', e => {
  if (e.target.matches && e.target.matches('input[type="text"]')) {   // typing a name: no shortcuts
    if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.repeat) return;
  // checkboxes and LINK / MIDI keep space and arrows; every other key still plays
  const choice = e.target.matches && e.target.matches('input[type="checkbox"], input[type="radio"]');
  if (choice && (e.key === ' ' || e.key.startsWith('Arrow'))) return;
  if (e.key === ' ') {
    setSustain(true);
    updateSustainUI();
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('btnRecord').click();
    return;
  }
  if (!choice && e.target.closest && e.target.closest('input')) return;   // sliders keep their own keys
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {          // ↑ / ↓: the pitch wheel
    keyBendStart(e.key === 'ArrowUp' ? 1 : -1);
    e.preventDefault();
    return;
  }
  if (OCTAVE_KEYS[e.key] !== undefined && !e.metaKey && !e.ctrlKey && !e.altKey) {   // 1–4: octave −2 … +1
    setOctave(OCTAVE_KEYS[e.key]);
    return;
  }
  const n = keyMap[e.key.toLowerCase()];
  if (n) { boot().then(() => on(n)); e.preventDefault(); }
});

document.addEventListener('keyup', e => {
  if (e.target.matches && e.target.matches('input[type="text"]')) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { keyBendStop(e.key === 'ArrowUp' ? 1 : -1); return; }
  if (e.key === ' ') {
    setSustain(false);
    updateSustainUI();
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
    d.setAttribute('aria-hidden', 'true');  // decoration
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

// the opening hint, unless something already said more (a MIDI keyboard reconnecting, say)
boot().then(async () => {
  if (!(await loadSongFromLink()) && !document.getElementById('status').textContent) setStatus('click a key or press keyboard');
});
window.addEventListener('hashchange', () => loadSongFromLink());
