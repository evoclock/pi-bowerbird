import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { writePlanFile } from "../lib/plan-file.mjs";

// Why: hooks must call the same deterministic file adapter as the command, without a model.
test("file API and CLI produce the same bytes, then preserve them on repeat", () => {
  const dir = mkdtempSync(join(process.cwd(), ".plan-api-test-"));
  const tasksPath = join(dir, "tasks.md");
  const prsPath = join(dir, "prs.json");
  const apiOut = join(dir, "api.bower.json");
  const cliOut = join(dir, "cli.bower.json");
  writeFileSync(tasksPath, "| # | Task | State |\n|---|---|---|\n| T01 | Entry | PENDING |\n");
  writeFileSync(prsPath, JSON.stringify([{ number: 4, headRefName: "feat/T01-entry", state: "OPEN", url: "https://example.test/4" }]));
  const args = { tasksPath, prsPath, outPath: apiOut };
  const first = writePlanFile(args);
  assert.equal(first.changed, true);
  assert.equal(first.diagram.nodes[0].status, "partial");
  execFileSync(process.execPath, ["bin/bowerbird.mjs", "plan", "--tasks", tasksPath, "--prs", prsPath, "--out", cliOut]);
  const before = readFileSync(apiOut);
  assert.deepEqual(readFileSync(cliOut), before);
  const repeat = writePlanFile({ ...args, updatePath: apiOut });
  assert.equal(repeat.changed, false);
  assert.deepEqual(readFileSync(apiOut), before);
});

// Why: the API must never overwrite a different cache without explicit update.
test("file API refuses conflicting output and inputs", () => {
  const dir = mkdtempSync(join(process.cwd(), ".plan-api-test-"));
  const tasksPath = join(dir, "tasks.md");
  const outPath = join(dir, "diagram.bower.json");
  writeFileSync(tasksPath, "### T01. Entry\n");
  writeFileSync(outPath, "hand-authored contents");
  assert.throws(() => writePlanFile({ tasksPath, outPath }), /refusing to overwrite/);
  assert.throws(() => writePlanFile({ tasksPath, outPath: tasksPath }), /cannot replace an input/);
  assert.equal(readFileSync(outPath, "utf8"), "hand-authored contents");
});
