# Meow Piano

A browser-based piano that plays real meow samples (from Silas, a real cat). Built with vanilla JS and the Web Audio API. Deployed to GitHub Pages — no build step required.

## Live demo

[csciuto.github.io/meowpiano](https://csciuto.github.io/meowpiano)

## Running locally

The app uses ES modules and fetches an audio file, so it must be served over HTTP — opening `index.html` directly from the filesystem won't work.

Any static file server will do. Examples:

```bash
# Python
python3 -m http.server

# Node
npx serve .

# VS Code
# Use the "Live Server" extension and open index.html
```

Then open `http://localhost:8000` (or whichever port your server uses).

## Playing

### Keyboard

| Row | Notes |
|-----|-------|
| `A S D F G H J K L ; ' Z X C V` | White keys (C4 – C6) |
| `W E T Y U O P [ ] \` | Black keys |

- **Space** — hold for sustain; tap again to release
- **Enter** — toggle record

### Mouse / touch

Click or tap the on-screen keys. The pitch wheel on the right can be dragged and springs back to center on release.

### Controls

| Button | Action |
|--------|--------|
| REC | Start / stop recording |
| PLAY | Play back the recording |
| LOOP | Toggle looped playback |
| STOP | Stop playback or recording |
| CLR | Clear the current recording |
| SUSTAIN | Hold sustain (lock button pins it on) |

### Settings panel

Click **SETTINGS** to expand:

- **Octave** — shift the keyboard down 1 or 2 octaves (-1, -2) or back to default (0)
- **Decay** — envelope decay time when sustain is on (1 – 30 s)
- **Loop IN / OUT** — drag the handles to set the loop region within the meow sample

## Running tests

Tests use [Vitest](https://vitest.dev/) and cover `notes.js` and `state.js`.

```bash
npm install
npm test
```

Tests run in Node — no browser required. The audio layer (`audio.js`) is not covered because it depends on the Web Audio API.

## Project structure

```
meowpiano/
├── index.html          # Single-page app shell
├── css/
│   └── style.css
├── js/
│   ├── main.js         # Entry point — wires everything together
│   ├── audio.js        # Web Audio API: boot, voices, playback
│   ├── controls.js     # Sustain, octave, settings, pitch wheel, transport
│   ├── keyboard.js     # On-screen piano key rendering
│   ├── notes.js        # Note definitions, key mappings, octave shift
│   └── state.js        # Single shared mutable state object
├── sounds/
│   └── meow.ogg        # Source sample (Silas)
└── tests/
    ├── notes.test.js
    └── state.test.js
```

## Deploying

The repo is served directly by GitHub Pages from the `main` branch root. Pushing to `main` deploys automatically — there is no build step.
