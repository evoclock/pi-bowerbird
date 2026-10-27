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
  assert.deepEqual(Object.keys(JSON.parse(data)).sort(), ["dark", "light", "lightParity"]);
});

test("HTML ships navigation: zoom, fit, fullscreen, minimap", () => {
  const m = load();
  const html = renderHtml(m, layout(m), { light, dark, basename: "bowerbird" });
  for (const id of ["stage", "viewport", "zoom-in", "zoom-out", "zoom-level", "zoom-fit", "fullscreen", "minimap", "minimap-frame"]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
});

// Why: the public CLI and meta must produce the same exact category fill as dark without changing dark or light surfaces.
test("category fill parity applies to light SVG, iso SVG, and HTML without changing dark", async () => {
  const { build } = await import("../lib/export.mjs");
  const { mkdtempSync, mkdirSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const m = load();
  const darkSvg = renderSvg(m, layout(m), { theme: dark });
  const lightSvg = renderSvg(m, layout(m), { theme: light });
  const selector = ".cat-sage .bb-mark,.bb-mark.cat-sage";
  const rule = (svg, sel) => svg.split(`${sel}{`)[1]?.split("}")[0];
  const raw = JSON.parse(readFileSync(new URL("../examples/bowerbird.bower.json", import.meta.url), "utf8"));
  const parity = normalise({ ...raw, meta: { ...raw.meta, categoryFillParity: "dark" } });
  const paritySvg = renderSvg(parity, layout(parity), { theme: light, categoryTheme: dark });
  assert.notEqual(rule(lightSvg, selector), rule(darkSvg, selector));
  for (const sel of [selector, ".cat-sage .bb-node-box", ".bb-zone.cat-sage"]) assert.equal(rule(paritySvg, sel), rule(darkSvg, sel), sel);
  assert.equal(rule(paritySvg, ".bb-canvas"), rule(lightSvg, ".bb-canvas"));
  assert.equal(rule(paritySvg, ".cat-sage .bb-kicker,.cat-sage .bb-zone-kicker"), rule(lightSvg, ".cat-sage .bb-kicker,.cat-sage .bb-zone-kicker"));
  assert.equal(renderSvg(parity, layout(parity), { theme: dark }), darkSvg);
  const iso = isoLayout(parity, layout(parity));
  assert.equal(rule(renderIsoSvg(parity, iso, { theme: light, categoryTheme: dark }), ".cat-sage .iso-roof"), rule(renderIsoSvg(parity, iso, { theme: dark }), ".cat-sage .iso-roof"));
  const html = renderHtml(parity, layout(parity), { light, dark });
  assert.match(html, /id="category-fill-parity"/);
  assert.match(html, /data-category-fill-parity="dark"/);
  mkdirSync(fileURLToPath(new URL("../deprecated/", import.meta.url)), { recursive: true });
  const out = mkdtempSync(fileURLToPath(new URL("../deprecated/parity-out-", import.meta.url)));
  const file = fileURLToPath(new URL("../examples/bowerbird.bower.json", import.meta.url));
  await build(file, { outDir: out, formats: ["svg"], categoryFillParity: "dark" });
  assert.equal(rule(readFileSync(`${out}/bowerbird.light.svg`, "utf8"), selector), rule(darkSvg, selector));
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/bowerbird.mjs", import.meta.url)), "render", file, "--out", out, "--formats", "svg", "--category-fill-parity", "dark"], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(rule(readFileSync(`${out}/bowerbird.light.svg`, "utf8"), selector), rule(darkSvg, selector));
  assert.throws(() => normalise({ ...raw, meta: { ...raw.meta, categoryFillParity: "solid" } }), /categoryFillParity/);
});

test("markdown escapes HTML and drops javascript: links", () => {
  const out = markdown("<b>x</b> [a](javascript:alert(1)) [b](lib/x.mjs)");
  assert.ok(!out.includes("<b>x</b>"));
  assert.ok(!out.includes("javascript:"));
  assert.match(out, /href="lib\/x\.mjs"/);
});
