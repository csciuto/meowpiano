# Meow Piano

A browser-based piano that plays real meow samples (from Silas, a real cat). Each key plays the actual recording, pitch-shifted to the correct note. Holding sustain triggers a granular synthesis engine that keeps the "EO" vowel of the meow alive indefinitely — no looping seam, no oscillators. Built with vanilla JS and the Web Audio API. Deployed to GitHub Pages — no build step required.

## Live demo

[csciuto.github.io/meowpiano](https://csciuto.github.io/meowpiano)

## How it sounds

Every key press plays through three phases, matching the natural shape of a meow:

- **M** — the real recording plays from the start (attack transient, vowel onset)
- **EO** — when sustain is held, a granular engine takes over: it slices dozens of short overlapping "grains" from the stable vowel region of the recording and scatters their start positions randomly, producing a continuous, natural-sounding hold with no audible loop seam
- **W** — on key release (or sustain release), the granular engine fades out and the recording tail plays from the loop-out point to the end

Without sustain, the full recording plays once as-is (like a piano key).

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
| `Space` | Hold for sustain (hold to sustain, release to stop) |
| `Enter` | Toggle record on/off |

### Pitch wheel

Drag the wheel on the right side of the keyboard up or down to bend pitch up to ±2 semitones. It springs back to center on release. Pitch wheel movement is recorded and played back.

### Controls

| Button | Action |
|--------|--------|
| REC | Start recording; click again to stop |
| PLAY | Play back the recording |
| LOOP | Toggle looped playback |
| STOP | Stop playback or end recording |
| CLR | Clear the current recording |
| SUSTAIN | Hold for sustain while pressed |

### Settings panel

Click the **▶** tab on the right edge of the keyboard to open the settings panel.

| Control | What it does |
|---------|-------------|
| **Octave (-2 – +2)** | Shift the entire keyboard up or down by octave |
| **Loop IN / OUT** | Drag the handles to set which region of the meow the granular engine draws grains from. IN = where the M recording fades out; OUT = where the W tail begins. |
| **XFADE** | Crossfade duration between M→EO and EO→W transitions (0 – 100 ms) |
| **GRAIN** | Length of each individual grain (20 – 200 ms). Shorter = grainier texture; longer = smoother but more repetitive. |
| **SCATTER** | How much grains overlap (0 – 80%). Higher = denser and more varied. |
| **COPY** | Copies current loop/grain settings to clipboard so you can paste them into `js/state.js` as defaults. |

## Running tests

Tests use [Vitest](https://vitest.dev/) and cover `notes.js`, `state.js`, and DSP helpers.

```bash
npm install
npm test
```

Tests run in Node — no browser required. The audio layer (`audio.js`) is not tested because it depends on the Web Audio API.

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

The repo is served directly by GitHub Pages from the `main` branch root. Pushing to `main` deploys automatically — there is no build step.
