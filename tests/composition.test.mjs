import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync, cpSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalise, BowerError } from "../lib/model.mjs";
import { renderComposition, GROUP_TOKENS } from "../lib/composition.mjs";
import { loadTheme } from "../lib/themes.mjs";
import { layout } from "../lib/layout.mjs";
import { isoCss, isoLayout, renderIsoSvg } from "../lib/render-iso.mjs";
import { paintCss } from "../lib/paint.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(root, "fixtures/composition-repo");
const input = JSON.parse(readFileSync(path.join(fixture, "map.bower.json")));
const golden = JSON.parse(readFileSync(path.join(fixture, "golden.json")));
const cli = path.join(root, "../bin/bowerbird.mjs");
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

// Why: the composition contract must fail before any output can be written.
test("rejects invalid status, group, endpoint, type and step", () => {
  const cases = [
    ["composition-status", (c) => { c.groups[0].status = "unknown"; }],
    ["composition-status", (c) => { delete c.components[0].status; }],
    ["composition-id", (c) => { c.components[0] = null; }],
    ["composition-group", (c) => { c.components[0].group = "missing"; }],
    ["composition-endpoint", (c) => { c.edges[0].to = "missing"; }],
    ["composition-type", (c) => { c.edges[0].to = "test"; }],
    ["composition-step", (c) => { c.edges[1].step = 1; }],
    ["composition-group-palette", (c) => { for (let i = 0; i < 7; i++) c.groups.push({ id: `extra-${i}`, title: `Extra ${i}`, status: "built" }); }],
  ];
  for (const [code, mutate] of cases) {
    const doc = structuredClone(input); mutate(doc.composition);
    assert.throws(() => normalise(doc), (e) => e instanceof BowerError && e.problems.some((p) => p.code === code), code);
  }
});

