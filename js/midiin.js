/**
 * A MIDI keyboard plays the piano live: keys, pitch wheel (or strip) and sustain pedal, in Chrome, Edge and
 * Firefox (Safari has no Web MIDI). Notes play at their own pitch, middle C = C4, whatever the app's octave;
 * the keyboard's own octave buttons move them. Velocity is ignored, as everywhere here.
 *
 * Once turned on, it reconnects on later visits and picks up keyboards plugged in later. Pressing MIDI IN again
 * turns it off (and keeps it off), so the keyboard can play another app (GarageBand, say) alone.
 */
import { keyFor } from './midi.js';

const KEY = 'meowpiano.midiIn';

/** hooks: {noteOn(midiNote), noteOff(midiNote), sustain(down), bend(semitones -2…2), allOff(), status(text), active(on)} */
export function initMidiIn(button, hooks) {
  let access = null;
  const names = () => access ? [...access.inputs.values()].map(i => i.name).filter(Boolean) : [];

  function onMessage(e) {
    const [st, a = 0, b = 0] = e.data;
    const type = st & 0xf0;
    if (type === 0x90 && b > 0) hooks.noteOn(a);
    else if (type === 0x80 || type === 0x90) hooks.noteOff(a);
    else if (type === 0xb0 && a === 64) hooks.sustain(b >= 64);
    else if (type === 0xe0) hooks.bend(Math.max(-2, Math.min(2, ((a | (b << 7)) - 8192) / 8192 * 2)));
  }
  function attach() {
    for (const input of access.inputs.values()) input.onmidimessage = onMessage;
    const list = names();
    hooks.active(list.length > 0);
    hooks.status(list.length ? list.join(', ') + ' connected' : 'MIDI on · plug in a keyboard');
  }
  async function connect(quiet) {
    if (!navigator.requestMIDIAccess) {
      if (!quiet) hooks.status('this browser has no MIDI: use Chrome, Edge or Firefox');
      return;
    }
    try {
      access = await navigator.requestMIDIAccess();
    } catch (_) {
      if (!quiet) hooks.status('MIDI not allowed: allow it in the site settings');
      try { localStorage.removeItem(KEY); } catch (_) {}
      return;
    }
    try { localStorage.setItem(KEY, '1'); } catch (_) {}
    access.onstatechange = attach;
    attach();
  }
  function disconnect() {
    if (access) {
      for (const input of access.inputs.values()) input.onmidimessage = null;
      access.onstatechange = null;
      access = null;
    }
    try { localStorage.removeItem(KEY); } catch (_) {}
    hooks.allOff();
    hooks.active(false);
    hooks.status('MIDI off');
  }
  button.addEventListener('click', () => (access ? disconnect() : connect(false)));
  let remembered = false;
  try { remembered = localStorage.getItem(KEY) === '1'; } catch (_) {}
  if (remembered) connect(true);

  // test hook: feed raw MIDI bytes as if a keyboard sent them
  window.__midiIn = bytes => onMessage({ data: bytes });
}

/** Piano key for a MIDI note (see midi.js keyFor), avoiding names already sounding. */
export { keyFor };
