import { test } from "node:test";
import assert from "node:assert/strict";
import { projectFlat } from "../lib/tlc-project.mjs";
import { runTlc } from "../lib/tlc-runner.mjs";
import { mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const value = (n) => ({ count: { type: "integer", value: String(n) } });
const evidence = () => ({ schema: "bowerbird/tlc-evidence/v1", outcome: "violation", graphIdentity: "concrete",
  states: [0, 1, 2].map((n) => ({ id: String(n), values: value(n), exploration: "unknown" })),
  edges: [{ from: "0", to: "1", action: "A" }, { from: "0", to: "2", action: "B" }, { from: "1", to: "2", action: "C" }],
  initial: ["0"], rules: [{ id: "Limit", kind: "invariant", status: "violated" }],
  trace: { kind: "finite-prefix", rule: "Limit", steps: [{ state: "0", action: null }, { state: "2", action: "B" }] } });
const merged = { state: () => "Shared", step: (action) => action };

test("mixed rule failure is mayBreak, not breaks; complete aggregate arrows and witness survive", () => {
  const chart = projectFlat(evidence(), { view: merged });
  assert.equal(chart.nodes.length, 1);
  assert.deepEqual(chart.nodes[0].evidence.marks.map((m) => m.kind), ["bugPath", "bugPath", "mayBreak"]);
  assert.equal(chart.edges.length, 3);
  assert.deepEqual(chart.edges.map((e) => e.event), ["A", "B", "C"]);
  assert.equal(chart.edges.filter((e) => e.traces?.includes("witness")).length, 1);
  assert.match(chart.nodes[0].details, /Concrete IDs: 0, 1, 2/);
  assert.match(chart.meta.subtitle, /Faithful abstraction of observed model states/i);
  // Deliberate breaks: discarding an aggregate arrow or promoting a mixed mark to definite must fail.
  assert.throws(() => assert.equal(chart.edges.slice(1).length, evidence().edges.length));
  assert.throws(() => assert.equal("breaks", chart.nodes[0].evidence.marks.at(-1).kind));
});

test("single sourced failing state is breaks; distinct display identities keep concrete IDs", () => {
  const chart = projectFlat(evidence(), { view: { state: (vars) => vars.count.value } });
  assert.equal(chart.nodes[2].evidence.marks.find((m) => m.label === "Limit" && m.kind !== "bugPath").kind, "breaks");
  assert.match(chart.nodes[2].details, /Concrete IDs: 2/);
  assert.notEqual(chart.nodes[2].id, "state_2");
  assert.throws(() => assert.equal(projectFlat(evidence()).nodes[2].id, chart.nodes[2].id));
});

test("trusted view opt-in runs on real evidence; absent view leaves concrete IDs unchanged", { skip: !process.env.TLC_TEST_JAR && "Set TLC_TEST_JAR" }, async () => {
  const fixture = (name) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
  const out = path.join(mkdtempSync(path.join(process.cwd(), ".tlc-test-")), "result");
  const record = await runTlc(fixture("Counter.tla"), fixture("Counter.cfg"), { jar: process.env.TLC_TEST_JAR,
    java: process.env.TLC_TEST_JAVA ?? "java", out, trustedView: fixture("TrustedView.mjs"), diagnose: false });
  assert.equal(record.exitCode, 0, record.reason);
  assert.ok(record.trustedView.sha256);
  const chart = JSON.parse(readFileSync(path.join(out, "model.bower.json"), "utf8"));
  const evidence = JSON.parse(readFileSync(path.join(out, "evidence.json"), "utf8"));
  assert.equal(chart.edges.length, evidence.edges.length);
  assert.match(chart.nodes[0].title, /^Count /);
  assert.match(readFileSync(path.join(out, "report.md"), "utf8"), /faithful abstraction of observed model states/);
  assert.equal(projectFlat(evidence).nodes[0].id, `state_${evidence.states[0].id.replace(/^-/u, "n")}`);
});

test("marks retain rule identity; unchecked rules and temporal loops do not become breaks", () => {
  const source = evidence();
  source.rules.push({ id: "Other", kind: "invariant", status: "unchecked" });
  const chart = projectFlat(source, { view: merged });
  assert.deepEqual(chart.nodes[0].evidence.marks.filter((m) => ["breaks", "mayBreak"].includes(m.kind)).map((m) => m.label), ["Limit"]);
  const temporal = evidence();
  temporal.rules[0].kind = "property";
  temporal.trace.kind = "lasso";
  temporal.trace.loop = { from: 1, to: 0, action: "Return" };
  temporal.edges.push({ from: "2", to: "0", action: "Return" });
  assert.equal(projectFlat(temporal, { view: merged }).nodes[0].evidence.marks.some((m) => ["breaks", "mayBreak"].includes(m.kind)), false);
});

test("a view cannot hide an action or supply an invalid display identity", () => {
  assert.throws(() => projectFlat(evidence(), { view: { state: () => "" } }), /view.state/);
  assert.throws(() => projectFlat(evidence(), { view: { state: () => "Shared", step: () => null } }), /view.step/);
  assert.throws(() => projectFlat(evidence(), { view: { state: () => "Shared", step: 42 } }), /view needs/);
});
