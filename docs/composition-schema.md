# Composition map schema

A `bowerbird/v1` file may include an optional `composition` object with `groups`, `components`, and `edges` arrays. Existing diagrams without `composition` remain valid and render as before.

Each group has a unique `id`, a `title`, and an explicit `status`. Each component has a unique `id` across groups and components, a `title`, a `group` referencing a group ID, a `type`, a one-line `purpose`, and an explicit `status`. Status is `built`, `partial`, or `planned`; no status is inferred. Component types are `skill`, `recipe`, `playbook`, and `workflow`.

Each edge has `from`, `to`, and a positive integer `step` unique to its source. A workflow chains playbooks; a playbook or recipe runs skills. Steps define the order. The overview shows group counts and status badges; opening a group reveals its isometric map. Choosing a workflow highlights its playbook and skill sequence.

## Converting a flat bower.json into a composition map

1. Keep `schema` and `meta`. Turn each flat `zone` into a `composition.groups` entry (`id` → `id`, `title` → `title`), or define groups around related components if the flat map has no zones. Each flat `node` becomes a component: preserve `id` and `title`, map its `zone` to `group`, and assign a supported `type`. Add a new workflow component if the flat map did not name one. Do not copy layout-only `at`, `span`, or `category` fields.
2. Turn each node's `lines` or `details` into a factual, single-line `purpose` that says what it does; do not use a file path or a readiness claim as the purpose. Convert only execution relationships from flat `edges` into composition edges: a workflow chains playbooks, and a playbook or recipe runs skills. Number each source's edges `step: 1`, `step: 2`, and so on in run order; ordinary data-flow edges are not composition steps.
3. Set every group and component `status` explicitly. Check `TASKS.md` and specs for planned scope; check open PRs for in-progress work, not proof of a build. Use `built` only for integrated work supported by evidence, `partial` for evidenced but incomplete work, and `planned` for work not yet built. Determine group status from its actual scope rather than defaulting it to built. Run `validate` until it exits 0 before rendering.

For example, this flat map contains a review action and a check:

```json
{
  "schema": "bowerbird/v1", "meta": { "title": "Review flow" },
  "zones": [{ "id": "delivery", "title": "Delivery" }],
  "nodes": [
    { "id": "review", "title": "Review", "zone": "delivery", "at": [0, 0], "lines": ["Check the change"] },
    { "id": "test", "title": "Test", "zone": "delivery", "at": [1, 0], "lines": ["Run checks"] }
  ],
  "edges": [{ "from": "review", "to": "test" }]
}
```

The composition version gives the work an explicit workflow and ordered steps. The sample statuses are illustrative; verify them against the actual task, spec, PR and integrated implementation before using them:

```json
{
  "schema": "bowerbird/v1", "meta": { "title": "Review flow" },
  "composition": {
    "groups": [{ "id": "delivery", "title": "Delivery", "status": "partial" }],
    "components": [
      { "id": "ship", "title": "Ship", "group": "delivery", "type": "workflow", "purpose": "Coordinate delivery", "status": "planned" },
      { "id": "review", "title": "Review", "group": "delivery", "type": "playbook", "purpose": "Check the change", "status": "built" },
      { "id": "test", "title": "Test", "group": "delivery", "type": "skill", "purpose": "Run checks", "status": "built" }
    ],
    "edges": [{ "from": "ship", "to": "review", "step": 1 }, { "from": "review", "to": "test", "step": 1 }]
  }
}
```

## Render recipe

**Repo-local form:** composition maps are not yet available in a published package version. From this repository root, the following single command validates the checked-in fixture and renders one standalone light HTML file:

```sh
node bin/bowerbird.mjs validate tests/fixtures/composition-repo/map.bower.json && node bin/bowerbird.mjs composition tests/fixtures/composition-repo/map.bower.json --out composition-fixture.html
```

Replace the fixture path and output name with your input and destination. Validation stops the render if the schema is invalid. Rendering reads the input repository's `HEAD` commit and embeds its full SHA and the package version in meta tags and `<html>` data attributes. For an input outside a Git repository, supply `--input-sha` with its real, full 40-character commit SHA; a missing or malformed SHA prevents output. The file has no iframe or external fetches.
