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
import { playable, songText, readSong, fitSong, stateAt, fmtTime, LINK_CAP } from './song.js';
import { fromMidi, toMidi } from './midi.js';

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

  // Tuning: A4 in Hz
  document.getElementById('tuneSlider').addEventListener('input', function () {
    state.tuning = parseFloat(this.value);
    document.getElementById('tuneLbl').textContent = state.tuning + 'Hz';
    applyPitchToLiveVoices(noteMap);
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
  if (!state.isRec) return;
  const t = performance.now() - state.recStart;
  // a wheel that sat still, then jumped (a MIDI strip touched somewhere new): keep where it sat until now,
  // or playback would slide there slowly
  for (let i = state.recEvents.length - 1; i >= 0; i--) {
    const e = state.recEvents[i];
    if (e.type === 'wheel_release') break;
    if (e.type === 'pitch') { if (t - e.t > 40) state.recEvents.push({ type: 'pitch', bend: e.bend, t: t - 1 }); break; }
  }
  state.recEvents.push({ type: 'pitch', bend: state.pitchBend, t });
}
/** A MIDI keyboard's pitch wheel: it springs back by itself, so this just follows it. */
export function midiBend(v) {
  if (springTimer) { clearInterval(springTimer); springTimer = null; }
  setBend(v);
  applyPitchToLiveVoices(noteMap);
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

// ── Transport (record / play / pause / seek / open / save / share) ────────
// A take is kept whole, however long. SAVE writes all of it as a MIDI file (midi.js); OPEN reads one. SHARE puts
// it in a link (song.js); a take too long for a link gives the link as much as fits: a recording its last part
// (the warm-up goes, what was just played stays), a file its first. The status says which.

const settingsNow = () => ({ loopStart: state.loopStart, loopEnd: state.loopEnd, crossfade: state.crossfade, grainDur: state.grainDur, grainOverlap: state.grainOverlap, tuning: state.tuning });
const linkBase = () => location.origin + location.pathname + '#song=';
const linkRoom = () => LINK_CAP - linkBase().length;
const SKIP_MS = 10000;   // ⏪ / ⏩

let _status = () => {}, _setTake = () => {};
const toastTimers = {};
function popup(id, text, ms) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimers[id]);
  toastTimers[id] = setTimeout(() => el.classList.remove('show'), ms);
}

