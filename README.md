# pi-bowerbird

[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=000)](https://developer.mozilla.org/docs/Web/JavaScript)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![Shell](https://img.shields.io/badge/Shell-4EAA25?style=flat&logo=gnubash&logoColor=fff)](https://www.gnu.org/software/bash/)
[![npm version](https://img.shields.io/npm/v/%40evoclock/pi-bowerbird)](https://www.npmjs.com/package/@evoclock/pi-bowerbird)

Reproducible diagrams for the [pi coding agent](https://pi.dev). Write one `*.bower.json` file; get an interactive HTML page, animated theme-aware SVGs for READMEs and slides, and PNG/WebP exports.

bowerbird is built first for pi, as a skill and an extension that an agent uses directly. That is its primary home, not its only one: versions for other agent harnesses will follow. The command line works anywhere today.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/gallery/flat-lr/bowerbird.dark.svg">
  <img alt="Bowerbird architecture" src="examples/gallery/flat-lr/bowerbird.light.svg">
</picture>

Same diagram in isometric view:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/gallery/iso-lr/bowerbird.dark.svg">
  <img alt="Bowerbird architecture in isometric view" src="examples/gallery/iso-lr/bowerbird.light.svg">
</picture>

## Why not Mermaid

- **Clean layouts.** Orthogonal routes, spread ports, and labels that never sit on a box. Layout warnings fail loudly instead of drawing a mess.
- **It moves in a README.** GitHub keeps an SVG's CSS animation inside `<img>`, and `<picture>` follows the reader's light or dark theme.
- **Built versus planned.** Each component can show whether it is built, partial, or planned, kept current from git by an optional pre-commit hook.
- **Statecharts that check themselves.** Unreachable states, dead ends, and ambiguous events are flagged and drawn on the chart. The same file exports a TLA+ spec and Given/When/Then paths.
- **Click through to code.** The HTML page opens a details drawer for each component, with links to the real files.
- **Room to explore.** Zoom, pan, fit, fullscreen, and a minimap in every HTML page.

## Modes

| | Left to right | Top down |
|---|---|---|
| Flat | `--view flat` | `--direction TD` |
| Isometric | `--view iso` | `--view iso --direction TD` |

Every mode comes in a dark and a light theme. See [examples/gallery/index.html](examples/gallery/index.html).

In the isometric view, status reads as construction: built is a solid block, partial has a hatched roof, planned is a wireframe.

## Styles

- **restrained** (default). Matte planes, fine lines, generous space, and soft pastel colour.
- **expressive**. Glows, colour washes, shadows, and gradients.

Set `meta.style` in the diagram, or pass `--style expressive` to `render`. Both themes share the chosen style. In restrained style, light mode uses chalky category fills by default. Set `meta.categoryFillParity` to `"dark"` or pass `--category-fill-parity dark` to use the dark recipe's category fills while keeping light surfaces and text. The HTML toolbar can switch fills without rerendering; `--category-fill-parity mode` restores the default.

## Install

In pi:

```sh
pi install npm:@evoclock/pi-bowerbird
```

PNG and WebP export use `rsvg-convert` and `cwebp`:

```sh
brew install librsvg webp
```

For Geist Sans in rasters and embedded SVGs:

```sh
brew install --cask font-geist
```

Without these, bowerbird falls back to the optional npm packages `@resvg/resvg-js` and `sharp`. Install those yourself, through Socket Firewall:

```sh
sfw npm install @resvg/resvg-js sharp
```

## Use

In pi, ask for a diagram. The `bowerbird` skill teaches the format and the `bowerbird` tool renders it. From a shell:

```sh
bowerbird init docs/diagrams/system.bower.json
bowerbird render docs/diagrams/system.bower.json            # html, svg, png, webp
bowerbird render docs/diagrams/system.bower.json --view iso --direction TD
bowerbird snippets docs/diagrams/system.bower.json          # README and MARP embeds
```

Statecharts:

```sh
bowerbird check examples/proposal-to-merge.bower.json      # dead ends, unreachable, ambiguous
bowerbird journeys examples/proposal-to-merge.bower.json   # Given/When/Then paths
bowerbird tla examples/proposal-to-merge.bower.json        # TLA+ module and TLC config
```

Keeping a map current:

```sh
bowerbird sync docs/diagrams/system.bower.json    # status from git evidence
bowerbird diff docs/diagrams/system.bower.json    # structural changes since HEAD
```

`templates/hooks/pre-commit` runs check, sync, diff, and render, then stages the outputs. Copy it into `.git/hooks/` to opt in.

## Embedding

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/system.dark.svg">
  <img alt="System" src="docs/diagrams/system.light.svg">
</picture>
```

For MARP, use `![bg contain](docs/diagrams/system.light.svg)`, or the WebP for PDF and PPTX export.

## CI

Product CI is Buildkite on the `mac-mini` queue. The organisation pipeline uploads [`.buildkite/pipeline.yml`](.buildkite/pipeline.yml), which checks Node >= 22, then runs `npm install` and `npm test`.

## License

MIT.
