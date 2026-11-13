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
3. `tla`: a TLA+ module and TLC config. Guards are free booleans so TLC explores both outcomes. Running TLC is a separate, owner-approved step.

## When the code changes

Run `sync` (if the map tracks status), then `diff` against the previous ref, then `render`. Report the changes and any `check` findings in one short list the owner can scan at a glance.

## Output and embedding

- `render` writes `<name>.html` (interactive: drawer, traces, motion, theme toggle, export), `<name>.svg` (auto theme), `<name>.dark.svg`, `<name>.light.svg`, and `<name>.{dark,light}.{png,webp}`.
- `view: "iso"` gives an isometric view: built = solid slab, partial = hatched roof, planned = wireframe.
- `style` defaults to `restrained` (minimal, mid-century). Use `expressive` only when the owner asks for the expressive look.
- `snippets` prints the README `<picture>` block and MARP lines. GitHub keeps the SVG's CSS animation inside `<img>`.
- Fix every `validate` warning before delivering; warnings mean overlaps or clipped text.