/** Open the song in the address, if there is one. Returns true if it loaded. */
export async function loadSongFromLink() {
  const m = location.hash.match(/^#song=([\w-]+)$/);
  if (!m) return false;
  try {
    const song = await readSong(m[1]);
    applySettings(song.settings);
    _setTake(song.events, song.end, { kind: 'link', link: { text: m[1], cut: false } });
    _status('song loaded · ' + fmtTime(song.end) + ' · press PLAY');
    popup('playToast', 'SONG LOADED · ' + fmtTime(song.end), 5000);
    document.getElementById('btnPlay').classList.add('ready');   // glows until played
    return true;
  } catch (e) {
    _status("that song link is damaged");
    return false;
  }
}
function applySettings(st) {
  state.loopStart = st.loopStart; state.loopEnd = st.loopEnd;
  _renderHandles();
  for (const [id, v] of [['crossfadeSlider', st.crossfade], ['grainSlider', st.grainDur], ['scatterSlider', st.grainOverlap], ['tuneSlider', st.tuning]]) {
    const el = document.getElementById(id);
    el.value = v; el.dispatchEvent(new Event('input'));
  }
}

export function initTransport(onRefresh, onStatus) {
  const $ = id => document.getElementById(id);
  const btnRecord = $('btnRecord'), btnPlay = $('btnPlay'), btnLoop = $('btnLoop'), btnStop = $('btnStop');
  const btnBack = $('btnBack'), btnFwd = $('btnFwd'), btnClear = $('btnClear');
  const btnOpen = $('btnOpen'), btnSave = $('btnSave'), btnShare = $('btnShare');
  const seek = $('seek');
  _status = onStatus;

  // the take: what's loaded or just recorded, where it came from, and its link (made when first shared)
  let take = { kind: 'none' }, evs = [], total = 0, pos = 0, pbStart = 0, watch = null, recSettings = null;
  let midiFile = null, fileName = '';

  function setTake(events, end, info) {
    state.recEvents = events; state.recEnd = end;
    take = info;
    evs = playable(events);
    total = Math.max(end || 0, evs.reduce((m, e) => Math.max(m, e.t), 0));
    pos = 0;
    const has = events.some(e => e.type === 'on');
    for (const b of [btnPlay, btnLoop, btnBack, btnFwd, btnSave, btnShare]) b.disabled = !has;
    seek.hidden = !has;
    seek.max = String(Math.max(1, Math.round(total)));
    showPos(0);
  }
  _setTake = setTake;
  function clearTake() {
    setTake([], 0, { kind: 'none' });
    midiFile = null; fileName = '';
    $('parts').hidden = true; $('partList').textContent = '';
    btnPlay.classList.remove('ready');
    if (location.hash) history.replaceState(null, '', location.pathname);
  }

  // ── playing ──
  const now = () => (state.isPlay ? Math.min(total, performance.now() - pbStart) : pos);
  let seeking = false, progTimer = null;
  function showPos(t) {
    if (!seeking) seek.value = String(Math.round(t));
    seek.style.setProperty('--fill', (total ? 100 * t / total : 0) + '%');
    seek.setAttribute('aria-valuetext', fmtTime(t) + ' of ' + fmtTime(total));
  }
  function tick() {
    const t = now();
    showPos(t);
    onStatus((state.isPlay ? 'PLAYING ' : 'PAUSED ') + fmtTime(t) + ' / ' + fmtTime(total), state.isPlay ? 'playing' : '');
  }
  function playLabel() { btnPlay.innerHTML = state.isPlay ? '&#x275A;&#x275A; PAUSE' : '&#x25B6; PLAY'; }

  function startPb(from = pos) {
    if (!evs.length) return;
    halt();
    if (from >= total - 50) from = 0;
    btnPlay.classList.remove('ready');
    $('playToast').classList.remove('show');
    state.isPlay = true; pbStart = performance.now() - from;
    btnPlay.classList.add('active'); playLabel();
    $('pitchThumb').classList.add('playback');
    // start as the song stood at `from`: pedal, wheel, notes already sounding
    const at = stateAt(evs, from);
    if (at.pedal) pbSustainOn();
    state.pitchBend = at.bend; renderWheel();
    for (const e of at.sounding) {
      const n = noteMap[e.note];
      if (!n) continue;
      pbNoteOn(n, e.freq, true, e.ls, e.le, e.dec, onRefresh);
      if (e.up) pbNoteOff(n);
    }
    for (const ev of evs) {
      if (ev.t < from) continue;
      state.timers.push(setTimeout(() => {
        if (ev.type === 'sustain_on')   { pbSustainOn();  return; }
        if (ev.type === 'sustain_off')  { pbSustainOff(); return; }
        if (ev.type === 'pitch') { state.pitchBend = ev.bend; renderWheel(); return; }   // the wheel moves as recorded
        const n = noteMap[ev.note];
        if (!n) return;
        if (ev.type === 'on')  pbNoteOn(n, ev.freq, true, ev.ls, ev.le, ev.dec, onRefresh);
        if (ev.type === 'off') pbNoteOff(n);
        onRefresh();
      }, ev.t - from));
    }
    state.timers.push(setTimeout(() => {
      halt(); pos = 0; showPos(0);
      if (state.loop) startPb(0); else onStatus('done');
    }, total - from + 800));
    tick(); progTimer = setInterval(tick, 250);
  }
  // stop the sound and the clock; the position stays wherever it's set next
  function halt() {
    state.timers.forEach(clearTimeout);
    state.timers = [];
    clearInterval(progTimer); progTimer = null;
    state.isPlay = false;
    btnPlay.classList.remove('active'); playLabel();
    stopAllPbVoices();
    state.pitchBend = 0; renderWheel();
    $('pitchThumb').classList.remove('playback');
    onRefresh();
  }
  function pause() { pos = now(); halt(); showPos(pos); tick(); }
  function moveTo(t) {
    t = Math.max(0, Math.min(total, t));
    if (state.isPlay) startPb(t); else { pos = t; showPos(t); tick(); }
  }

  // ── recording ──
  function startRec() {
    halt();
    clearTake();
    state.isRec = true;
    state.recStart = performance.now();
    recSettings = settingsNow();
    state.loop = false; btnLoop.classList.remove('active');
    btnRecord.classList.add('active');
    btnRecord.innerHTML = '&#x25CF; REC';
    onStatus('RECORDING 0:00', 'recording');
    boot();
    // how much of the take a link would hold: once it's full, the link keeps the latest part
    let full = false;
    watch = setInterval(async () => {
      if (!state.isRec) return;
      const t = performance.now() - state.recStart;
      if (!full) {
        const len = (await songText(state.recEvents, t, recSettings)).length;
        if (!state.isRec) return;
        full = len > linkRoom();
        if (!full) { onStatus('RECORDING ' + fmtTime(t) + ' · LINK ' + Math.round(100 * len / linkRoom()) + '%', 'recording'); return; }
      }
      onStatus('RECORDING ' + fmtTime(t) + ' · LINK: LAST PART', 'recording');
    }, 1000);
  }
  async function finishRec() {
    if (!state.isRec) return;
    state.isRec = false;
    clearInterval(watch);
    btnRecord.classList.remove('active');
    btnRecord.innerHTML = '&#x23FA; REC';
    const end = performance.now() - state.recStart, raw = state.recEvents;
    if (!raw.some(e => e.type === 'on')) { setTake([], 0, { kind: 'none' }); onStatus('nothing recorded'); return; }
    const link = await makeLink(raw, end, recSettings, 'last');
    setTake(raw, end, { kind: 'take', link });
    onStatus('recorded ' + fmtTime(end) + ' · ' + linkNote(link));
  }

  // ── links ──
  async function makeLink(events, end, settings, keep) {
    const fit = await fitSong(events, end, settings, linkRoom(), keep);
    return { text: fit.text, cut: fit.cut, keep, len: fit.end };
  }
  const linkNote = l => l.cut ? 'LINK · ' + (l.keep === 'last' ? 'LAST ' : 'FIRST ') + fmtTime(l.len)
    : 'LINK ' + Math.round(100 * (linkBase().length + l.text.length) / LINK_CAP) + '%';

  btnShare.addEventListener('click', async () => {
    if (!state.recEvents.length) return;
    if (!take.link) take.link = await makeLink(state.recEvents, state.recEnd, settingsNow(), take.kind === 'take' ? 'last' : 'first');
    const l = take.link, url = linkBase() + l.text;
    history.replaceState(null, '', url);
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch (_) {}
    const part = l.cut ? ' · ' + (l.keep === 'last' ? 'last ' : 'first ') + fmtTime(l.len) + ' of ' + fmtTime(state.recEnd) : '';
    onStatus((copied ? 'link copied' : 'link in the address bar') + part + ' · ' + url.length.toLocaleString('en-US') + ' chars');
    popup('shareToast', (copied ? 'LINK COPIED!' : 'LINK IN ADDRESS BAR') + (l.cut ? ' · ' + (l.keep === 'last' ? 'LAST ' : 'FIRST ') + fmtTime(l.len) : ''), l.cut ? 4000 : 2600);
  });

  // ── files ──
  btnSave.addEventListener('click', () => {
    if (!state.recEvents.length) return;
    const bytes = toMidi(state.recEvents, state.recEnd, settingsNow());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
    a.download = (fileName ? fileName + '-meow' : 'meowpiano-' + new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')) + '.mid';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    onStatus('saved ' + a.download);
    popup('saveToast', 'MIDI SAVED!', 2600);
  });

  // OPEN: a MIDI file becomes the take; with more than one instrument, choose which to play
  const parts = $('parts'), partList = $('partList'), fileInput = $('midiFile');
  btnOpen.addEventListener('click', () => {
    if (state.isRec) return;
    fileInput.value = ''; fileInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    let file;
    try { file = fromMidi(new Uint8Array(await f.arrayBuffer())); } catch (_) { onStatus("couldn't read that MIDI file"); return; }
    if (!file.parts.length) { onStatus('no notes in that MIDI file'); return; }
    halt();
    clearTake();
    midiFile = file; fileName = f.name.replace(/\.midi?$/i, '');
    if (file.settings) applySettings({ ...settingsNow(), ...file.settings });
    for (const p of file.parts) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox'; box.value = p.id; box.checked = !p.drums;
      box.addEventListener('change', () => { halt(); useParts(); });
      const count = document.createElement('span');
      count.className = 'count'; count.textContent = '· ' + p.notes;
      label.append(box, p.name + ' ', count);
      partList.append(label);
    }
    parts.hidden = file.parts.length < 2;
    useParts();
    popup('playToast', 'SONG LOADED · ' + fmtTime(state.recEnd), 5000);
    btnPlay.classList.add('ready');
  });
  function useParts() {
    if (!midiFile) return;
    let ids = [...partList.querySelectorAll('input:checked')].map(b => b.value);
    if (midiFile.parts.length === 1) ids = [midiFile.parts[0].id];
    const { events, end } = midiFile.build(ids);
    setTake(events, end, { kind: 'file' });
    if (location.hash) history.replaceState(null, '', location.pathname);
    const notes = events.filter(e => e.type === 'on').length;
    onStatus(fileName + ' · ' + fmtTime(end) + ' · ' + notes.toLocaleString('en-US') + ' notes' + (notes ? ' · press PLAY' : ''));
  }

  // ── buttons ──
  btnRecord.addEventListener('click', () => { if (state.isRec) finishRec(); else startRec(); });
  btnPlay.addEventListener('click', () => {
    if (state.isRec) return;
    if (state.isPlay) pause(); else boot().then(() => startPb());
  });
  btnBack.addEventListener('click', () => moveTo(now() - SKIP_MS));
  btnFwd.addEventListener('click', () => moveTo(now() + SKIP_MS));
  btnLoop.addEventListener('click', () => {
    if (btnLoop.disabled) return;
    state.loop = !state.loop;
    btnLoop.classList.toggle('active', state.loop);
    if (state.loop && !state.isPlay && evs.length) boot().then(() => startPb());
  });
  btnStop.addEventListener('click', () => {
    if (state.isRec) finishRec();
    else onStatus('stopped');
    halt(); pos = 0; showPos(0);
    state.loop = false;
    btnLoop.classList.remove('active');
  });
  btnClear.addEventListener('click', () => {
    if (state.isPlay || state.isRec) return;
    clearTake();
    state.loop = false;
    btnLoop.classList.remove('active');
    onStatus('cleared');
  });

  // the seek bar: drag to look, let go to move there
  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('input', () => {
    const t = +seek.value;
    seek.style.setProperty('--fill', (100 * t / total) + '%');
    if (!state.isPlay) { pos = t; tick(); }
  });
  seek.addEventListener('change', () => { seeking = false; moveTo(+seek.value); });

  setTake([], 0, { kind: 'none' });
}