// Why: the public CLI must emit the checked-in fixture's exact provenance and iso content.
test("single-file golden has exact markers and group and component slabs", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "bb-composition-"));
  try {
    const out = path.join(tmp, "map.html");
    const r = run("composition", path.join(fixture, "map.bower.json"), "--out", out, "--input-sha", golden.sha);
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(out, "utf8");
    assert.equal(html, readFileSync(path.join(fixture, "golden.html"), "utf8"), "checked-in CLI golden output");
    assert.equal((html.match(/<meta name="generator"/g) ?? []).length, 1);
    assert.equal((html.match(/<meta name="bowerbird-input-sha"/g) ?? []).length, 1);
    assert.match(html, new RegExp(`<meta name="generator" content="bowerbird ${golden.version}">`));
    assert.match(html, new RegExp(`<meta name="bowerbird-input-sha" content="${golden.sha}">`));
    assert.match(html, new RegExp(`<html[^>]+data-bowerbird-version="${golden.version}"[^>]+data-bowerbird-input-sha="${golden.sha}"`));
    assert.doesNotMatch(html, /<iframe|<link |\bfetch\s*\(/);
    for (const id of golden.groups) assert.match(html, new RegExp(`data-id="${id}"`));
    for (const id of golden.components) assert.match(html, new RegExp(`data-id="${id}"`));
    assert.match(html, /iso-roof/);
    assert.match(html, /3 · B2 P0 L1 · BUILT/);
    assert.match(html, /1 · B0 P1 L0 · PARTIAL/);
    assert.match(html, /B built, P partial, L planned/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

const colors = (html) => new Set((html.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((value) => value.toLowerCase()));
const themes = { light: loadTheme("light"), dark: loadTheme("dark") };
const ratio = (a, b) => {
  const lum = (hex) => hex.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  return (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
};

// Why: both themes must use only the package's token values or its existing iso-derived palette.
test("all composition colours come from existing theme and iso paint", () => {
  const source = JSON.parse(readFileSync(path.join(root, "../examples/bowerbird.bower.json")));
  source.categories = Object.fromEntries(Object.keys(themes.light.categories).map((id) => [id, { label: id }]));
  source.meta.style = "expressive";
  const model = normalise(source);
  const baseline = renderIsoSvg(model, isoLayout(model, layout(model)), { themes });
  const allowed = colors(baseline);
  for (const theme of Object.values(themes)) for (const section of [theme.surfaces, theme.edges, theme.categories]) {
    for (const value of Object.values(section)) allowed.add(value.toLowerCase());
  }
  const check = (html) => assert.deepEqual([...colors(html)].filter((value) => !allowed.has(value)), []);
  const html = renderComposition(input.composition, input.meta.title, golden.sha);
  check(html);
  assert.match(html, /html\[data-theme=light\]/);
  assert.match(html, /html\[data-theme=dark\]/);
  // Deliberate break: a new, non-token fill must fail the same collector.
  assert.throws(() => check(html + '<path fill="#' + '123abc"/>'));
});

// Why: composition must reuse the existing iso and paint builders byte for byte.
test("category faces, gradients and status opacities match the ordinary expressive iso render", () => {
  const source = JSON.parse(readFileSync(path.join(root, "../examples/bowerbird.bower.json")));
  source.meta.style = "expressive";
  source.categories = Object.fromEntries(GROUP_TOKENS.map((id) => [id, { label: id }]));
  const model = normalise(source);
  const ordinary = renderIsoSvg(model, isoLayout(model, layout(model)), { themes });
  const composition = renderComposition(input.composition, input.meta.title, golden.sha);
  const expected = [];
  for (const [name, theme] of Object.entries(themes)) {
    const scope = `html[data-theme=${name}]`;
    const faceRules = isoCss(theme, model.categories, scope);
    const paintRules = paintCss(theme, model.categories, scope, { iso: true });
    for (const token of GROUP_TOKENS) {
      for (const face of ["iso-roof", "iso-left", "iso-right"]) {
        const rule = faceRules.split("\n").find((line) => line.startsWith(`${scope} .cat-${token} .${face}{`));
        assert.ok(rule, `${token} ${face}`);
        expected.push(rule);
      }
    }
    const stroke = faceRules.split("\n").find((line) => line.startsWith(`${scope} .cat-${GROUP_TOKENS[0]} .iso-roof{`));
    assert.match(stroke, /;stroke:/);
    expected.push(paintRules.split("\n").find((line) => line.startsWith(`${scope} .cat-${GROUP_TOKENS[0]} .iso-roof{`)));
  }
  expected.push(".bb-node.status-planned .iso-face{fill-opacity:.06;stroke-dasharray:5 4;stroke-width:1.3}");
  expected.push(".iso-hatch line{stroke-width:1;opacity:.35}");
  const check = (text) => { for (const rule of expected) { assert.ok(ordinary.includes(rule), rule); assert.ok(text.includes(rule), rule); } };
  check(composition);
  // Deliberate break: alter a builder's face rule in composition only.
  assert.throws(() => check(composition.replace(expected[0], expected[0].replace("fill:", "fill:broken-"))));
});

// Why: status treatment is neutral: no status-bearing component may carry category colour.
test("status treatment uses surfaces and edges, never category hues", () => {
  const html = renderComposition(input.composition, input.meta.title, golden.sha);
  const panelMaps = html.match(/<section class="panel"[\s\S]*?<\/svg>/g) ?? [];
  assert.equal(panelMaps.length, input.composition.groups.length);
  const check = (map) => {
    assert.doesNotMatch(map, /cat-(?:sage|rust|peach|mustard|slate|mauve|teal|olive)/);
    assert.doesNotMatch(map, /--status-(?:built|partial|planned)/);
    const statusRules = map.match(/\.[^{}\n]*status-(?:implemented|partial|planned)[^{}]*\{[^}]*\}/g) ?? [];
    assert.ok(statusRules.length);
    for (const theme of Object.values(themes)) for (const colour of Object.values(theme.categories)) {
      for (const rule of statusRules) assert.ok(!colors(rule).has(colour.toLowerCase()), `status rule must not contain category token ${colour}`);
    }
  };
  for (const map of panelMaps) check(map);
  assert.match(html, /status-planned \.iso-face\{fill-opacity:\.06;stroke-dasharray:5 4/);
  assert.match(html, /\.iso-hatch line\{stroke-width:1;opacity:\.35/);
  for (const status of ["BUILT", "PARTIAL", "PLANNED"]) assert.match(html, new RegExp(`· ${status}<`));
  // Deliberate break: assigning a category to a status-bearing slab fails.
  assert.throws(() => check(panelMaps[0].replace('class="bb-node map-item', 'class="bb-node cat-sage map-item')));
  assert.throws(() => check(panelMaps[0] + `.bb-node.status-planned .iso-roof{fill:${themes.light.categories.sage}}`));
});

// Why: every group swatch needs a unique theme hue and the group's visible name.
test("group colours are unique, labelled and deterministic", () => {
  const html = renderComposition(input.composition, input.meta.title, golden.sha);
  assert.equal(html, renderComposition(input.composition, input.meta.title, golden.sha));
  assert.equal(new Set(GROUP_TOKENS).size, 8);
  assert.match(html, /aria-label="Map colour legend"/);
  const legend = html.match(/<aside class="composition-legend"[\s\S]*?<\/aside>/)?.[0] ?? "";
  const check = (text) => {
    for (const [i, group] of input.composition.groups.entries()) {
      assert.ok(text.includes(`class="swatch group-${i}"`));
      assert.ok(text.includes(`>${group.title}</span>`), `missing group label ${group.title}`);
      assert.ok(html.includes(`cat-${GROUP_TOKENS[i]}`));
      for (const [name, theme] of Object.entries(themes)) assert.ok(html.includes(`html[data-theme=${name}] .swatch.group-${i}{background:${theme.categories[GROUP_TOKENS[i]]}`));
    }
  };
  check(legend);
  assert.throws(() => check(legend.replace('>Planning</span>', '></span>')));
  assert.match(legend, /<strong>Status<\/strong>/);
  assert.match(legend, /status-built/);
  assert.match(legend, /status-partial/);
  assert.match(legend, /status-planned/);
});

// Why: token-based page and tag text must pass WCAG AA in light and dark.
test("composition label and page contrast meets WCAG AA in both themes", () => {
  const html = renderComposition(input.composition, input.meta.title, golden.sha);
  for (const theme of Object.values(themes)) {
    assert.ok(ratio(theme.surfaces.text, theme.surfaces.canvas) >= 4.5);
    assert.ok(ratio(theme.surfaces.muted, theme.surfaces.canvas) >= 4.5);
    assert.ok(html.includes(`--bg:${theme.surfaces.canvas}`));
    assert.ok(html.includes(`--ink:${theme.surfaces.text}`));
  }
  assert.match(html, /\.is-dimmed\{opacity:\.12\}/);
});

// Why: malformed provenance must not leave even an empty destination.
test("rejects a short SHA without writing and resolves HEAD of input repo", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "bb-composition-"));
  try {
    cpSync(path.join(fixture, "map.bower.json"), path.join(tmp, "map.bower.json"));
    const out = path.join(tmp, "out.html");
    assert.notEqual(run("composition", path.join(tmp, "map.bower.json"), "--out", out, "--input-sha", "short").status, 0);
    assert.equal(existsSync(out), false);
    execFileSync("git", ["init", "-q", tmp]);
    execFileSync("git", ["-C", tmp, "add", "map.bower.json"]);
    execFileSync("git", ["-C", tmp, "commit", "-qm", "fixture"], { env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_COMMITTER_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
    const head = execFileSync("git", ["-C", tmp, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    assert.equal(run("composition", path.join(tmp, "map.bower.json"), "--out", out).status, 0);
    assert.match(readFileSync(out, "utf8"), new RegExp(`data-bowerbird-input-sha="${head}"`));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// Why: changing interaction handlers must fail tests instead of leaving inert SVG markup.
test("drill-down and workflow highlights are required behaviours", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "bb-composition-"));
  try {
    const out = path.join(tmp, "map.html");
    assert.equal(run("composition", path.join(fixture, "map.bower.json"), "--out", out, "--input-sha", golden.sha).status, 0);
    const html = readFileSync(out, "utf8");
    const drill = (text) => { assert.match(text, /function openGroup\(/); assert.match(text, /if \(panel\.dataset\.group === id\) panel\.hidden = false/); };
    const highlight = (text) => { assert.match(text, /function highlightWorkflow\(/); assert.match(text, /node\.classList\.toggle\("is-dimmed"/); };
    drill(html); highlight(html);
    assert.throws(() => drill(html.replace("if (panel.dataset.group === id) panel.hidden = false", "if (panel.dataset.group === id) panel.hidden = true")));
    assert.throws(() => highlight(html.replace('node.classList.toggle("is-dimmed"', 'node.classList.toggle("is-muted"')));
    for (const id of golden.chain) assert.match(html, new RegExp(`data-chain="[^"]*${id}`));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
