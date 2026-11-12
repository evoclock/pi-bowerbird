import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalise, BowerError, statusSummary } from "../lib/model.mjs";
import { evidenceExtension } from "../lib/evidence.mjs";
import { layout } from "../lib/layout.mjs";
import { renderSvg } from "../lib/render-svg.mjs";
import { renderHtml } from "../lib/render-html.mjs";
import { loadTheme } from "../lib/themes.mjs";
import { syncFile } from "../lib/status.mjs";
import { loadDiagram } from "../lib/export.mjs";
import { isoLayout, renderIsoSvg } from "../lib/render-iso.mjs";

const mixed = {
  schema: "bowerbird/v1", meta: { title: "Grouped rule evidence", statusTracking: true },
  nodes: [
    { id: "group-a", title: "Group A", at: [0, 0], status: "implemented", evidence: { marks: [
      { kind: "breaks", label: "Rule A", trace: "https://example.org/trace#a" },
      { kind: "assumed", label: "Join {unproved}" },
      { kind: "repeats", label: "Route 2" },
    ] } },
    { id: "group-b", title: "Group B", at: [1, 0], status: "planned", evidence: { marks: [
      { kind: "mayBreak", label: "Rule B", trace: "records/b.json" },
      { kind: "bugPath", label: "Loop <script>" },
      { kind: "unchecked", label: "No check yet" },
    ] } },
  ], edges: [],
};
const model = () => normalise(mixed, { extensions: [evidenceExtension] });

test("mixed marks keep distinct grouped rule labels and build status", () => {
  const m = model(), lay = layout(m);
  assert.deepEqual(statusSummary(m), { implemented: 1, partial: 0, planned: 1, untracked: 0 });
  const light = loadTheme("light"), dark = loadTheme("dark");
  for (const theme of [light, dark]) {
    const svg = renderSvg(m, lay, { theme });
    for (const label of ["BREAKS: Rule A", "MAY BREAK: Rule B", "BUG PATH: Loop", "REPEATS: Route 2", "ASSUMED: Join", "UNCHECKED: No check yet"]) assert.ok(svg.includes(label), label);
    assert.match(svg, /href="https:\/\/example.org\/trace#a"/);
    assert.match(svg, /Loop &lt;script&gt;/);
    assert.doesNotMatch(svg, /class="[^"]*has-finding/);
    assert.match(svg, /status-implemented/);
  }
  const html = renderHtml(m, lay, { light, dark });
  assert.match(html, /aria-label="Supplied evidence"/);
  assert.match(html, /href="records\/b.json"/);
  assert.match(html, /tabindex="0" role="button"/);
  assert.match(html, /e.key === "Enter" \|\| e.key === " "/);
});

test("the diagram loader registers evidence for flat and isometric views", () => {
  const m = loadDiagram(new URL("./fixtures/evidence.bower.json", import.meta.url));
  const iso = renderIsoSvg(m, isoLayout(m, layout(m)), { theme: loadTheme("dark") });
  assert.match(iso, /BREAKS: Rule A/);
  assert.match(iso, /MAY BREAK: Rule B/);
});

test("unsafe links and malformed supplied marks fail validation", () => {
  for (const trace of ["javascript:alert(1)", "data:text/html,bad", "//evil.test", "../secret", "https://example.org/\" onclick=\"bad"]) {
    const input = structuredClone(mixed);
    input.nodes[0].evidence.marks[0].trace = trace;
    assert.throws(() => normalise(input, { extensions: [evidenceExtension] }), (e) => e instanceof BowerError && e.problems.some((p) => p.code === "evidence-trace"), trace);
  }
  const input = structuredClone(mixed);
  input.nodes[0].evidence.marks[0].kind = "invented";
  assert.throws(() => normalise(input, { extensions: [evidenceExtension] }), /evidence-kind/);
});

test("status sync preserves supplied evidence bytes while updating status", () => {
  const scratch = path.resolve(".local");
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(path.join(scratch, "bower-evidence-"));
  const file = path.join(dir, "input.bower.json");
  const evidence = '{"paths":["lib/a.mjs"],  "tests":["tests/a.test.mjs"], "marks": [{ "kind":"breaks", "label":"Rule { A }"}]}';
  writeFileSync(file, `{"schema":"bowerbird/v1","meta":{"title":"Sync"},"nodes":[{"id":"a","title":"A","at":[0,0],"status":"planned","evidence":${evidence}}],"edges":[]}`);
  const result = syncFile(file, { facts: { merged: new Set(["lib/a.mjs", "tests/a.test.mjs"]), tracked: new Set() } });
  assert.equal(result.changes[0].to, "implemented");
  const updated = readFileSync(file, "utf8");
  assert.ok(updated.includes(`"evidence": ${evidence}`));
  assert.equal(JSON.parse(updated).nodes[0].status, "implemented");
});
