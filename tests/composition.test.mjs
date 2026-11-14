import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalise, BowerError } from "../lib/model.mjs";
import { loadTheme } from "../lib/themes.mjs";
import { projectComposition } from "../lib/composition.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputFile = path.join(root, "examples/bowerbird.bower.json");
const input = JSON.parse(readFileSync(inputFile, "utf8"));
const cli = path.join(root, "bin/bowerbird.mjs");
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
const sha = "0123456789abcdef0123456789abcdef01234567";
const styles = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const text = (file) => readFileSync(file, "utf8");

// Why: the same input must produce the package's ordinary page CSS and accent.
test("composition page styles and accent equal ordinary bowerbird render", () => {
  const out = mkdtempSync(path.join(os.tmpdir(), "bb-composition-"));
  const reference = mkdtempSync(path.join(os.tmpdir(), "bb-render-"));
  const result = run("composition", inputFile, "--out", out, "--input-sha", sha);
  assert.equal(result.status, 0, result.stderr);
  for (const name of ["overview", ...input.composition.groups.map((g) => `group-${g.id}`)]) {
    const source = path.join(out, `${name}.bower.json`);
    assert.equal(run("render", source, "--out", reference, "--formats", "html,svg").status, 0);
    for (const view of ["flat", "iso"]) {
      const actual = text(path.join(out, `${name}.${view}.html`));
      const expected = text(path.join(reference, `${name}.${view}.html`));
      const check = (candidate) => assert.deepEqual(styles(candidate), styles(expected));
      check(actual);
      assert.match(actual, /--accent:/);
      assert.ok(actual.includes(`--accent:${loadTheme("light").categories.sage}`));
      for (const id of ["theme", "export", "minimap", "zoom-fit", "drawer"]) assert.match(actual, new RegExp(`id="${id}"`));
      // Deliberate break: changing one page colour rule must fail byte parity.
      assert.throws(() => check(actual.replace("--accent:", "--accent:changed-")));
    }
  }
});

// Why: group SVGs must be ordinary render output, not a composition-owned paint path.
test("each group SVG equals ordinary bowerbird render byte for byte", () => {
  const out = mkdtempSync(path.join(os.tmpdir(), "bb-composition-"));
  const reference = mkdtempSync(path.join(os.tmpdir(), "bb-render-"));
  assert.equal(run("composition", inputFile, "--out", out, "--input-sha", sha).status, 0);
  for (const group of input.composition.groups) {
    const name = `group-${group.id}`;
    assert.equal(run("render", path.join(out, `${name}.bower.json`), "--out", reference, "--formats", "html,svg").status, 0);
    for (const view of ["flat", "iso"]) {
      const expected = text(path.join(reference, `${name}.${view}.svg`));
      const actual = text(path.join(out, `${name}.${view}.svg`));
      const check = (candidate) => assert.equal(candidate, expected);
      check(actual);
      assert.throws(() => check(actual.replace("<svg ", "<svg altered ")));
    }
  }
});

// Why: a custom shell or layout literal would reintroduce the rejected aesthetic.
test("composition source contains no CSS, colour literals, px sizes or layout grid", () => {
  const source = text(path.join(root, "lib/composition.mjs"));
  const check = (candidate) => assert.doesNotMatch(candidate, /<style|\bcss\b|#[0-9a-fA-F]{3,8}\b|\d+px\b|\bgrid\b|\bat\s*:\s*\[\s*\d/i);
  check(source);
  // Deliberate breaks: each forbidden class must trip the same guard.
  for (const addition of ["<style>", "#123abc", "12px", "grid", "at:[1,0]"]) assert.throws(() => check(source + addition));
});

// Why: authored coordinates/categories survive projection and the package handles navigation.
test("composition preserves input placement, palette and linked group detail pages", () => {
  const { overview, groups } = projectComposition(input, "overview.iso.html", (g) => `group-${g.id}.iso.html`);
  assert.deepEqual(overview.categories, input.categories);
  assert.deepEqual(overview.meta.grid, input.meta.grid);
  for (const group of input.composition.groups) {
    const page = groups.find((entry) => entry.id === group.id).model;
    assert.deepEqual(page.categories, input.categories);
    assert.deepEqual(page.meta.grid, input.meta.grid);
    for (const node of page.nodes) {
      const original = input.nodes.find((item) => item.id === node.id);
      assert.deepEqual(node.at, original.at);
      assert.equal(node.category, original.category);
    }
    assert.match(page.nodes[0].details, /Back to overview/);
    assert.match(overview.nodes.find((node) => node.id === group.id).details, new RegExp(`group-${group.id}\\.iso\\.html`));
  }
  const out = mkdtempSync(path.join(os.tmpdir(), "bb-composition-"));
  assert.equal(run("composition", inputFile, "--out", out, "--input-sha", sha).status, 0);
  assert.match(text(path.join(out, "overview.iso.html")), /href="group-author\.iso\.html"/);
  assert.match(text(path.join(out, "group-author.iso.html")), /href="overview\.iso\.html"/);
});

// Why: a layout-free composition cannot silently acquire a synthetic grid.
test("composition rejects missing authored placement before output", () => {
  const source = structuredClone(input);
  delete source.nodes.find((n) => n.id === source.composition.components[0].id).at;
  const dir = mkdtempSync(path.join(os.tmpdir(), "bb-composition-"));
  const file = path.join(dir, "map.bower.json");
  const out = path.join(dir, "missing");
  writeFileSync(file, JSON.stringify(source));
  assert.throws(() => normalise(source), (e) => e instanceof BowerError && e.problems.some((p) => p.code === "node-at"));
  const result = run("composition", file, "--out", out, "--input-sha", sha);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /node-at/);
  assert.equal(existsSync(out), false);
});

