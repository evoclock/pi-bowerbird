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
- **Room to explore.** Zoom, pan, fit, fullscreen, and a minimap in every HTML page. With `--embed-font`, HTML embeds a local Geist font so it works offline.

## Modes

| | Left to right | Top down |
|---|---|---|
| Flat | `--view flat` | `--direction TD` |
| Isometric | `--view iso` | `--view iso --direction TD` |

With no `--view` flag, every render writes both `<name>.flat.*` and `<name>.iso.*` files, each in dark and light. Use `--view flat` or `--view iso` (or `meta.view`) to opt out and write only `<name>.*`. See [examples/gallery/index.html](examples/gallery/index.html).

In the isometric view, status reads as construction: built is a solid block, partial has a hatched roof, planned is a wireframe.

## Styles

- **restrained** (default). Matte planes, fine lines, generous space, and soft pastel colour.
- **expressive**. Glows, colour washes, shadows, and gradients.

Set `meta.style` in the diagram, or pass `--style expressive` to `render`. Both themes share the chosen style. In restrained **flat light** diagrams, only the small indicator dots show category colours by default. Set `meta.lightFlatFill` to `"filled"` or pass `--light-flat-fill filled` to fill node cards with category colours; the flat HTML toolbar can switch between dots-only and filled. `--light-flat-fill dots` restores the default. Dark and isometric styling are unchanged. The former `categoryFillParity` option is no longer supported.

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
bowerbird render docs/diagrams/system.bower.json            # both flat and iso; html, svg, png, webp
bowerbird render docs/diagrams/system.bower.json --view iso --direction TD
bowerbird snippets docs/diagrams/system.bower.json          # README and MARP embeds
```

### Composition maps

Add an opt-in `composition` object to a `*.bower.json` diagram. It has `groups` (`id`, `title`, explicit `status`), `components` (`id`, `title`, `type`, `group`, one-line `purpose`, explicit `status`), and `edges` (`from`, `to`, positive `step`). Status is `built`, `partial` or `planned`; it is never inferred. Component types are `skill`, `recipe`, `playbook`, and `workflow`. A workflow chains playbooks in step order; a recipe or playbook runs skills in step order. IDs are unique across groups and components. Legacy diagrams need no changes.

```sh
bowerbird composition docs/diagrams/flock.bower.json --out docs/diagrams/flock.html
# Or for a detached input with no Git repository:
bowerbird composition docs/diagrams/flock.bower.json --out docs/diagrams/flock.html --input-sha 0123456789abcdef0123456789abcdef01234567
```

This command writes one standalone light-mode HTML page with no iframe or network fetch. Group slabs open their own isometric maps; choosing a workflow shows its ordered playbook and skill chain and dims unrelated components. The HTML records the package version and the input repository's HEAD commit in both meta tags and `<html>` data attributes. An invalid or missing full commit SHA prevents output. This uses the same isometric layout and renderer as `render --view iso`.

Statecharts:

```sh
bowerbird check examples/proposal-to-merge.bower.json      # dead ends, unreachable, ambiguous
bowerbird journeys examples/proposal-to-merge.bower.json   # Given/When/Then paths
bowerbird tla examples/proposal-to-merge.bower.json        # abstract control-flow export, not a TLC check
```

The TLA+-first runner accepts independently authored `.tla` and `.cfg` inputs. Obtain the official [TLC 1.7.4 `tla2tools.jar`](https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar) explicitly, then supply its path. Its required SHA-256 is `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`; a different jar is rejected. Nothing downloads automatically. Java 17+ is required (`--java` selects an executable).

```sh
bowerbird verify tests/fixtures/Counter.tla --config tests/fixtures/Counter.cfg \
  --tlc-jar /path/to/tla2tools.jar --out verification/counter
