import { NOTES } from './notes.js';
import { boot, noteOn, noteOff } from './audio.js';
import { state } from './state.js';

const KEY_W = 44;
const KEY_BW = 28;

/**
 * Builds the piano keyboard DOM inside `#keyboard` and attaches
 * pointer event listeners. Call once on page load.
 */
export function initKeyboard(onNoteOn, onNoteOff) {
  const kb = document.getElementById('keyboard');
  kb.style.width = (15 * KEY_W) + 'px';

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

    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      boot().then(() => onNoteOn(n));
    });
    el.addEventListener('pointerup',     () => onNoteOff(n));
    el.addEventListener('pointerleave',  () => onNoteOff(n));
    el.addEventListener('pointercancel', () => onNoteOff(n));

    kb.appendChild(el);
    n.el = el;
  });
}
