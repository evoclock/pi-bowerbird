import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalise, BowerError } from "../lib/model.mjs";
import { layout } from "../lib/layout.mjs";
import { renderSvg } from "../lib/render-svg.mjs";
import { renderHtml } from "../lib/render-html.mjs";
import { loadTheme } from "../lib/themes.mjs";

const source = JSON.parse(readFileSync(new URL("./fixtures/parallel-regions.bower.json", import.meta.url), "utf8"));
const clone = () => structuredClone(source);

test("named regions retain source IDs, failure path, conditions and no-order note in both themes", () => {
  const m = normalise(clone());
  const lay = layout(m);
  assert.deepEqual(lay.warnings, []);
  assert.deepEqual(m.nodes.map((n) => n.id), source.nodes.map((n) => n.id));
  assert.deepEqual(m.edges.map((e) => [e.id, e.from, e.to, e.kind, e.action]), source.edges.map((e) => [e.id, e.from, e.to, e.kind, e.action]));
  assert.deepEqual(lay.regions.map((r) => r.siblings.map((z) => z.title)), [["Intake", "Repair"]]);
  for (const theme of ["light", "dark"]) {
    const svg = renderSvg(m, lay, { theme: loadTheme(theme) });
    const html = renderHtml(m, lay, { light: loadTheme("light"), dark: loadTheme("dark"), defaultTheme: theme });
    for (const output of [svg, html]) {
      assert.match(output, /No execution order implied/);
      assert.match(output, /Intake.*Repair/);
      assert.match(output, /act-retry: timeout \[retry allowed\] \/ retry/);
      assert.match(output, /act-escalate: retries exhausted \[retry denied\] \/ escalate/);
      for (const id of ["receive", "retry", "escalate"]) assert.match(output, new RegExp(`data-id="${id}"`));
      assert.match(output, /data-from="receive" data-to="retry"/);
      assert.match(output, /data-from="receive" data-to="escalate"/);
    }
  }
});

test("parallel regions without a parent, mixed siblings, missing names and deep nesting fail closed", () => {
  const invalid = [
    ["region-parent", (s) => { delete s.zones[1].parent; }],
    ["region-siblings", (s) => { delete s.zones[2].parallel; }],
    ["region-name", (s) => { delete s.zones[1].title; }],
    ["region-empty", (s) => { s.nodes[0].zone = "repair"; }],
    ["group-depth", (s) => { s.zones[0].parent = "intake"; }],
  ];
  for (const [code, change] of invalid) {
    const s = clone(); change(s);
    assert.throws(() => normalise(s), (e) => e instanceof BowerError && e.problems.some((p) => p.code === code), code);
  }
});