```

The output directory must be new. It contains `report.md` with the original verdict, per-rule checked/violated/unchecked results and provenance, assumptions, omissions, bounds, input/tool hashes, exact TLC invocation, witness (when available) and links to raw artifacts. It also contains original `tlc.stdout`, `tlc.stderr`, machine-readable `tlc.dot` when produced, TLC metadata, `evidence.json`, and `run.json` with source/config hashes, exact invocation, tool pin, resource bounds and raw outcome. TLC runs with one worker, a 256 MiB Java heap, an eight MiB combined log budget, a 64 MiB TLC metadata budget and a 60-second default timeout (set `--timeout-ms` from 100 to 600000). SIGINT/SIGTERM cancels the child; timeouts and cancellation exit 2. Exit 0 requires TLC's completed/no-error marker; 1 covers a parsed invariant, deadlock or single-property temporal violation; 2 means error or incomplete. Other TLC exit codes stay unchecked until their witnesses are supported. The typed evidence covers finite states, initial fingerprints, action-labelled steps, supported value types, invariant results and finite invariant witnesses linked to the original output. Unsupported value/graph syntax, missing evidence, ambiguous multiple temporal properties and malformed reduction declarations remain **unchecked** and exit 2, even when TLC returned a recognised code. `run.json` retains the raw TLC outcome separately. An early invariant or deadlock violation leaves exploration boundaries unknown; a completed state exploration (including a supported temporal violation) marks its observed graph explored only within its configured constraints. Supported concrete finite outcomes within the chart budget also produce `model.bower.json`, flat `model.html` and `model.svg` with one card per observed concrete state and one arrow per sourced model step, including self-loops. An initial state is labelled, not linked by an invented transition. Invariant witnesses carry rule-specific marks linked to `evidence.json`; values and provenance stay there in full. The chart budget is 500 states / 1500 steps. Larger completed checks omit the chart and keep a checked model verdict with exact omissions; larger violations show only the complete witness when it fits, and label every omitted state/step. A witness too large for the budget omits its chart but remains linked in typed evidence. A failed or unreadable projection is **incomplete** (exit 2), not a pass. `VIEW` and `SYMMETRY` create representative quotient identities, so they omit the concrete chart instead of showing false concrete transitions. Model-derived charts are not authored graph checks; `check` and `journeys` reject them. For a single supported liveness property, the graph and report retain TLC's explicit lasso back edge or implicit stuttering witness; these bounded model traces are not necessarily shortest and do not prove code behavior. A real deadlock has no enabled `Next` successor; the tool does not add stuttering to hide it. To represent an intended terminal, define a guarded self-loop only at that terminal in the model (as in `tests/fixtures/Terminal.tla`). An incomplete check is never passed. Unreadable or missing required report artifacts also exit 2; preflight failures (such as missing tools or invalid input paths) exit 2 before an output directory is created. The exact ordered TLC argv and working directory are in `report.md` and `run.json`; for a new check, invoke `bowerbird verify` with the recorded inputs and a **new** `--out` path. Even a completed finite check supports only its specific model/config and assumptions, never implementation correctness. `tla` export and graph checks are not model verification.

An optional `--trusted-view ./local-view.mjs` loads **executable JavaScript** into the verifier process with your user permissions, filesystem and network access. Use it only for code you authored or independently audited; never pass a downloaded or untrusted view. It is not sandboxed. The module exports `state(vars)` returning a nonempty display label and may export `step(action, from, to)` returning a nonempty action label. Arguments are typed evidence values, not plain JavaScript scalars. Equal state labels merge display cards, not concrete identities. Every observed concrete arrow remains an arrow, including parallel arrows and loops; witness paths remain marked. A card `breaks` a rule only if every member has sourced failing evidence; if only some members have such evidence, it `mayBreak`. Unknown members are not assumed to pass or fail. Concrete fingerprints, per-rule outcomes, and the original TLC evidence remain in `evidence.json`. The executable view path and hash appear in the report; its imports are not pinned by that hash. This is a **faithful abstraction of observed model states**, not an unrestricted model or implementation proof. The option does not reconstruct concrete states from TLC `VIEW` or `SYMMETRY` reductions.

`CONSTRAINT` and `ACTION_CONSTRAINT` can exclude successors from TLC's DOT graph. Evidence reports those boundaries as partial, not terminal states; the exact number of excluded states is unknown. If TLC's witness evaluates an invariant at an excluded successor, the chart uses a clearly labelled witness-derived boundary ID, not an invented TLC fingerprint or graph edge. Deadlock checks at excluded boundary states are not claimed. `VIEW` and `SYMMETRY` retain TLC's reduced model/config verdict and raw representative graph, but omit the chart until concrete-to-representative mappings can be shown faithfully. These checks do not cover an unrestricted model or prove implementation correctness.

If a supported invariant fails and other invariants remain unchecked, `verify` keeps the original model, config, raw verdict, witness and exit code intact. It writes separately labelled follow-on configs and runs under `diagnostics/`, omitting **only** invariants already found violated. `diagnostics.json` and the original report link each run's config, checked/violated/unchecked rules and raw evidence. These are distinct finite model/config verdicts, not a combined proof. Follow-ons use a byte-identical source copy so TLC can resolve the diagnostic configs; user-defined local modules may fail to resolve from that location, in which case the follow-on stays unchecked. A 100,000-distinct-state diagnostic limit is monitored during execution and validated against the final count; TLC has no native hard ceiling, so brief overshoot is possible. Diagnostic runs also share a 60-second (or configured) total time budget and stop after at most 16 passes. A stopped, over-bound or unreadable follow-on never becomes a pass. None of this proves implementation correctness.

Keeping a map current:

```sh
bowerbird sync docs/diagrams/system.bower.json    # status from git evidence
bowerbird diff docs/diagrams/system.bower.json    # structural changes since HEAD
```

`templates/hooks/pre-commit` runs check, sync, diff, and render, then stages the outputs. Copy it into `.git/hooks/` to opt in.

### Groups and parallel regions

Flat diagrams can group zones one level deep. Give child zones a `parent` that names a top-level zone; the parent draws a boundary around its children and cannot contain nodes directly. For named parallel regions, give at least two sibling child zones titles and `"parallel": true`. Each needs a node. The flat view labels their boundaries and cross-region conditions; this is static signage, not an execution or concurrency model. The isometric view does not draw these group boundaries.

```json
"zones": [
  { "id": "flow", "title": "Flow" },
  { "id": "intake", "title": "Intake", "parent": "flow", "parallel": true },
  { "id": "review", "title": "Review", "parent": "flow", "parallel": true }
]
```

### Per-diagram renderer extensions

JavaScript callers can pass `{ extensions: [extension] }` to `normalise(input, options)`. Extensions apply only to that diagram, in registration order. Hooks include `validate(input, fail)`, `normalise(model)`, `layout(model, layout)`, `svg(model, layout)`, and `html(model, layout, { view })`. The SVG and HTML hooks return markup; validation reports problems through `fail(code, message)`. `createExtensions` in `lib/extensions.mjs` validates extension entries.

An extension can also claim input fields through `fields` keyed by `node`, `zone`, `edge`, `meta`, or `top`. Each field may define `validate(value, fail, source)` and `normalise(value, source)`. A field can have only one owner per scope. Declare fields on the extension passed to `normalise`; no process-wide registry or CLI flag is required.

```js
import { normalise } from "@evoclock/pi-bowerbird/lib/model.mjs";

