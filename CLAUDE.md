# Meow Piano

A browser piano that plays real meow samples, pitch-shifted, with granular sustain. See README.md.

Follows the app standards in [csciuto/app-template STANDARDS.md](https://github.com/csciuto/app-template/blob/main/STANDARDS.md).
Commit and push freely once tests pass.

## This app

- ES modules in `js/`; the DSP, note and state logic is unit-tested with Vitest (`npm test`, `tests/`). Browser
  tests (`npm run test:e2e`) run at desktop and phone size with axe checks.
- `.github/workflows/deploy.yml` runs both and only then deploys, stamping `'dev'` in `js/main.js`.
- The meow is Dan Crosby's "My cat Silas meowing" (CC BY-SA 3.0). Keep the credit visible.

## Help page

`help.html` with clips in `help/*.webp` (animated WebP, silent), recorded by `npm run help-clips [name…]`
(`tools/help-clips.js`: Playwright drives the piano with a drawn cursor and key cap; sharp writes the WebP).
Re-record a clip whenever the UI it shows changes. Its "Hear Canon in D" link is `songs/canon-in-d.mid` as a
song link; a unit test checks it still opens, so regenerate it if the link format changes.
