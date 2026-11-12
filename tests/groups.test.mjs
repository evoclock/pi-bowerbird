import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalise, BowerError } from "../lib/model.mjs";
import { layout } from "../lib/layout.mjs";
import { renderSvg } from "../lib/render-svg.mjs";
import { renderHtml } from "../lib/render-html.mjs";
import { loadTheme } from "../lib/themes.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.bower.json`, import.meta.url), "utf8"));

// Why: boundaries must not rewrite executable state or failure transitions.
test("parent zone wraps two child zones without changing actions, IDs or failure order", () => {
  const source = fixture("nested-groups");
  const m = normalise(source);
  const lay = layout(m);
  assert.deepEqual(lay.warnings, []);
  assert.deepEqual(m.nodes.map((n) => n.id), source.nodes.map((n) => n.id));
  assert.deepEqual(m.edges.map((e) => [e.id, e.action, e.kind, e.index]), [["act-retry", "retry", "failure", 0]]);
  assert.deepEqual(lay.groups.map((g) => g.id), ["recovery"]);
  const group = lay.groups[0].rect;
  for (const child of lay.zones) {
    assert.ok(child.rect.x > group.x && child.rect.y > group.y);
    assert.ok(child.rect.x + child.rect.w < group.x + group.w);
    assert.ok(child.rect.y + child.rect.h < group.y + group.h);
  }
  for (const theme of ["light", "dark"]) {
    const t = loadTheme(theme);
    const svg = renderSvg(m, lay, { theme: t });
    const html = renderHtml(m, lay, { light: loadTheme("light"), dark: loadTheme("dark"), defaultTheme: theme });
    for (const output of [svg, html]) {
      assert.match(output, /data-group="recovery"/);
      assert.match(output, /data-id="receive"/);
      assert.match(output, /data-id="retry"/);
      assert.match(output, /data-from="receive" data-to="retry"/);
      assert.match(output, /class="bb-edge failure map-item"/);
    }
  }
});

// Why: a second parent level would imply unsupported hierarchy semantics.
test("deeper nesting fails validation with a clear code", () => {
  assert.throws(() => normalise(fixture("nested-groups-too-deep")), (e) => e instanceof BowerError && e.problems.some((p) => p.code === "group-depth"));
});
