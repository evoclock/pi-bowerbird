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

Set `meta.style` in the diagram, or pass `--style expressive` to `render`. Both themes use the chosen style.

For restrained **flat light** diagrams:

- Only the small indicator dots show category colours by default.
- Set `meta.lightFlatFill` to `"filled"` or pass `--light-flat-fill filled` to colour the node cards.
- The flat HTML toolbar can switch between filled cards and dots. `--light-flat-fill dots` restores the default.

Dark and isometric styling do not change. The old `categoryFillParity` option is no longer supported.

## Install

In pi:

```sh
pi install npm:@evoclock/pi-bowerbird@0.3.0
```

For a shell install from npm, or from the GitHub release tarball after v0.3.0 is published:

```sh
sfw npm install @evoclock/pi-bowerbird@0.3.0
sfw npm install https://github.com/evoclock/pi-bowerbird/releases/download/v0.3.0/evoclock-pi-bowerbird-0.3.0.tgz
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

Add a `composition` object to a `*.bower.json` diagram to map how components fit together.

- `groups` have an `id`, `title`, and explicit `status`.
- `components` have an `id`, `title`, `type`, `group`, one-line `purpose`, and explicit `status`.
- `edges` have `from`, `to`, and a positive `step` for ordering.
- Status is `built`, `partial`, or `planned`. The tool never infers it.
- Component types are `skill`, `recipe`, `playbook`, and `workflow`. Workflows order playbooks; recipes and playbooks order skills.
- IDs must be unique across groups and components. Older diagrams need no changes.

Use an authored diagram with matching zones, nodes, categories, and placement (see [the composition schema and flat-to-composition how-to](docs/composition-schema.md)). Validate and render into a directory:

```sh
bowerbird validate examples/bowerbird.bower.json && bowerbird composition examples/bowerbird.bower.json --out diagrams/composition
# Or, for input outside a Git repository, supply its real full commit SHA:
bowerbird composition examples/bowerbird.bower.json --out diagrams/composition --input-sha 0123456789abcdef0123456789abcdef01234567
```

The output directory contains linked `overview` and `group-*` diagrams in flat and isometric views. It also contains standalone `composition.flat.html` and `composition.iso.html` pages.

- Standalone pages embed the rendered groups. Click a group to open it, then return to the overview without a network request.
- Pages start in light mode with filled category colours. The theme toggle switches to dark; flat pages can also switch between filled cards and dots.
- Pages use the regular renderer and controls ([#36](https://github.com/evoclock/pi-bowerbird/pull/36)). The old custom single-file page and `--out <file.html>` are deprecated.
- Each HTML page records the package version and input SHA in `generator` and `bowerbird-input-sha` meta tags and `<html>` data attributes. A missing or invalid full SHA prevents output.

`bowerbird validate <file> --strict` fails on layout warnings. Older flat diagrams still work without composition.

### Planned-work importer

Import a task ledger into a diagram; optionally add specifications and PR data, then update the existing diagram incrementally without overwriting the source documents:

```sh
bowerbird plan --tasks docs/TASKS.md --out docs/planned.bower.json
bowerbird plan --tasks docs/TASKS.md --update docs/planned.bower.json
```

The `writePlanFile` API in `lib/plan-file.mjs` supports deterministic integrations. Use `--spec <md>` (repeatable) and `--prs <json>` when those sources exist.

### TLC tools and statecharts

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

#### What verify writes

Use a new `--out` directory for every check. `verify` never overwrites an existing one.

- `report.md` gives the original result, each rule's result and source, assumptions, limits, omissions, and any failure path (witness). It links to the raw files.
- `tlc.stdout` and `tlc.stderr` preserve TLC's original output. `tlc.dot` contains TLC's state graph when produced. TLC metadata is also saved.
- `evidence.json` records typed states, initial-state identifiers, action-labelled steps, supported values, rule results, and supported finite witnesses. It links findings to TLC output.
- `run.json` records source and config hashes, the tool hash, exact command and working directory, limits, and TLC's raw result separately from the final verdict.

To repeat a check, use the recorded inputs and command with a **new** `--out` path.

#### Exit codes

| Code | Meaning |
|---|---|
| `0` | TLC completed without a reported violation, and the checked evidence and required files agree. |
| `1` | A supported, parsed model invariant, deadlock, or single-property temporal violation has a witness. |
| `2` | Error or incomplete check, including cancellation, timeout, unreadable output, or unsupported evidence. |

Other TLC results remain unchecked until the tool supports their witnesses. A recognised TLC code alone cannot make a check pass.

Unsupported values or graph syntax, missing evidence, ambiguous multiple temporal properties, and malformed reduction declarations also exit `2`. Missing or unreadable required files do too.

Input or tool checks can fail before the output directory is created. SIGINT or SIGTERM cancels the TLC child process.

#### Limits

`verify` runs TLC with these limits. MiB means 1,048,576 bytes.

| Resource | Limit |
|---|---|
| Workers | `1` |
| Java heap | `256 MiB` |
| Combined stdout and stderr | `8 MiB` |
| TLC graph file | `8 MiB` |
| TLC metadata | `64 MiB` |
| Timeout | `60,000 ms` by default; `--timeout-ms` accepts `100`–`600,000 ms` |
| Chart | `500` states and `1,500` steps |

#### What a pass does and doesn't prove

A completed check covers only the specified model, config, assumptions, and checked rules. It does **not** prove that the implementation is correct.

An early invariant or deadlock failure leaves the rest of the state graph unexplored. A completed exploration covers its observed graph only within the configured constraints.

A supported temporal failure can occur after state exploration completes. Its witness shows a loop or repeated last state, not necessarily the shortest path.

A deadlock means no `Next` step is enabled. The tool does not add a self-loop to hide one. For an intended terminal, define a guarded self-loop there, as in `tests/fixtures/Terminal.tla`.

`bowerbird tla` exports an abstract model; `check` and `journeys` inspect authored diagrams. None of these commands verifies a model.

#### Charts

For a supported finite result within the chart limits, `verify` writes `model.bower.json`, flat `model.html`, and `model.svg`.

- Each observed state gets a card. Each sourced model step gets an arrow, including self-loops.
- Initial states get labels, not invented incoming arrows. Failure paths carry rule-specific marks linked to full values and sources in `evidence.json`.
- If a completed graph exceeds the chart limit, the check can still pass. The report records the omitted chart and exact counts.
- If a violation's graph exceeds the limit, the chart shows only its complete witness when that fits. It labels omitted states and steps.
- If even the witness exceeds the limit, no chart is written. The witness remains in `evidence.json`.
- If a required chart fails to render or cannot be read, the check is incomplete (`2`).

These model-derived charts cannot be passed to `check` or `journeys` as authored diagrams.

#### Trusted views

**Security warning:** `--trusted-view` runs executable JavaScript with your user permissions. It can access your files and network. It is **not sandboxed**.

Use only a module you wrote or independently audited. Never pass a downloaded or untrusted view.

Add `--trusted-view ./local-view.mjs` to `bowerbird verify`, with a new output directory.

- The module must export `state(vars)`, which returns a nonempty display label. It can export `step(action, from, to)` for a nonempty action label.
- Arguments contain typed evidence values, not plain JavaScript numbers or strings.
- Equal state labels merge display cards, not the original concrete states. Every observed arrow remains, including parallel arrows and loops. Witness paths stay marked.
- A grouped card gets `breaks` only when every member has sourced failing evidence. It gets `mayBreak` when only some do. Unknown members are neither passes nor failures.
- `evidence.json` keeps concrete state fingerprints (identifiers), rule results, and original TLC evidence.
- The report records the view module's path and hash. That hash does **not** pin modules it imports.

A view changes the display of observed model states. It cannot recover concrete states from TLC's `VIEW` or `SYMMETRY` reductions. See [#35](https://github.com/evoclock/pi-bowerbird/pull/35).

#### Joint states

A trusted view can export `regions(vars)` to label parts of one observed state. This does not model independently running machines.

- Return a nested object with at least two named top-level regions and string values at its leaves.
- Keep the same leaf paths across states. Different combinations cannot merge into one card, even if their `state(vars)` labels match.
- Every observed arrow shows its source region values and changed labels. Its details retain source and target state identifiers.
- The chart invents no transition or execution order. A model witness is **model-only** until independently replayed against real code.

See [#37](https://github.com/evoclock/pi-bowerbird/pull/37) and `skills/bowerbird/SKILL.md` for the author/check/project/render/explain workflow.

#### Constraints

TLC's `CONSTRAINT` and `ACTION_CONSTRAINT` settings can exclude successor states from its DOT state graph.

- Evidence marks these boundaries as partial, not terminal states. The number of excluded states is unknown.
- If a failure path evaluates an invariant at an excluded successor, the chart labels that boundary with a witness-derived ID. Its sourced witness arrow is not a TLC DOT edge.
- No deadlock check is claimed at that excluded state.

`VIEW` and `SYMMETRY` group states into representatives. The tool retains TLC's reduced model/config verdict and raw representative graph, but omits the concrete chart.

It cannot faithfully map each representative back to a concrete state or transition. These results cover only the configured, reduced model.

#### Follow-on diagnostics

When a supported invariant fails and others remain unchecked, `verify` can run separate checks for those remaining rules.

- The original model, config, raw verdict, witness, and exit code stay intact.
- New configs omit **only** invariants already found violated. Each pass has its own model/config result; the passes are not a combined proof.
- `diagnostics/` holds the new configs and runs. `diagnostics.json` and the original report link each pass's rule results and raw evidence.
- Each pass uses a byte-identical source copy so TLC can find its config. Custom local modules might not resolve from that copy; affected passes stay unchecked.

| Diagnostic limit | Value |
|---|---|
| Distinct states per pass | `100,000` by default; monitored while running and checked against the final count |
| Total time for follow-ons | `60,000 ms` by default, or the configured timeout, shared across passes |
| Number of passes | At most `16` |

TLC has no hard state ceiling, so a run can briefly exceed the state limit. Stopped, over-limit, or unreadable runs never get a passing verdict.

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
