// Compare all example and fixture diagrams against a base revision, byte for byte.
// Usage: node scripts/check-identical-output.mjs [--base origin/main] [--scratch .scratch]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const base = arg("--base", "origin/main");
const scratch = path.resolve(root, arg("--scratch", ".scratch"));
mkdirSync(scratch, { recursive: true });
const attempt = mkdtempSync(path.join(scratch, "identical-output-"));
const archive = execFileSync("git", ["archive", base], { cwd: root, maxBuffer: 50 * 1024 * 1024 });
const baseline = path.join(attempt, "base");
mkdirSync(baseline);
const unpack = spawnSync("tar", ["-x", "-C", baseline], { input: archive });
if (unpack.status !== 0) throw new Error(`tar failed: ${unpack.stderr}`);
const diagrams = [];
function collect(dir, relative = "") {
  if (!readdirSync(dir, { withFileTypes: true }).length) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) collect(path.join(dir, entry.name), name);
    else if (entry.name.endsWith(".bower.json")) diagrams.push(name);
  }
}
for (const folder of ["examples", "tests"]) collect(path.join(baseline, folder), folder);
diagrams.sort();
let compared = 0;
let rejected = 0;
for (const diagram of diagrams) {
  const runs = [];
  for (const [label, source] of [["base", baseline], ["branch", root]]) {
    const out = path.join(attempt, "results", label, diagram);
    mkdirSync(out, { recursive: true });
    runs.push(spawnSync(process.execPath, [path.join(source, "bin/bowerbird.mjs"), "render", path.join(source, diagram), "--out", out, "--formats", "svg,html", "--repo-root", root], { cwd: source, encoding: "utf8" }));
  }
  if (runs[0].status !== 0 || runs[1].status !== 0) {
    if (runs[0].status !== runs[1].status || runs[0].stderr !== runs[1].stderr || runs[0].stdout !== runs[1].stdout) {
      throw new Error(`render result differs: ${diagram}`);
    }
    rejected++;
    continue;
  }
  function files(dir, rel = "") {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(dir, entry.name), path.join(rel, entry.name)) : [path.join(rel, entry.name)]).sort();
  }
  const a = path.join(attempt, "results", "base", diagram), b = path.join(attempt, "results", "branch", diagram);
  const names = files(a);
  if (JSON.stringify(names) !== JSON.stringify(files(b))) throw new Error(`file list differs: ${diagram}`);
  for (const name of names) {
    if (!readFileSync(path.join(a, name)).equals(readFileSync(path.join(b, name)))) throw new Error(`bytes differ: ${diagram}/${name}`);
  }
  compared++;
}
console.log(`${compared} diagrams compared, zero SVG/HTML diffs; ${rejected} expected failures matched`);
