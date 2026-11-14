import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync, cpSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalise, BowerError } from "../lib/model.mjs";
import { renderComposition, STATUS_TOKENS, GROUP_TOKENS } from "../lib/composition.mjs";
import { loadTheme } from "../lib/themes.mjs";
import { layout } from "../lib/layout.mjs";
import { isoLayout, renderIsoSvg } from "../lib/render-iso.mjs";

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

// Why: distinct status and group hues, visible legend and non-colour cues must remain stable.
test("theme category names determine status, group and legend colours", () => {
  const html = renderComposition(input.composition, input.meta.title, golden.sha);
  assert.equal(html, renderComposition(input.composition, input.meta.title, golden.sha));
  assert.equal(new Set(Object.values(STATUS_TOKENS)).size, 3);
  assert.match(html, /aria-label="Map colour legend"/);
  assert.match(html, /status-planned \.iso-face\{fill:/);
  assert.match(html, /status-partial \.iso-hatch line\{stroke:/);
  for (const [status, token] of Object.entries(STATUS_TOKENS)) {
    assert.ok(html.includes(`--status-${status}:${themes.light.categories[token]}`));
    assert.ok(html.includes(`--status-${status}:${themes.dark.categories[token]}`));
    assert.ok(html.includes(`cat-${token} status-${status === "built" ? "implemented" : status}`));
  }
  for (const [i, group] of input.composition.groups.entries()) {
    assert.ok(html.includes(`data-id=${JSON.stringify(group.id)}] .iso-roof{fill:${themes.light.categories[GROUP_TOKENS[i]]}`));
    assert.ok(html.includes(`data-id=${JSON.stringify(group.id)}] .iso-roof{fill:${themes.dark.categories[GROUP_TOKENS[i]]}`));
  }
  assert.throws(() => assert.match(html.replace('aria-label="Map colour legend"', ''), /aria-label="Map colour legend"/));
});

// Why: token-based page and tag text must pass WCAG AA in light and dark.
test("composition label and page contrast meets WCAG AA in both themes", () => {
  const html = renderComposition(input.composition, input.meta.title, golden.sha);
  for (const theme of Object.values(themes)) {
    assert.ok(ratio(theme.surfaces.text, theme.surfaces.canvas) >= 4.5);
    assert.ok(ratio(theme.surfaces.muted, theme.surfaces.canvas) >= 4.5);
    assert.ok(html.includes(`fill:${theme.surfaces.canvas};fill-opacity:1`));
    assert.ok(html.includes(`fill:${theme.surfaces.text}`));
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
