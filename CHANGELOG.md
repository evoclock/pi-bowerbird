# Changelog

All notable changes to `@evoclock/pi-bowerbird` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Deprecated
- The standalone composition HTML page and its custom styling are deprecated. Composition now writes linked overview and group diagrams through the package's ordinary render path. Use `--out <dir>` instead of `--out <file.html>`.

## [0.2.0] - 2026-11-12

### Added
- HTML embeds a local Geist font when `--embed-font` is set ([#9](https://github.com/evoclock/pi-bowerbird/pull/9)).
- Per-diagram renderer extensions with validation, normalisation, layout, SVG, and HTML hooks ([#11](https://github.com/evoclock/pi-bowerbird/pull/11)).
- Flat diagrams support one level of parent zone groups ([#12](https://github.com/evoclock/pi-bowerbird/pull/12)).
- Supplied evidence marks render independently of build status ([#13](https://github.com/evoclock/pi-bowerbird/pull/13)).
- Extension-owned input fields can be registered per scope ([#14](https://github.com/evoclock/pi-bowerbird/pull/14)).
- Flat diagrams label named parallel sibling regions without implying execution order ([#15](https://github.com/evoclock/pi-bowerbird/pull/15)).

### Fixed
- Diagram checks and render outcomes report failures reliably and avoid partial output ([#10](https://github.com/evoclock/pi-bowerbird/pull/10)).

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

[0.2.0]: https://github.com/evoclock/pi-bowerbird/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/evoclock/pi-bowerbird/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/evoclock/pi-bowerbird/releases/tag/v0.1.1
