import { test } from "node:test";
import assert from "node:assert/strict";
import { projectFlat } from "../lib/tlc-project.mjs";
import { normalise } from "../lib/model.mjs";
import { layout } from "../lib/layout.mjs";
import { runTlc } from "../lib/tlc-runner.mjs";
import { mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const graph = () => ({ schema: "bowerbird/tlc-evidence/v1", outcome: "violation", graphIdentity: "concrete",
  states: [0, 1, 2].map((n) => ({ id: String(n), values: { count: { type: "integer", value: String(n) } } })),
  initial: ["0"], edges: [{ from: "0", to: "1", action: "Next" }, { from: "1", to: "2", action: "Next" }, { from: "0", to: "2", action: "Skip" }],
  rules: [{ id: "Limit", kind: "invariant", status: "violated" }],
  trace: { rule: "Limit", kind: "finite-prefix", steps: [{ state: "0", action: null }, { state: "2", action: "Skip" }] } });
const jointView = { state: () => "Shared", regions: ({ count }) => ({ Order: { phase: count.value === "2" ? "done" : "idle" }, Audit: { check: count.value === "1" ? "yes" : "no" } }) };

test("nested parallel labels describe observed joint combinations, never invented transitions", () => {
  const chart = projectFlat(graph(), { view: jointView });
  assert.equal(chart.nodes.length, 3); // Equal display labels do not erase distinct joint combinations.
  assert.deepEqual(chart.meta.jointRegions.paths, ["Order.phase", "Audit.check"]);
  assert.deepEqual(chart.edges.map((edge) => [edge.from, edge.to]), [["view_1", "view_2"], ["view_2", "view_3"], ["view_1", "view_3"]]);
  assert.equal(chart.edges[0].guard, "Order.phase=idle & Audit.check=no");
  assert.match(chart.edges[0].action, /Audit.check: no → yes/);
  assert.match(chart.edges[1].details, /Source: Order.phase=idle & Audit.check=yes. Target: Order.phase=done & Audit.check=no/);
  assert.match(chart.nodes[2].details, /No independent region execution order is inferred/);
  assert.equal(chart.edges.filter((e) => e.traces?.includes("witness")).length, 1);
  assert.equal(chart.nodes[2].evidence.marks.find((m) => m.kind === "breaks").label, "Limit");
  assert.match(chart.meta.subtitle, /implementation defects require independent replay/i);
  // Deliberate breaks: invented cross-product states, dropped arrows, or lost source context fail these checks.
  assert.throws(() => assert.equal(chart.nodes.length, 4));
  assert.throws(() => assert.equal(chart.edges.slice(1).length, graph().edges.length));
  assert.throws(() => assert.equal(chart.edges[0].guard, "Order.phase=idle"));
  assert.deepEqual(layout(normalise(chart)).warnings, []);
});

test("matching joint tuples may group concrete states but a mixed failure remains mayBreak", () => {
  const view = { state: () => "Same", regions: ({ count }) => ({ A: count.value === "1" ? "on" : "off", B: { slot: "ready" } }) };
  const chart = projectFlat(graph(), { view });
  assert.equal(chart.nodes.length, 2);
  assert.equal(chart.edges.length, 3);
  assert.equal(chart.nodes[0].evidence.marks.find((m) => m.kind === "mayBreak").label, "Limit");
  assert.match(chart.nodes[0].details, /Concrete IDs: 0, 2/);
});

test("missing or inconsistent joint region structure fails rather than inventing concurrent states", () => {
  const bad = [
    () => ({ Only: "idle" }),
    ({ count }) => count.value === "2" ? { A: "idle", B: "ready" } : { A: "idle", C: "ready" },
    () => ({ A: ["idle"], B: "ready" }),
    () => ({ A: "idle", B: "" }),
  ];
  for (const regions of bad) assert.throws(() => projectFlat(graph(), { view: { state: () => "X", regions } }), /projection: (joint|regions)/);
});

test("verification skill names each stage and keeps the model-only proof boundary", () => {
  const skill = readFileSync(new URL("../skills/bowerbird/SKILL.md", import.meta.url), "utf8");
  for (const stage of ["Author", "Check", "Project", "Render", "Explain"]) assert.match(skill, new RegExp(`\\*\\*${stage}\\*\\*`));
  assert.match(skill, /model evidence; implementation defects require independent replay/i);
  assert.match(skill, /model-only/);
  assert.match(skill, /--trusted-view/);
  assert.throws(() => assert.match(skill.replaceAll("model-only", ""), /model-only/)); // deliberate proof-boundary break
});

test("real TLC run discloses model-only replay and renders a joint chart", { skip: !process.env.TLC_TEST_JAR && "Set TLC_TEST_JAR" }, async () => {
  const fixture = (name) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
  const out = path.join(mkdtempSync(path.join(process.cwd(), ".tlc-test-")), "result");
  const record = await runTlc(fixture("Counter.tla"), fixture("CounterFail.cfg"), { jar: process.env.TLC_TEST_JAR, java: process.env.TLC_TEST_JAVA ?? "java",
    out, trustedView: fixture("JointView.mjs"), diagnose: false });
  assert.equal(record.exitCode, 1, record.reason);
  assert.equal(record.replay.status, "model-only");
  const chart = JSON.parse(readFileSync(path.join(out, "model.bower.json"), "utf8"));
  assert.equal(chart.edges.length, JSON.parse(readFileSync(path.join(out, "evidence.json"), "utf8")).edges.length);
  assert.ok(chart.meta.jointRegions);
  assert.match(readFileSync(path.join(out, "report.md"), "utf8"), /Replay: \*\*model-only\*\*/);
  assert.match(readFileSync(path.join(out, "model.html"), "utf8"), /No independent region execution order is inferred/);
});
