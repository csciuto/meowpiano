/**
 * midi-in: a MIDI keyboard plays a web app.
 * https://github.com/csciuto/midi-in
 *
 * One file, no dependencies. Apps keep a copy at a pinned version (see the README) instead of loading
 * it from here at run time, so nothing changes under an app until it chooses to update.
 *
 * Works in Chrome, Edge and Firefox. Safari has no Web MIDI.
 */
export const VERSION = '1.0.0';

/**
 * Decode one MIDI message.
 * @param {ArrayLike<number>} data the message's bytes
 * @returns {object|null} one of
 *   { type: 'noteOn', note, velocity, channel }     velocity 0..1 (a note-on at velocity 0 is a noteOff)
 *   { type: 'noteOff', note, channel }
 *   { type: 'cc', controller, value, channel }      value 0..1
 *   { type: 'bend', value, channel }                -1..1, 0 at rest
 *   { type: 'clock' | 'start' | 'continue' | 'stop' }
 *   null for anything else
 */
export function parseMidi(data) {
  if (!data || !data.length) return null;
  const status = data[0], a = data[1] ?? 0, b = data[2] ?? 0;
  if (status === 0xf8) return { type: 'clock' };
  if (status === 0xfa) return { type: 'start' };
  if (status === 0xfb) return { type: 'continue' };
  if (status === 0xfc) return { type: 'stop' };
  if (status < 0x80 || status >= 0xf0) return null;
  const kind = status & 0xf0, channel = (status & 0x0f) + 1;
  if (kind === 0x90 && b > 0) return { type: 'noteOn', note: a, velocity: b / 127, channel };
  if (kind === 0x80 || kind === 0x90) return { type: 'noteOff', note: a, channel };
  if (kind === 0xb0) return { type: 'cc', controller: a, value: b / 127, channel };
  if (kind === 0xe0) {
    const raw = (a | (b << 7)) - 8192;
    return { type: 'bend', value: Math.max(-1, Math.min(1, raw / (raw < 0 ? 8192 : 8191))), channel };
  }
  return null;
}

/**
 * Wire a button to MIDI input. Pressing it asks the browser for MIDI and listens to every keyboard
 * connected, including ones plugged in later; pressing it again turns MIDI off and keeps it off, so
 * the keyboard can play another program alone. Once on, it comes back on by itself on later visits.
 *
 * @param {HTMLElement} button
 * @param {object} hooks  every hook is optional
 *   noteOn(note, velocity)   MIDI note number; velocity 0..1
 *   noteOff(note)
 *   bend(value)              pitch wheel, -1..1
 *   mod(value)               mod wheel (controller 1), 0..1
 *   sustain(down)            sustain pedal (controller 64)
 *   cc(controller, value)    every controller, including the two above; value 0..1
 *   clock() start() continue() stop()   MIDI clock (24 per quarter note) and transport
 *   allOff()                 MIDI was turned off: let go of everything it was holding
 *   status(text)             a line for the user ("KeyStep 37 connected", "MIDI off", ...)
 *   active(on)               whether a keyboard is connected, for the button's pressed state
 * @param {object} [options]
 *   storageKey  localStorage key that remembers MIDI is on (default 'midiIn'; null to never remember)
 * @returns {{ feed(bytes): void, isOn(): boolean }}  feed() handles bytes as if a keyboard sent them
 */
export function initMidiIn(button, hooks = {}, { storageKey = 'midiIn' } = {}) {
  let access = null;
  const call = (name, ...args) => { if (typeof hooks[name] === 'function') hooks[name](...args); };
  const remember = on => {
    if (!storageKey) return;
    try { if (on) localStorage.setItem(storageKey, '1'); else localStorage.removeItem(storageKey); } catch (_) { /* storage blocked */ }
  };
  const names = () => (access ? [...access.inputs.values()].map(i => i.name).filter(Boolean) : []);

  function handle(data) {
    const m = parseMidi(data);
    if (!m) return;
    if (m.type === 'noteOn') call('noteOn', m.note, m.velocity);
    else if (m.type === 'noteOff') call('noteOff', m.note);
    else if (m.type === 'bend') call('bend', m.value);
    else if (m.type === 'cc') {
      call('cc', m.controller, m.value);
      if (m.controller === 1) call('mod', m.value);
      if (m.controller === 64) call('sustain', m.value >= 64 / 127);
    } else call(m.type);
  }
  const onMessage = e => handle(e.data);

  function attach() {
    for (const input of access.inputs.values()) input.onmidimessage = onMessage;
    const list = names();
    call('active', list.length > 0);
    call('status', list.length ? list.join(', ') + ' connected' : 'MIDI on · plug in a keyboard');
  }

  async function connect(quiet) {
    if (!navigator.requestMIDIAccess) {
      if (!quiet) call('status', 'this browser has no MIDI: use Chrome, Edge or Firefox');
      return;
    }
    try {
      access = await navigator.requestMIDIAccess();
    } catch (_) {
      if (!quiet) call('status', 'MIDI not allowed: allow it in the site settings');
      remember(false);
      return;
    }
    remember(true);
    access.onstatechange = attach;
    attach();
  }

  function disconnect() {
    if (access) {
      for (const input of access.inputs.values()) input.onmidimessage = null;
      access.onstatechange = null;
      access = null;
    }
    remember(false);
    call('allOff');
    call('active', false);
    call('status', 'MIDI off');
  }

  button.addEventListener('click', () => (access ? disconnect() : connect(false)));

  let remembered = false;
  if (storageKey) { try { remembered = localStorage.getItem(storageKey) === '1'; } catch (_) { /* storage blocked */ } }
  if (remembered) connect(true);

  return { feed: handle, isOn: () => !!access };
}