// Why: malformed provenance must fail without creating a page.
test("composition rejects a short input SHA", () => {
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), "bb-composition-")), "invalid");
  assert.notEqual(run("composition", inputFile, "--out", out, "--input-sha", "short").status, 0);
  assert.equal(existsSync(out), false);
});

// Why: the version and SHA must survive the projection and reach every HTML page.
test("composition exposes input SHA and package version on all pages", () => {
  const out = mkdtempSync(path.join(os.tmpdir(), "bb-composition-"));
  assert.equal(run("composition", inputFile, "--out", out, "--input-sha", sha).status, 0);
  const version = JSON.parse(text(path.join(root, "package.json"))).version;
  const verify = (html) => {
    assert.match(html, new RegExp(`<meta name="generator" content="bowerbird ${version.replaceAll(".", "\\.")}">`));
    assert.match(html, new RegExp(`<meta name="bowerbird-input-sha" content="${sha}">`));
    assert.match(html, new RegExp(`<html [^>]*data-bowerbird-version="${version.replaceAll(".", "\\.")}"[^>]*data-bowerbird-input-sha="${sha}"`));
  };
  for (const name of ["overview", ...input.composition.groups.map((g) => `group-${g.id}`)]) {
    assert.equal(JSON.parse(text(path.join(out, `${name}.bower.json`))).meta.inputSha, sha);
    for (const view of ["flat", "iso"]) {
      const html = text(path.join(out, `${name}.${view}.html`));
      verify(html);
      // Deliberate break: even one altered SHA field fails provenance parity.
      assert.throws(() => verify(html.replace(`data-bowerbird-input-sha="${sha}"`, `data-bowerbird-input-sha="broken"`)));
    }
  }
});

// Why: plain renders without an input SHA retain their existing head and root tag.
test("plain render without input SHA retains its original generator markup", () => {
  const out = mkdtempSync(path.join(os.tmpdir(), "bb-plain-"));
  assert.equal(run("render", inputFile, "--out", out, "--formats", "html").status, 0);
  for (const view of ["flat", "iso"]) {
    const html = text(path.join(out, `bowerbird.${view}.html`));
    assert.match(html, /<meta name="generator" content="bowerbird">/);
    assert.doesNotMatch(html, /bowerbird-input-sha|data-bowerbird-version/);
  }
});

// Why: an output outside a leased checkout must still link to durable repository files.
test("composition source links do not point into the leased worktree or use absolute paths", () => {
  const out = mkdtempSync(path.join(os.tmpdir(), "bb-composition-"));
  assert.equal(run("composition", inputFile, "--out", out, "--input-sha", sha).status, 0);
  const common = execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  const stableRoot = path.dirname(common);
  for (const name of ["overview", ...input.composition.groups.map((g) => `group-${g.id}`)]) {
    for (const view of ["flat", "iso"]) {
      const html = text(path.join(out, `${name}.${view}.html`));
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      for (const href of hrefs) {
        assert.doesNotMatch(href, /\.treehouse|^\/|^file:|^[A-Za-z]:\\/);
      }
      if (name === "group-author") {
        const source = hrefs.find((href) => href.endsWith("skills/bowerbird/SKILL.md"));
        assert.ok(source);
        assert.equal(path.resolve(out, source), path.join(stableRoot, "skills/bowerbird/SKILL.md"));
      }
    }
  }
});
