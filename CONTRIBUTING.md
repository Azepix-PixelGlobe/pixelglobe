# Contributing to PixelGlobe

Thank you for wanting to contribute! PixelGlobe is GPL-3.0 and lives thanks to its community.

## Quick Start for Contributors

```bash
git clone https://github.com/<you>/pixelglobe.git
cd pixelglobe
npm install
npm run build
npm test
```

All tests must pass (`0 failures`) before a PR is accepted.

## How to Contribute

1. **Fork** the repo and create a branch: `git checkout -b feat/my-cool-idea`
2. **Code** — follow the existing style (Prettier + ESLint). Keep PRs small and focused.
3. **Test** — add or update tests in `pgrig/` if you touch core logic.
4. **Describe** — in your PR, explain *why* not just *what*. Add screenshots for UI changes.
5. **Sign-off** — by contributing you agree your code is GPL-3.0.

## Code Style

- `npm run lint` — we use ESLint + Prettier
- No `console.log` in production code (use `logger.js`)
- All user input must be validated in `utils/validation.js` and on the server

## Reporting Bugs / Security

- **Bugs:** Open an issue with steps to reproduce + expected vs actual.
- **Security:** Please email `easdhjd@gmail.com` **privately**. Do not open a public issue for exploits.

## Where to Start?

Look for issues tagged `good first issue` or `help wanted`. Popular areas:

- Minimap & canvas rendering
- Chat / moderation / anti-abuse
- Mobile / performance
- Docs & i18n

Thanks for building PixelGlobe with us! 💜
