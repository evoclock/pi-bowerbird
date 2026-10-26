import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalise } from "../lib/model.mjs";
import { layout } from "../lib/layout.mjs";
import { renderSvg } from "../lib/render-svg.mjs";
import { renderHtml } from "../lib/render-html.mjs";
import { isoLayout, renderIsoSvg } from "../lib/render-iso.mjs";
import { loadTheme } from "../lib/themes.mjs";
import { markdown } from "../lib/markdown.mjs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const load = () => normalise(JSON.parse(readFileSync(new URL("../examples/bowerbird.bower.json", import.meta.url), "utf8")));
const dark = loadTheme("dark");
const light = loadTheme("light");

test("standalone SVG has no CSS variables and no script (GitHub/librsvg safe)", () => {
  const m = load();
  const svg = renderSvg(m, layout(m), { theme: light, darkTheme: dark, animate: true });
  assert.ok(!svg.includes("var(--"));
  assert.ok(!/<script/i.test(svg));
  assert.match(svg, /prefers-color-scheme:dark/);
  assert.match(svg, /prefers-reduced-motion/);
});

test("restrained is the default and stays minimal: no filters, gradients, or glows", () => {
  const m = load();
  assert.equal(m.meta.style, "restrained");
  for (const svg of [renderSvg(m, layout(m), { theme: dark, animate: true }), renderIsoSvg(m, isoLayout(m, layout(m)), { theme: dark })]) {
    for (const banned of ["<filter", "Gradient", "bb-edge-glow", "bb-bg-glow", "bb-node-wash", "iso-bevel"]) {
      assert.ok(!svg.includes(banned), `restrained output contains ${banned}`);
    }
  }
});

test("expressive remains available as an explicit style", () => {
  const m = normalise({ ...JSON.parse(readFileSync(new URL("../examples/bowerbird.bower.json", import.meta.url), "utf8")), meta: { ...load().meta, style: "expressive" } });
  const svg = renderSvg(m, layout(m), { theme: dark });
  assert.ok(svg.includes("<filter") && svg.includes("bb-edge-glow"));
  assert.throws(() => normalise({ schema: "bowerbird/v1", meta: { title: "t", style: "baroque" }, nodes: [], edges: [] }), /style/);
});

test("fonts are embedded only on request", async () => {
  const { build } = await import("../lib/export.mjs");
  const { mkdirSync, mkdtempSync, readFileSync: read } = await import("node:fs");
  mkdirSync(new URL("../deprecated/", import.meta.url), { recursive: true });
  const out = mkdtempSync(fileURLToPath(new URL("../deprecated/test-out-", import.meta.url)));
  const file = fileURLToPath(new URL("../examples/pi-packages.bower.json", import.meta.url));
  await build(file, { outDir: out, formats: ["svg"] });
  assert.ok(!read(`${out}/pi-packages.dark.svg`, "utf8").includes("@font-face"));
});

test("planned nodes get no flow animation", () => {
  const m = load();
  const svg = renderSvg(m, layout(m), { theme: dark, animate: true });
  const flows = svg.match(/class="bb-flow/g) ?? [];
  const animatable = m.edges.filter((e) => e.kind !== "failure" && !["pages"].includes(e.to) && !["pages"].includes(e.from));
  assert.equal(flows.length, animatable.length);
});

test("iso SVG renders every node as a slab", () => {
  const m = load();
  const svg = renderIsoSvg(m, isoLayout(m, layout(m)), { theme: dark });
  assert.equal((svg.match(/class="iso-face iso-roof"/g) ?? []).length, m.nodes.length);
  assert.equal((svg.match(/class="iso-hatch"/g) ?? []).length, m.nodes.filter((n) => n.status === "partial").length);
});

test("HTML keeps details as real <details> cards and rewrites repo links", () => {
  const m = load();
  const html = renderHtml(m, layout(m), { light, dark, repoRoot: "/r", outDir: "/r/docs/diagrams", basename: "bowerbird" });
  assert.equal((html.match(/<details class="card"/g) ?? []).length, m.nodes.length);
  assert.match(html, /href="\.\.\/\.\.\/lib\/model\.mjs"/);
  assert.match(html, /family=Geist/);
});

test("HTML client script is valid JavaScript", () => {
  const m = load();
  const html = renderHtml(m, layout(m), { light, dark, basename: "bowerbird" });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0]));
  const data = html.match(/<script type="application\/json" id="bb-standalone-css">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(Object.keys(JSON.parse(data)).sort(), ["dark", "light"]);
});

test("HTML ships navigation: zoom, fit, fullscreen, minimap", () => {
  const m = load();
  const html = renderHtml(m, layout(m), { light, dark, basename: "bowerbird" });
  for (const id of ["stage", "viewport", "zoom-in", "zoom-out", "zoom-level", "zoom-fit", "fullscreen", "minimap", "minimap-frame"]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
});

test("markdown escapes HTML and drops javascript: links", () => {
  const out = markdown("<b>x</b> [a](javascript:alert(1)) [b](lib/x.mjs)");
  assert.ok(!out.includes("<b>x</b>"));
  assert.ok(!out.includes("javascript:"));
  assert.match(out, /href="lib\/x\.mjs"/);
});
