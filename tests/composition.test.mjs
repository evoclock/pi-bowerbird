import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync, cpSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalise, BowerError } from "../lib/model.mjs";
import { renderComposition, STATUS_COLOURS, GROUP_COLOURS } from "../lib/composition.mjs";

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

// Why: distinct status paints and non-colour cues must survive changes to the SVG renderer.
test("status palette has distinct fills, hatch and dashed outlines", () => {
  const html = renderComposition(input.composition, input.meta.title, golden.sha);
  for (const [status, colour] of Object.entries(STATUS_COLOURS)) {
    assert.match(html, new RegExp(`status-${status === "built" ? "implemented" : status} \\.iso-roof\\{fill:${colour}`));
  }
  assert.equal(new Set(Object.values(STATUS_COLOURS)).size, 3);
  assert.match(html, /status-planned \.iso-face\{stroke-dasharray:5 4/);
  assert.match(html, /status-partial \.iso-hatch line\{stroke:#17212b/);
  assert.throws(() => assert.equal(new Set([STATUS_COLOURS.built, STATUS_COLOURS.partial, STATUS_COLOURS.built]).size, 3));
});

// Why: group paint must be stable, visible and identified in the legend across renders.
test("group palette and legend are deterministic", () => {
  const html = renderComposition(input.composition, input.meta.title, golden.sha);
  assert.equal(html, renderComposition(input.composition, input.meta.title, golden.sha));
  assert.match(html, /aria-label="Map colour legend"/);
  assert.match(html, /<strong>Status<\/strong>/);
  assert.match(html, /<strong>Groups<\/strong>/);
  const colours = input.composition.groups.map((g, i) => {
    const colour = GROUP_COLOURS[i % GROUP_COLOURS.length];
    assert.ok(html.includes(`data-id=${JSON.stringify(g.id)}] .iso-roof{fill:${colour}`));
    assert.ok(html.includes(`background:${colour}`));
    return colour;
  });
  assert.equal(new Set(colours).size, colours.length);
  assert.throws(() => assert.match(html.replace('aria-label="Map colour legend"', ''), /aria-label="Map colour legend"/));
});

// Why: all composition text on explicit white labels and the page must exceed AA contrast.
test("composition label and page text meet WCAG AA", () => {
  const luminance = (hex) => {
    const channels = hex.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16) / 255);
    return channels.map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  };
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  const html = renderComposition(input.composition, input.meta.title, golden.sha);
  assert.match(html, /\.iso-tag-bg,\.iso-label-bg\{fill:#ffffff;fill-opacity:1/);
  assert.match(html, /\.bb-node-title,\.bb-kicker,\.bb-label\{fill:#17212b/);
  assert.ok(ratio("#17212b", "#ffffff") >= 4.5);
  assert.throws(() => assert.ok(ratio("#bbbbbb", "#ffffff") >= 4.5));
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
