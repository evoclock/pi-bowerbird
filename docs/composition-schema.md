# Composition map schema

A `bowerbird/v1` file may include an optional `composition` object with `groups`, `components`, and `edges` arrays. Existing diagrams without `composition` remain valid and render as before.

Each group has a unique `id`, a `title`, and an explicit `status`. Each component has a unique `id` across groups and components, a `title`, a `group` referencing a group ID, a `type`, a one-line `purpose`, and an explicit `status`. Status is `built`, `partial`, or `planned`; no status is inferred. Component types are `skill`, `recipe`, `playbook`, and `workflow`.

Each edge has `from`, `to`, and a positive integer `step` unique to its source. A workflow chains playbooks; a playbook or recipe runs skills. Steps define the order. The overview shows group counts and status badges; opening a group reveals its isometric map. Choosing a workflow highlights its playbook and skill sequence.

## Render recipe

**Repo-local form:** composition maps on this branch are not yet available in a published package version. From this repository root, the following single command validates the checked-in fixture and renders one standalone light HTML file:

```sh
node bin/bowerbird.mjs validate tests/fixtures/composition-repo/map.bower.json && node bin/bowerbird.mjs composition tests/fixtures/composition-repo/map.bower.json --out composition-fixture.html
```

Replace the fixture path and output name with your input and destination. Validation stops the render if the schema is invalid. Rendering reads the input repository's `HEAD` commit and embeds its full SHA and the package version in meta tags and `<html>` data attributes. For an input outside a Git repository, supply `--input-sha` with its real, full 40-character commit SHA; a missing or malformed SHA prevents output. The file has no iframe or external fetches.
