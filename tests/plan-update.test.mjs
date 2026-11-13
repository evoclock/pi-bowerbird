import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { planDiagram } from "../lib/plan.mjs";
import { updatePlan } from "../lib/plan-update.mjs";

const source = "| # | Task | Depends on | State |\n|---|---|---|---|\n| T01 | First | none | DONE |\n| T02 | Second | T01 | PENDING |\n";
const initial = () => planDiagram({ tasks: source });

// Why: a repeat import must preserve the exact original bytes, including hand formatting.
test("unchanged import is an exact no-op even with hand layout and evidence", () => {
  const d = initial();
  d.meta.subtitle = "Hand notes";
  d.nodes[0].at = [5, 5];
  d.nodes[0].evidence = { marks: [{ id: "reviewed" }] };
  d.zones = [{ id: "hand", title: "Work" }];
  const result = updatePlan(d, initial());
  assert.equal(result.changed, false);
  assert.equal(result.diagram, d);
  assert.deepEqual(result.diagram.nodes[0].evidence, d.nodes[0].evidence);
});

// Why: removing and adding tasks must touch only imported items, never hand-authored groups or IDs.
test("delta preserves hand fields and node IDs, removes stale task edges", () => {
  const d = initial();
  d.nodes[0].id = "custom-first";
  d.nodes[0].at = [8, 4];
  d.nodes[0].zone = "hand";
  d.nodes[0].evidence = { paths: ["private/review"] };
  d.nodes[0].status = "planned";
  d.zones = [{ id: "hand", title: "Work" }];
  d.nodes.push({ id: "manual", title: "Manual", at: [9, 4] });
  d.edges[0].from = "custom-first";
  const next = planDiagram({ tasks: "| # | Task | Depends on | State |\n|---|---|---|---|\n| T01 | First | none | IMPLEMENTED |\n| T03 | Third | T01 | PENDING |\n" });
  const { diagram, changed } = updatePlan(d, next);
  assert.equal(changed, true);
  assert.deepEqual(diagram.nodes.find((n) => n.id === "custom-first").at, [8, 4]);
  assert.deepEqual(diagram.nodes.find((n) => n.id === "custom-first").evidence, { paths: ["private/review"] });
  assert.equal(diagram.nodes.find((n) => n.id === "custom-first").zone, "hand");
  assert.equal(diagram.nodes.find((n) => n.id === "custom-first").status, "partial");
  assert.ok(diagram.nodes.some((n) => n.id === "manual"));
  assert.ok(!diagram.nodes.some((n) => n.id === "T02"));
  assert.deepEqual(diagram.edges, [{ from: "custom-first", to: "T03", kind: "control", label: "blocks" }]);
});

// Why: an accidental ID collision must stop instead of replacing a hand-authored item.
test("new task cannot take a hand-authored ID", () => {
  const d = initial();
  d.nodes.push({ id: "T03", title: "Custom", at: [6, 6] });
  const next = planDiagram({ tasks: source + "| T03 | Third | none | PENDING |\n" });
  assert.throws(() => updatePlan(d, next), /conflicts/);
});

// Why: repeated CLI updates must never rewrite a cached file merely to reformat it.
test("CLI update leaves a custom-formatted file byte-identical", () => {
  const dir = mkdtempSync(join(process.cwd(), ".plan-update-test-"));
  const tasks = join(dir, "tasks.md");
  const output = join(dir, "diagram.bower.json");
  writeFileSync(tasks, source);
  writeFileSync(output, JSON.stringify(initial()) + "\n");
  const before = readFileSync(output);
  execFileSync(process.execPath, ["bin/bowerbird.mjs", "plan", "--tasks", tasks, "--update", output]);
  assert.deepEqual(readFileSync(output), before);
});
