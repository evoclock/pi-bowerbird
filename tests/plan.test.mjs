import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWork, planDiagram } from "../lib/plan.mjs";
import { normalise } from "../lib/model.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/plans/${name}`, import.meta.url), "utf8");

// Why: a later planning table must not erase reconciled completion evidence.
test("status ledger wins over later descriptive tables; PR links remain explicit", () => {
  const tasks = fixture("vogelkop-status.md");
  const work = parseWork(tasks);
  assert.equal(work.get("P1").status, "implemented");
  assert.equal(work.get("P1").title, "Raise the output ceiling");
  const d = planDiagram({ tasks, prs: [{ number: 12, headRefName: "feat/P7.2", state: "OPEN", url: "https://example.test/pr/12" }] });
  assert.equal(d.nodes.find((n) => n.id === "P7.2").status, "partial");
  assert.match(d.nodes.find((n) => n.id === "P7.2").details, /PR #12/);
  assert.equal(d.nodes.find((n) => n.id === "P29").status, "planned");
  assert.deepEqual(d.edges, []);
  assert.doesNotThrow(() => normalise(d));
  assert.equal(JSON.stringify(d), JSON.stringify(planDiagram({ tasks, prs: [{ number: 12, headRefName: "feat/P7.2", state: "OPEN", url: "https://example.test/pr/12" }] })));
});

// Why: dependencies and PR branches must be visible without tree inference.
test("task dependencies and headings form stable nodes and directed edges", () => {
  const tasks = fixture("model-fidelity-tasks.md");
  const d = planDiagram({ tasks, specs: ["### T20. Named lanes\n"], prs: [{ number: 9, headRefName: "feat/T02a-attempts", state: "OPEN" }] });
  assert.deepEqual(d.edges, [{ from: "T01", to: "T02A", kind: "control", label: "blocks" }, { from: "T19", to: "T20", kind: "control", label: "blocks" }]);
  assert.equal(d.nodes.find((n) => n.id === "T02A").status, "partial");
  assert.equal(d.nodes.find((n) => n.id === "T02A").planId, "T02A");
  assert.equal(d.nodes.find((n) => n.id === "T21").title, "Draw evidence marks without changing build status");
  assert.doesNotThrow(() => normalise(d));
});

// Why: malformed inputs must not silently publish a misleading architecture.
test("invalid inputs fail closed", () => {
  assert.throws(() => planDiagram({ tasks: "", prs: {} }), /prs/);
  assert.throws(() => planDiagram({ tasks: null }), /tasks/);
});
