# Changelog

All notable changes to `@evoclock/pi-bowerbird` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-10-27

### Added
- Light-mode flat diagrams offer dots-only category indicators by default or category-filled cards through `meta.lightFlatFill`, `--light-flat-fill dots|filled`, and the HTML toolbar ([#7](https://github.com/evoclock/pi-bowerbird/pull/7)).
- Rendering and export write both flat and isometric diagrams by default; `--view flat|iso` or `meta.view` limits output to one view ([#7](https://github.com/evoclock/pi-bowerbird/pull/7)).
- Buildkite mac-mini CI pipeline for `npm test` ([#1](https://github.com/evoclock/pi-bowerbird/pull/1)).

### Removed
- The earlier `categoryFillParity` / `--category-fill-parity` fill control is no longer supported; callers receive a migration error pointing to `lightFlatFill` ([#5](https://github.com/evoclock/pi-bowerbird/pull/5), [#7](https://github.com/evoclock/pi-bowerbird/pull/7)).

### Fixed
- Isometric interactive focus/selection ring now follows the node slab outline instead of the SVG `<g>` bounding box (Kris Adamatzky, [#2](https://github.com/evoclock/pi-bowerbird/pull/2)).
- Render tests use `fileURLToPath` so temp paths work on Windows (Kris Adamatzky, [#3](https://github.com/evoclock/pi-bowerbird/pull/3)).
- HTML node details drawer dismisses on outside click without breaking the close control or reopening ([#5](https://github.com/evoclock/pi-bowerbird/pull/5)).

## [0.1.1] - 2026-10-23

### Added
- Theme-aware isometric architecture example and Pi npm package install docs (see [v0.1.1 release](https://github.com/evoclock/pi-bowerbird/releases/tag/v0.1.1)).

[0.1.2]: https://github.com/evoclock/pi-bowerbird/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/evoclock/pi-bowerbird/releases/tag/v0.1.1
