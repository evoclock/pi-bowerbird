import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectFlat } from "../lib/tlc-project.mjs";
import { runTlc } from "../lib/tlc-runner.mjs";
import { loadDiagram } from "../lib/export.mjs";

const fixture = (name) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const jar = process.env.TLC_TEST_JAR;
const java = process.env.TLC_TEST_JAVA ?? "java";
const out = () => path.join(mkdtempSync(path.join(process.cwd(), ".tlc-test-")), "evidence");
const run = async (config) => {
  const dir = out();
  const record = await runTlc(fixture("Counter.tla"), fixture(config), { jar, java, out: dir });
  return { dir, record, evidence: JSON.parse(readFileSync(path.join(dir, "evidence.json"), "utf8")),
    chart: JSON.parse(readFileSync(path.join(dir, "model.bower.json"), "utf8")) };
};

// Why: a bad or oversized evidence graph cannot silently become a smaller clean chart.
test("flat adapter rejects unchecked, missing and over-budget model edges", () => {
  assert.throws(() => projectFlat({ schema: "bowerbird/tlc-evidence/v1", outcome: "unchecked" }), /unchecked/);
  const evidence = { schema: "bowerbird/tlc-evidence/v1", outcome: "completed", states: [{ id: "1", values: { count: { type: "integer", value: "0" } } }],
    edges: [{ from: "1", to: "2", action: "Go" }], initial: ["1"], rules: [{ id: "TypeOK", status: "checked-no-violation" }], trace: null };
  assert.throws(() => projectFlat(evidence), /missing concrete transition/);
  assert.throws(() => projectFlat({ ...evidence, edges: [], states: Array.from({ length: 101 }, (_, i) => ({ id: String(i), values: {} })) }), /budget exceeded/);
  const loop = projectFlat({ ...evidence, edges: [{ from: "1", to: "1", action: "Tick" }] });
  assert.equal(loop.edges[0].from, loop.edges[0].to);
  assert.equal(loop.nodes.length, 1);
});

// Why: a passing model chart must contain exactly the TLC states and steps, with no pseudo-transition.
test("passing conditional-update model renders every concrete state and action", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const { dir, record, evidence, chart } = await run("Counter.cfg");
  assert.equal(record.exitCode, 0, record.reason);
  assert.equal(record.projection.status, "rendered");
  assert.equal(chart.meta.verificationProjection, true);
  assert.equal(chart.meta.view, "flat");
  assert.equal(chart.nodes.length, evidence.states.length);
  assert.equal(chart.edges.length, evidence.edges.length);
  const byFingerprint = new Map(evidence.states.map((s, i) => [s.id, chart.nodes[i].id]));
  assert.deepEqual(chart.edges.map((e) => [e.from, e.to, e.event]), evidence.edges.map((e) => [byFingerprint.get(e.from), byFingerprint.get(e.to), e.action]));
  assert.equal(chart.nodes.filter((n) => n.lines.includes("Initial model state")).length, evidence.initial.length);
  const svg = readFileSync(path.join(dir, "model.svg"), "utf8");
  assert.ok(existsSync(path.join(dir, "model.html")));
  assert.doesNotMatch(svg, /unreachable|dead-end|ambiguous/);
  assert.match(svg, /not implementation proof/);
  assert.equal(loadDiagram(path.join(dir, "model.bower.json")).nodes.length, 3);
});

// Why: the violated rule, final concrete state and every witness step must agree across evidence and chart.
test("failing conditional-update model renders the rule-specific witness without new edges", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const { dir, record, evidence, chart } = await run("CounterFail.cfg");
  assert.equal(record.exitCode, 1, record.reason);
  assert.equal(chart.edges.length, evidence.edges.length);
  const rule = evidence.trace.rule;
  const last = evidence.trace.steps.at(-1).state;
  const lastNode = chart.nodes.find((n) => n.details.includes(`Concrete fingerprint: ${last}.`));
  assert.ok(lastNode.evidence.marks.some((m) => m.kind === "breaks" && m.label === rule && m.trace === "evidence.json"));
  assert.equal(chart.nodes.filter((n) => n.evidence?.marks.some((m) => m.kind === "bugPath")).length, evidence.trace.steps.length);
  assert.equal(chart.edges.filter((e) => e.traces?.includes("witness")).length, evidence.trace.steps.length - 1);
  assert.match(readFileSync(path.join(dir, "model.svg"), "utf8"), /BREAKS: UnderTwo/);
  assert.match(readFileSync(path.join(dir, "model.html"), "utf8"), /evidence\.json/);
});

// Why: a real model self-loop must remain a self-loop in the chart, not disappear or become a terminal state.
test("typed model renders its real self-loop and graph-check commands refuse model-derived charts", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const dir = out();
  const result = await runTlc(fixture("Typed.tla"), fixture("Typed.cfg"), { jar, java, out: dir });
  assert.equal(result.exitCode, 0, result.reason);
  const chart = JSON.parse(readFileSync(path.join(dir, "model.bower.json"), "utf8"));
  assert.equal(chart.edges.length, 1);
  assert.equal(chart.edges[0].from, chart.edges[0].to);
  assert.match(readFileSync(path.join(dir, "model.svg"), "utf8"), /data-from="state_\d+" data-to="state_\d+"/);
  const cli = fileURLToPath(new URL("../bin/bowerbird.mjs", import.meta.url));
  const check = spawnSync(process.execPath, [cli, "check", path.join(dir, "model.bower.json")], { encoding: "utf8" });
  assert.equal(check.status, 2);
  assert.match(check.stderr, /not an authored graph check/);
});

// Why: an unparseable TLC result must not emit a success-shaped chart.
test("incomplete check has no generated chart", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const dir = out();
  const result = await runTlc(fixture("Counter.tla"), fixture("CounterInvalid.cfg"), { jar, java, out: dir });
  assert.equal(result.exitCode, 2);
  assert.equal(result.projection.status, "unchecked");
  assert.equal(existsSync(path.join(dir, "model.bower.json")), false);
});