const extension = {
  fields: { node: { priority: {
    validate(value, fail) { if (!Number.isInteger(value)) fail("priority", "must be an integer"); },
    normalise(value) { return value; }
  } } }
};
const model = normalise(input, { extensions: [extension] });
```

### Supplied evidence marks

Add `evidence.marks` to a node to display externally supplied labels in SVG and the keyboard-readable HTML evidence list:

```json
"evidence": { "marks": [
  { "kind": "breaks", "label": "Rule A", "trace": "https://example.org/trace#a" },
  { "kind": "unchecked", "label": "Review pending" }
] }
```

Kinds are `breaks`, `mayBreak`, `bugPath`, `repeats`, `assumed`, and `unchecked`. Optional `trace` links accept HTTPS URLs or safe relative paths. These marks do not change build status or verifier findings. Existing `evidence.paths` and `evidence.tests` still drive status sync; sync preserves the evidence value's original JSON bytes.

## Embedding

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/system.flat.dark.svg">
  <img alt="System" src="docs/diagrams/system.flat.light.svg">
</picture>
```

For MARP, use `![bg contain](docs/diagrams/system.flat.light.svg)`, or the WebP for PDF and PPTX export. Use `system.iso.light.svg` for the isometric view.

## CI

Product CI is Buildkite on the `mac-mini` queue. The organisation pipeline uploads [`.buildkite/pipeline.yml`](.buildkite/pipeline.yml), which checks Node >= 22, then runs `npm install` and `npm test`.

## License

MIT.
