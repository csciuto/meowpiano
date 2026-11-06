# Meow Piano

A browser piano that plays real meow samples, pitch-shifted, with granular sustain. See README.md.

Follows the app standards in [csciuto/app-template STANDARDS.md](https://github.com/csciuto/app-template/blob/main/STANDARDS.md).
Commit and push freely once tests pass.

## This app

- ES modules in `js/`; the DSP, note and state logic is unit-tested with Vitest (`npm test`, `tests/`). Browser
  tests (`npm run test:e2e`) run at desktop and phone size with axe checks.
- `.github/workflows/deploy.yml` runs both and only then deploys, stamping `'dev'` in `js/main.js`.
- The meow is Dan Crosby's "My cat Silas meowing" (CC BY-SA 3.0). Keep the credit visible.
