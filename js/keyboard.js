import { NOTES } from './notes.js';
import { boot, noteOn, noteOff } from './audio.js';
import { state } from './state.js';

const MOBILE = window.matchMedia('(max-width: 600px)').matches;
const KEY_W  = MOBILE ? 32 : 44;
const KEY_BW = MOBILE ? 20 : 28;

/**
 * Builds the piano keyboard DOM inside `#keyboard` and attaches
 * pointer event listeners. Call once on page load.
 */
export function initKeyboard(onNoteOn, onNoteOff) {
  const kb = document.getElementById('keyboard');
  kb.style.width = (15 * KEY_W) + 'px';

  // Reverse lookup: DOM element → note object (used for touch-glide)
  const elToNote = new Map();

  NOTES.forEach(n => {
    const el = document.createElement('div');
    el.className = 'key ' + n.type;
    el.style.left = n.type === 'white'
      ? (n.wi * KEY_W) + 'px'
      : ((n.lwi + 1) * KEY_W - KEY_BW / 2) + 'px';

    const lbl = n.key === '\\' ? '\\' : n.key === "'" ? "'" : n.key.toUpperCase();
    el.innerHTML =
      `<div class="key-note">${n.note}</div>` +
      `<div class="key-label">${lbl}</div>`;

    // Mouse/pen handlers — touch is handled at the container level below
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      boot().then(() => onNoteOn(n));
    });
    el.addEventListener('pointerenter', e => {
      if (e.pointerType === 'touch') return;
      if (e.buttons > 0) boot().then(() => onNoteOn(n));
    });
    el.addEventListener('pointerup',     e => { if (e.pointerType !== 'touch') onNoteOff(n); });
    el.addEventListener('pointerleave',  e => { if (e.pointerType !== 'touch') onNoteOff(n); });
    el.addEventListener('pointercancel', e => { if (e.pointerType !== 'touch') onNoteOff(n); });

    kb.appendChild(el);
    n.el = el;
    elToNote.set(el, n);
  });

  // ── Touch-glide: container-level handlers ───────────────────────────
  // On touch, pointer capture keeps events on the originating element,
  // so pointerenter never fires on neighbouring keys. Instead we use
  // pointermove + elementFromPoint to detect key changes ourselves.

  // pointerId → currently-active note
  const activeTouchKeys = new Map();

  function noteAtPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    return elToNote.get(el) ?? elToNote.get(el?.parentElement) ?? null;
  }

  kb.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    const note = noteAtPoint(e.clientX, e.clientY);
    if (note) {
      boot().then(() => onNoteOn(note));
      activeTouchKeys.set(e.pointerId, note);
    }
  });

  kb.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch') return;
    const newNote = noteAtPoint(e.clientX, e.clientY);
    const oldNote = activeTouchKeys.get(e.pointerId) ?? null;
    if (newNote === oldNote) return;
    if (oldNote) onNoteOff(oldNote);
    if (newNote) {
      boot().then(() => onNoteOn(newNote));
      activeTouchKeys.set(e.pointerId, newNote);
    } else {
      activeTouchKeys.delete(e.pointerId);
    }
  });

  function endTouch(e) {
    if (e.pointerType !== 'touch') return;
    const note = activeTouchKeys.get(e.pointerId);
    if (note) {
      onNoteOff(note);
      activeTouchKeys.delete(e.pointerId);
    }
  }
  kb.addEventListener('pointerup',     endTouch);
  kb.addEventListener('pointercancel', endTouch);
}
