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
  assert.ok(!read(`${out}/pi-packages.flat.dark.svg`, "utf8").includes("@font-face"));
  assert.ok(!read(`${out}/pi-packages.iso.dark.svg`, "utf8").includes("@font-face"));
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
  assert.deepEqual(Object.keys(JSON.parse(data)).sort(), ["dark", "light", "lightFilled"]);
});

test("HTML ships navigation: zoom, fit, fullscreen, minimap", () => {
  const m = load();
  const html = renderHtml(m, layout(m), { light, dark, basename: "bowerbird" });
  for (const id of ["stage", "viewport", "zoom-in", "zoom-out", "zoom-level", "zoom-fit", "fullscreen", "minimap", "minimap-frame"]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
});

// Why: flat light cards must be neutral in dots mode, and filled cards must use the iso block palette without changing dark or iso.
test("light flat dots-only and filled are distinct, dark and iso stay fixed", () => {
  const m = load();
  const raw = JSON.parse(readFileSync(new URL("../examples/bowerbird.bower.json", import.meta.url), "utf8"));
  const filled = normalise({ ...raw, meta: { ...raw.meta, lightFlatFill: "filled" } });
  const rule = (svg, sel) => svg.split(`${sel}{`).at(-1) === svg ? undefined : svg.split(`${sel}{`).at(-1).split("}")[0];
  const dotsSvg = renderSvg(m, layout(m), { theme: light });
  const filledSvg = renderSvg(filled, layout(filled), { theme: light });
  const darkSvg = renderSvg(m, layout(m), { theme: dark });
  const card = ".cat-sage .bb-node-box";
  const dot = ".cat-sage .bb-mark,.bb-mark.cat-sage";
  assert.equal(rule(dotsSvg, card), undefined, "dots-only cards inherit the neutral light panel");
  const neutral = dotsSvg.split("\n.bb-node-box{").at(-1)?.split("}")[0];
  assert.match(neutral, /fill:/);
  assert.match(rule(dotsSvg, dot), /fill:#[0-9a-f]{6}/);
  assert.notEqual(rule(filledSvg, card), neutral);
  const isoLight = renderIsoSvg(m, isoLayout(m, layout(m)), { theme: light });
  assert.equal(rule(filledSvg, card).split(";")[0], rule(isoLight, ".cat-sage .iso-roof").split(";")[0]);
  assert.equal(rule(dotsSvg, dot), rule(filledSvg, dot), "indicator dots do not change");
  assert.equal(rule(dotsSvg, ".bb-canvas"), rule(filledSvg, ".bb-canvas"));
  assert.equal(renderSvg(filled, layout(filled), { theme: dark }), darkSvg);
  const iso = isoLayout(m, layout(m));
  assert.equal(renderIsoSvg(filled, iso, { theme: light }), renderIsoSvg(m, iso, { theme: light }));
  assert.equal(renderIsoSvg(filled, iso, { theme: dark }), renderIsoSvg(m, iso, { theme: dark }));
  const html = renderHtml(filled, layout(filled), { light, dark });
  assert.match(html, /id="light-flat-fill"[^>]*>Filled nodes/);
  assert.match(html, /data-light-flat-fill="filled"/);
  assert.throws(() => normalise({ ...raw, meta: { ...raw.meta, lightFlatFill: "neon" } }), /lightFlatFill/);
  assert.throws(() => normalise({ ...raw, meta: { ...raw.meta, categoryFillParity: "dark" } }), /no longer supported/);
});

// Why: every entry point must ship both views by default, while an explicit --view stays a single-view opt-out.
test("build and CLI render default to dual output and honor explicit view", async () => {
  const { build } = await import("../lib/export.mjs");
  const { mkdtempSync, mkdirSync, existsSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { embedSnippets } = await import("../lib/snippets.mjs");
  const scratch = fileURLToPath(new URL("../deprecated/", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const out = mkdtempSync(fileURLToPath(new URL("../deprecated/dual-out-", import.meta.url)));
  const file = fileURLToPath(new URL("../examples/bowerbird.bower.json", import.meta.url));
  const result = await build(file, { outDir: out, formats: ["html", "svg"] });
  for (const view of ["flat", "iso"]) for (const ext of ["html", "dark.svg", "light.svg"]) assert.ok(existsSync(`${out}/bowerbird.${view}.${ext}`), `${view}.${ext}`);
  assert.equal(result.written.length, 8);
  assert.match(embedSnippets(file, { outDir: out, repoRoot: out }), /bowerbird.flat.dark.svg/);
  assert.match(embedSnippets(file, { outDir: out, repoRoot: out }), /bowerbird.iso.html/);
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/bowerbird.mjs", import.meta.url)), "render", file, "--out", out, "--formats", "svg", "--light-flat-fill", "filled"], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  for (const view of ["flat", "iso"]) assert.ok(existsSync(`${out}/bowerbird.${view}.light.svg`));
  const single = await build(file, { outDir: mkdtempSync(fileURLToPath(new URL("../deprecated/single-out-", import.meta.url))), formats: ["svg"], view: "iso" });
  assert.equal(single.written.length, 3);
  assert.ok(single.written.every((p) => !p.includes(".flat.")));
  const cliSingleOut = mkdtempSync(fileURLToPath(new URL("../deprecated/cli-single-out-", import.meta.url)));
  const cliSingle = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/bowerbird.mjs", import.meta.url)), "render", file, "--out", cliSingleOut, "--formats", "svg", "--view", "flat"], { encoding: "utf8" });
  assert.equal(cliSingle.status, 0, cliSingle.stderr);
  assert.ok(existsSync(`${cliSingleOut}/bowerbird.light.svg`));
  assert.ok(!existsSync(`${cliSingleOut}/bowerbird.iso.light.svg`));
});

test("markdown escapes HTML and drops javascript: links", () => {
  const out = markdown("<b>x</b> [a](javascript:alert(1)) [b](lib/x.mjs)");
  assert.ok(!out.includes("<b>x</b>"));
  assert.ok(!out.includes("javascript:"));
  assert.match(out, /href="lib\/x\.mjs"/);
});
