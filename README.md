# Meow Piano

A browser-based piano that plays real meow samples (from Silas, a real cat; see [Credits](#credits)). Each key plays the actual recording, pitch-shifted to the correct note. Holding a key (or the sustain pedal) triggers a granular synthesis engine that keeps the "EO" vowel of the meow alive indefinitely — no looping seam, no oscillators. Built with vanilla JS and the Web Audio API. Deployed to GitHub Pages — no build step required.

## Live demo

[corey.sciu.to/meowpiano](https://corey.sciu.to/meowpiano/)

Built with [Claude Code](https://claude.com/claude-code).

## How it sounds

Every key press plays through three phases, matching the natural shape of a meow:

- **M** — the real recording plays from the start (attack transient, vowel onset)
- **EO** — while the key or sustain is held, a granular engine takes over: it slices dozens of short overlapping "grains" from the stable vowel region of the recording and scatters their start positions randomly, producing a continuous, natural-sounding hold with no audible loop seam
- **W** — on key release (or sustain release), the granular engine fades out and the recording tail plays from the loop-out point to the end

It works like a piano: a note holds as long as you hold its key, and the sustain pedal keeps it going after you let go, including notes you were already holding when you pressed the pedal. Releasing the pedal stops only the notes whose keys are up. A quick tap (released before the loop region) plays the full meow once.

## Generating audio samples

The app loads a pre-pitched OGG file per note from `sounds/notes/`. You must generate these before running locally, or any time you replace `sounds/meow.ogg` with a new recording.

```bash
pip install librosa soundfile numpy
python scripts/process_samples.py
```

The script:

1. Loads `sounds/meow.ogg` (the source recording).
2. Detects the steady-state "EO" vowel region via RMS energy analysis.
3. Snaps loop IN/OUT points to zero-crossings so the waveform joins without a click.
4. Bakes a 15 ms crossfade at the loop boundary so the sustained region blends seamlessly.
5. Generates 25 pitch-shifted OGGs (`sounds/notes/C4.ogg` … `C6.ogg`) using a phase-vocoder pitch shift, which preserves duration so every note plays for the same length of time regardless of pitch.
6. Prints the detected loop points.

**After running**, update `js/state.js` with the printed `loopStart` and `loopEnd` values:

```js
loopStart: 0.26,   // ← replace with printed value
loopEnd:   0.46,   // ← replace with printed value
```

These tell the granular engine which region of the recording to loop from.

> `sounds/notes/` is git-ignored; regenerate whenever you replace the source sample.

### Swapping in a different animal (or person)

1. Replace `sounds/meow.ogg` with your new mono OGG recording.
2. Edit `SAMPLE_ROOT` in `scripts/process_samples.py` to the approximate pitch of your recording in Hz (default: 440 Hz = A4).
3. Run the script. It re-pitches all 25 notes relative to that root.
4. Paste the printed `loopStart` / `loopEnd` into `js/state.js`.
5. Optionally fine-tune IN/OUT in the browser using the settings panel.

## Running locally

The app uses ES modules and fetches audio files, so it must be served over HTTP — opening `index.html` directly from the filesystem won't work.

```bash
# Python
python3 -m http.server

# Node
npx serve .

# VS Code: use the "Live Server" extension
```

Then open `http://localhost:8000` (or whichever port your server uses).

## Playing

### Keyboard layout

| Keys | Notes |
|------|-------|
| `A S D F G H J K L ; ' Z X C V` | White keys (C4 – C6) |
| `W E T Y U O P [ ] \` | Black keys |

### Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Sustain pedal (catches held notes and keeps released ones ringing) |
| `Enter` | Toggle record on/off |
| `↑` / `↓` | Pitch wheel: bend up or down while held, spring back on release |
| `1`–`5` | Octave −2, −1, 0, +1, +2 |

### Pitch wheel

Drag the wheel on the right side of the keyboard up or down to bend pitch up to ±2 semitones. It springs back to center on release. `↑` and `↓` do the same from the keyboard. Pitch wheel movement is recorded and played back.

### Controls

| Button | Action |
|--------|--------|
| REC | Start recording; click again to stop |
| PLAY | Play back the recording |
| LOOP | Toggle looped playback |
| STOP | Stop playback or end recording |
| CLR | Clear the current recording (and its link) |
| OPEN | Open a MIDI file (`.mid`) to play |
| LINK / MIDI | What SHARE makes: a link, or a MIDI file |
| SHARE / SAVE | Put the recording in the address and copy the link, or save it as a `.mid` file |
| SUSTAIN | Sustain pedal while pressed |

### Sharing a recording

A recording travels in the link (`#song=…`), like a player-piano roll: which keys, when, how long they were
held, the pedal, the pitch wheel, the loop points, the grain settings and the tuning. Nothing is uploaded, and opening the
link loads the song ready to play. During playback the keys light up green, the pitch wheel moves with the recorded bends, and a bar shows how far along it is.

Links stop at 8,000 characters, the most that chat apps and servers reliably pass along. That's about five
minutes of expressive playing (`tests/song.test.js` checks a five-minute piece of ~1,700 notes, a pedal change
every bar and a bend every other bar). While recording, the status shows how full the link is, and recording
stops by itself when it's full; for a longer piece, record a second part. The format is in `js/song.js`:
note starts in 5 ms steps, held lengths in 10 ms steps, pitch-wheel drags kept to within 4 cents, then
compressed.

### MIDI files

**OPEN** reads a standard MIDI file. Each instrument in it (a track's notes on one channel) gets a checkbox,
named from the file, with its note count; all are on except drums (channel 10), which are note numbers for
drum sounds rather than pitches. The checked instruments play as one meow piano: notes fold into the
piano's reach (C2–C8), and every note plays at one loudness (velocity is ignored).

With **MIDI** chosen, SHARE becomes **SAVE** and writes a one-track `.mid` file: notes, the pedal (CC64) and
the pitch wheel (pitch bend, ±2 semitones). The loop points, grain settings and tuning go in as text events
that start `meowpiano`, so a file saved here opens with the same sound; other programs ignore them.
Recording with MIDI chosen has no length limit. A link made from a long take or file holds as much as fits,
and the status says how much (`holds the first 4:51 of 12:30`). Unchecking instruments makes a song fit.
The format is in `js/midi.js`; the choice of LINK or MIDI is remembered in the browser.

### Settings panel

Click the **▶** tab on the right edge of the keyboard to open the settings panel.

| Control | What it does |
|---------|-------------|
| **Octave (-2 – +2)** | Shift the entire keyboard up or down by octave |
| **Loop IN / OUT** | Drag the handles to set which region of the meow the granular engine draws grains from. IN = where the M recording fades out; OUT = where the W tail begins. |
| **XFADE** | Crossfade duration between M→EO and EO→W transitions (0 – 100 ms) |
| **GRAIN** | Length of each individual grain (20 – 200 ms). Shorter = grainier texture; longer = smoother but more repetitive. |
| **SCATTER** | How much grains overlap (0 – 80%). Higher = denser and more varied. |
| **A4** | Tuning: what A above middle C is, 415 – 466 Hz (440 standard). Every note moves with it; shared links keep it. |
| **COPY** | Copies current loop/grain settings to clipboard so you can paste them into `js/state.js` as defaults. |

## Running tests

Tests use [Vitest](https://vitest.dev/) and cover `notes.js`, `state.js`, and DSP helpers.

```bash
npm install
npm test
```

Unit tests run in Node, no browser required. The audio layer (`audio.js`) is covered by the Playwright tests in `e2e/` (`npm run test:e2e`), which check note and sustain-pedal behavior in a real browser.

## Project structure

```
meowpiano/
├── index.html               # Single-page app shell
├── css/
│   └── style.css
├── js/
│   ├── main.js              # Entry point — wires everything together
│   ├── audio.js             # Web Audio API: boot, granular engine, voice lifecycle
│   ├── controls.js          # Sustain, octave, settings panel, pitch wheel, transport
│   ├── keyboard.js          # On-screen piano key rendering
│   ├── notes.js             # Note definitions, key mappings, octave shift
│   └── state.js             # Single shared mutable state object
├── scripts/
│   └── process_samples.py   # Generates sounds/notes/ from sounds/meow.ogg
├── sounds/
│   └── meow.ogg             # Source sample (Silas)
└── tests/
    ├── notes.test.js
    ├── state.test.js
    └── dsp.test.js
```

## Deploying

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. There is no build step; the workflow only stamps the version number (see below).

## Preview image

`npm run screenshot` runs the Playwright smoke test and refreshes `preview.png`, used for link previews. `npm run test:e2e` runs the browser tests.

## Versioning

Pushing to `main` deploys through `.github/workflows/deploy.yml`, which stamps `v1.<commit count>` into the version label in the corner. Locally the label reads `dev`.

## Credits

The meow is [“My cat Silas meowing”](https://commons.wikimedia.org/wiki/File:Meow.ogg) by Dan Crosby ([Dcrosby](https://en.wikipedia.org/wiki/User:Dcrosby) on English Wikipedia), from Wikimedia Commons, licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). `sounds/meow.ogg` is the unmodified file. The notes in `sounds/notes/` are pitch-shifted and loop-processed versions of it, released under the same license.

## License

The code is MIT licensed (see [LICENSE](LICENSE)). The audio in `sounds/` is not covered by the MIT license; it is CC BY-SA 3.0, as described in [Credits](#credits) and [sounds/LICENSE](sounds/LICENSE).
