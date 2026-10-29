# Contributing to Rigby2D

Thanks for your interest in improving Rigby2D! Bug reports, feature ideas, documentation fixes and
code are all welcome.

## Ways to contribute

- **Report a bug**: open an [issue](https://github.com/jaisurya-dev-art/rigby2d/issues) with steps
  to reproduce, what you expected, what happened, and your OS / Rigby2D version. Attach a small
  skeleton `.json` (with its images or atlas) if it helps.
- **Suggest a feature**: open an issue describing the problem you want solved before starting
  on a large change, so we can agree on the approach.
- **Send a pull request**: fixes, features, tests and docs.

## Development setup

1. Install [Node.js](https://nodejs.org) 20+ and the
   [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.
2. Fork and clone the repository, then:

   ```bash
   npm install
   npm run dev      # desktop window with hot reload
   npm test         # unit tests
   ```

`npm run web:dev` serves the UI in a plain browser at <http://localhost:1420>, which is handy for
quick UI work. File dialogs and disk access only work in the desktop app (`npm run dev`).

## Project layout

| Path | Notes |
| --- | --- |
| `src/core/` | Runtime used by games. **No dependencies and no DOM access**: it must run in any JS engine. |
| `src/editor/` | Editor UI. Plain JavaScript modules, DOM, a WebGL viewport with a Canvas 2D fallback; no UI framework. |
| `src/webgl/` | Reference WebGL renderer for the runtime, also used by the editor viewport. |
| `src/splash/` | Splash screen window. |
| `runtimes/rust/` | Rust runtime (`rigby-runtime`, no dependencies) and the Godot GDExtension (`rigby-godot`). The runtime must match `src/core`: change both together and keep the golden tests passing (see [runtimes/README.md](runtimes/README.md)). |
| `runtimes/godot/` | Godot addon, demo and headless tests. |
| `src/mcp/` | Model Context Protocol server ([docs/mcp.md](docs/mcp.md)). Node only, no dependencies; built on `src/core`. |
| `branding/` | Proprietary brand assets and the Rigbytron demo project; see [TRADEMARKS.md](TRADEMARKS.md). |
| `src-tauri/` | Native shell only. Keep app logic out of Rust; add permissions in `capabilities/` (`default.json` for the editor, `splash.json` for the splash) only when needed. |
| `test/` | `node:test` suites (`*.test.js`). |

## Coding guidelines

- Match the surrounding style: ES modules, 2-space indentation, single quotes, semicolons.
- Every source file starts with `// SPDX-License-Identifier: MIT OR Apache-2.0`.
- Keep skeleton JSON import/export lossless: anything read must be written back. If the format
  handling must change, discuss it in an issue first.
- Add or update tests in `test/` for changes to `src/core` or the pure editor helpers
  (`pack.js`, `sample.js`). Run `npm test` before pushing.
- For UI changes, include a screenshot or short clip in the pull request.

## Branches

| Branch | What it is |
| --- | --- |
| `main` | Stable: what the latest release was built from. It changes only when a release is made. |
| `develop` | Where work comes together. **Open pull requests against `develop`.** |

Make your own branch in your fork, named for what it does:

- `feat/<short-name>` for a new feature (`feat/onion-skin`);
- `fix/<short-name>` for a bug fix (`fix/key-drag-snap`), with the issue number when there is one
  (`fix/12-key-drag-snap`);
- `docs/<short-name>` for documentation and tutorials;
- `runtime/<short-name>` for the JavaScript, Rust or Godot runtimes.

When `develop` is ready, a maintainer merges it into `main` and makes a release.

## Pull request process

1. Fork the repository, then create your branch from `develop`:
   ```bash
   git clone https://github.com/<you>/rigby2d.git
   cd rigby2d
   git checkout develop
   git checkout -b feat/my-change
   ```
2. Keep each PR focused on one change; write a clear description of what and why.
3. Make sure `npm test` passes and `npm run web:build` succeeds; for runtime changes also
   `cargo test --release --workspace` in `runtimes/rust`.
4. Link the related issue (e.g. `Closes #12`).
5. Open the pull request against `develop` (not `main`). A maintainer will review; please respond to
   feedback with follow-up commits. If `develop` has moved on meanwhile, merge it into your branch.

### Commit messages

Use short, imperative subjects (`Fix key drag snapping`, `Add color keys to dopesheet`), with a body
explaining the reasoning when it isn't obvious.

## License

By contributing, you agree that your contributions are licensed under both the [MIT License](LICENSE-MIT)
and the [Apache License 2.0](LICENSE-APACHE), so users can choose either. The Rigby2D, NILA and
Rigbytron names, logos and artwork are not part of that grant; see [TRADEMARKS.md](TRADEMARKS.md).
