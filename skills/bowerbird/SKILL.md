---
name: bowerbird
description: Draw and maintain reproducible architecture diagrams, statecharts, and concept maps as *.bower.json, rendered to interactive HTML, theme-aware SVG (README/MARP), and PNG/WebP. Use when asked to diagram a system, draw a statechart or user flow, show what is built versus planned, update a diagram after a commit, check a flow for dead ends, or produce a TLA+ spec from a statechart.
---

# Bowerbird

You write one JSON file; the `bowerbird` tool renders everything else. Never hand-edit generated HTML/SVG/PNG.

## Before authoring

1. Look for an existing `*.bower.json` (`docs/diagrams/` by convention). Update it instead of starting over; stable node ids keep change reports readable.
2. For a new map, run the tool with `action: "init"` to get a valid starter, then edit it.
3. Read only the code needed to name components truthfully. Every node's `details` should link the real files (repo-relative paths).

## The format (bowerbird/v1)

```json
{
  "schema": "bowerbird/v1",
  "meta": { "title": "...", "subtitle": "...", "kicker": "...",
            "statusTracking": true, "animation": "trace|static",
            "view": "flat|iso", "kind": "architecture|statechart",
            "style": "restrained|expressive", "direction": "LR|TD",
            "grid": { "col": 250, "row": 165, "gap": 44 },
            "repository": { "url": "https://github.com/o/r", "ref": "main" } },
  "categories": { "sage": { "label": "Planning" } },
  "zones": [{ "id": "core", "title": "Core", "kicker": "02 / logic", "category": "slate" }],
  "traces": [{ "id": "request", "label": "A request" }],
  "nodes": [{ "id": "api", "zone": "core", "at": [1, 0], "span": [1, 1],
              "type": "service", "title": "API", "lines": ["short line", "short line"],
              "hint": "file.ts", "category": "slate", "status": "implemented",
              "traces": ["request"],
              "evidence": { "paths": ["src/api/"], "tests": ["tests/api.test.ts"] },
              "details": "Markdown. #### headings, - lists, `code`, [links](src/api/index.ts)" }],
  "edges": [{ "from": "a", "to": "b", "kind": "data|control|failure", "label": "short",
              "traces": ["request"] }]
}
```

Rules that keep layouts clean:

- Place nodes on the grid with `at: [col, row]`; never think in pixels. One node per cell.
- Keep a zone's nodes contiguous. Leave zones side by side or stacked; the renderer adds gutters.
- Titles of 2 to 4 words, at most 2 `lines` of under 28 characters, edge labels of 1 to 3 words. Put everything else in `details`.
- Categories are palette names (`sage rust peach mustard slate mauve teal olive`) and denote **kind**, never readiness. Status is separate.
- `status` is `implemented | partial | planned`. With `evidence.paths`, `sync` derives it from git; do not guess.

## Planned-work diagrams without a model

For a tracker hook, read its task ledger and optional specs and PR snapshot from files. Call the file API directly from Node 22+; no model call or network access occurs:

```js
import { writePlanFile } from "@evoclock/pi-bowerbird/lib/plan-file.mjs";

const file = "docs/diagrams/work.bower.json";
const result = writePlanFile({
  tasksPath: "TASKS.md",
  specPaths: ["docs/spec.md"],
  prsPath: "pr-list.json", // JSON array from gh pr list --json number,headRefName,state,url
  outPath: file,
  updatePath: file, // omit on first creation; use on every later run
});
// result.changed is false and the file is byte-identical when the plan is unchanged.
```

For the first run, omit `updatePath` and use a new `outPath`. For later runs, supply the same path as `outPath` and `updatePath`; only imported task nodes and dependencies change. The command equivalent is `bowerbird plan --tasks TASKS.md --spec docs/spec.md --prs pr-list.json --out docs/diagrams/work.bower.json --update docs/diagrams/work.bower.json`. Omit `--update` on first creation. Task headings or tables with IDs and status are required; unknown free-form prose is not inferred. Do not turn a file tree into a plan. Source documents are read-only, and differing existing output requires explicit update.

## Statecharts

Set `meta.kind: "statechart"`. Use `shape: "initial" | "final" | "choice"` for pseudo-states (no title needed on initial) and `shape: "state"` for states. Transitions use `event`, `guard`, and `action` fields instead of `label`. Use `gap: [180, 60]` so transition labels fit.

Then, in order:

1. `check`: unreachable states, dead ends (nothing can finish), ambiguous events (same event, indistinct guards). Findings are also drawn on the diagram. Fix the chart or the code; do not suppress.
2. `journeys`: Given/When/Then paths from start to each end. Use them to seed a project verification skill's feature map (pstack `create-verification-skill-pi`).
3. `tla`: an **abstract** control-flow module and config. Guards are free booleans; actions do not update values. This export is not verification.

## Author, check, project, render, explain a model

1. **Author** a handwritten `.tla` and matching `.cfg` with explicit variables, initial state, actions, invariants and, if needed, temporal properties. Do not infer semantics from diagram labels or weaken a failing rule. The config and model specify what is checked, not what real code does.
2. **Check** with `bowerbird verify Model.tla --config Model.cfg --tlc-jar /trusted/tla2tools.jar --out new-directory`. Obtain the reviewed pinned TLC jar explicitly and use Java 17+. Check the command's exit code: 0 means completed/no checked violation, 1 means a supported model violation, 2 means incomplete/error. Inspect per-rule statuses in `evidence.json` and `report.md`; unchecked does not mean passed. Do not overwrite prior results.
3. **Project** only from sourced `evidence.json`. The verify command creates `model.bower.json` for supported concrete runs within the chart budget; an omitted chart is not an absent violation. If display grouping is useful, supply `--trusted-view ./reviewed-view.mjs` only for code you authored or independently audited. This executes JavaScript with your process permissions; it is not sandboxed. Export `state(vars)` for display labels and optionally `step(action, from, to)` and `regions(vars)`. The latter returns a nested object with at least two top-level named regions and string leaves. Each returned tree describes one **observed joint state**. Different joint combinations stay separate even if their display labels match. The chart keeps every concrete step and its complete source and target joint conditions, not independent region execution or an invented interleaving. TLC `VIEW` and `SYMMETRY` still omit concrete charts.
4. **Render** using the verify output `model.html` and `model.svg`. Do not hand-edit generated output or turn graph `check` or `journeys` into a model-verification claim. Open the chart and follow its `evidence.json` links; read raw logs when projection is partial.
5. **Explain** each checked, violated and unchecked rule with its config, witness path or temporal loop, bounds, constraints and omissions. Say **model evidence; implementation defects require independent replay**. This command does not replay actual code: explicitly label every counterexample **model-only** until independently reproduced against the implementation. Never claim a finite model check proves application correctness or a temporal witness is shortest.

## When the code changes

Run `sync` (if the map tracks status), then `diff` against the previous ref, then `render`. Report the changes and any `check` findings in one short list the owner can scan at a glance.

## Output and embedding

- `render` writes `<name>.html` (interactive: drawer, traces, motion, theme toggle, export), `<name>.svg` (auto theme), `<name>.dark.svg`, `<name>.light.svg`, and `<name>.{dark,light}.{png,webp}`.
- `view: "iso"` gives an isometric view: built = solid slab, partial = hatched roof, planned = wireframe.
- `style` defaults to `restrained` (minimal, mid-century). Use `expressive` only when the owner asks for the expressive look.
- `snippets` prints the README `<picture>` block and MARP lines. GitHub keeps the SVG's CSS animation inside `<img>`.
- Fix every `validate` warning before delivering; warnings mean overlaps or clipped text.
