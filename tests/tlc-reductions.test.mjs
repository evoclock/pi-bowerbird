import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectFlat } from "../lib/tlc-project.mjs";

const fixture = (name) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const cli = fileURLToPath(new URL("../bin/bowerbird.mjs", import.meta.url));
const jar = process.env.TLC_TEST_JAR;
const java = process.env.TLC_TEST_JAVA ?? "java";
const json = (dir, name) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
const verify = (module, cfg) => {
  const dir = path.join(mkdtempSync(path.join(process.cwd(), ".tlc-test-")), "evidence");
  const child = spawnSync(process.execPath, [cli, "verify", fixture(`${module}.tla`), "--config", fixture(`${cfg}.cfg`), "--tlc-jar", jar, "--java", java, "--out", dir], { encoding: "utf8", timeout: 60000 });
  return { dir, child, run: json(dir, "run.json"), evidence: json(dir, "evidence.json"), report: readFileSync(path.join(dir, "report.md"), "utf8") };
};

// Why: excluded successors must not be mistaken for explored terminal states or evaluated deadlock boundaries.
test("state and action constraints disclose unobserved boundary successors", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  for (const [config, directive] of [["ReductionConstraint", "CONSTRAINT"], ["ReductionAction", "ACTION_CONSTRAINT"], ["ReductionDeadlockBoundary", "CONSTRAINT"]]) {
    const { dir, child, run, evidence, report } = verify("Reduction", config);
    assert.equal(child.status, 0, `${config}: ${child.stderr}`);
    assert.equal(run.exitCode, 0);
    assert.ok(evidence.reductions.some((r) => r.kind === directive));
    assert.equal(evidence.states.length, 2);
    assert.equal(evidence.boundary.status, "partial");
    assert.match(report, /boundary.*deadlock.*not checked/i);
    assert.match(report, /partial model\/config evidence.*implementation proof/i);
    const chart = json(dir, "model.bower.json");
    assert.match(chart.meta.subtitle, /excluded successors/);
    assert.ok(chart.nodes.every((node) => !node.lines.includes("Final model state")));
  }
});

// Why: TLC evaluates the invariant at a constraint boundary even though its fingerprint is absent from the DOT graph.
test("constraint-boundary failure keeps the raw witness without inventing a TLC fingerprint", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  for (const config of ["ReductionBoundary", "ReductionActionBoundary"]) {
    const { dir, child, evidence, run, report } = verify("Reduction", config);
    assert.equal(child.status, 1, `${config}: ${child.stderr}`);
    assert.equal(run.rawExitCode, 1);
    assert.equal(evidence.trace.rule, "UnderTwo");
    const boundary = evidence.states.find((s) => s.exploration === "boundary-unexplored");
    assert.ok(boundary, config);
    assert.match(boundary.id, /^boundary_[a-f0-9]{16}$/);
    assert.equal(boundary.values.count.value, "2");
    assert.equal(evidence.trace.steps.at(-1).state, boundary.id);
    assert.ok(evidence.edges.some((e) => e.to === boundary.id && e.provenance === "tlc.stdout"));
    assert.match(report, /boundary.*invariant evaluated.*deadlock.*not checked/i);
    const chart = json(dir, "model.bower.json");
    assert.ok(chart.nodes.some((node) => node.lines.some((line) => line.includes("Boundary")) && node.evidence?.marks.some((mark) => mark.label === "UnderTwo")));
  }
});

// Why: quotient fingerprints cannot be presented as one card per distinct concrete state with faithful concrete arrows.
test("VIEW and SYMMETRY preserve finite verdicts but omit unsupported quotient charts", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  for (const [module, config, kind] of [["Reduction", "ReductionView", "VIEW"], ["Symmetry", "Symmetry", "SYMMETRY"]]) {
    const { dir, child, evidence, run, report } = verify(module, config);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(run.projection.status, "omitted");
    assert.equal(evidence.graphIdentity, "representative");
    assert.ok(evidence.reductions.some((r) => r.kind === kind));
    assert.equal(existsSync(path.join(dir, "model.bower.json")), false);
    assert.match(report, /representative.*concrete.*omitted/i);
    assert.match(report, /Chart: omitted/);
    assert.match(report, /not prove the implementation correct/);
  }
});

// Why: the documented 500-state limit must be inclusive, while a larger check keeps its raw verdict without a fake chart.
test("500 concrete states render within the inclusive chart budget", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const { dir, child, evidence, run } = verify("Big", "Big500");
  assert.equal(child.status, 0, child.stderr);
  assert.equal(evidence.states.length, 500);
  assert.equal(run.projection.status, "rendered");
  assert.equal(json(dir, "model.bower.json").nodes.length, 500);
});

// Why: a completed 521-state check may omit its chart, but must preserve evidence and disclose the exact visual omission.
test("large successful model keeps checked verdict with no fake complete chart", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const { dir, child, evidence, run, report } = verify("Big", "Big");
  assert.equal(child.status, 0, child.stderr);
  assert.equal(evidence.states.length, 521);
  assert.equal(run.projection.status, "omitted");
  assert.equal(run.projection.omittedStates, 521);
  assert.equal(existsSync(path.join(dir, "model.bower.json")), false);
  assert.match(report, /Chart: omitted.*521 states/i);
  assert.match(report, /500-state chart budget/);
});

// Why: when a graph exceeds budget, a counterexample-first chart must retain every witness step and declare hidden arrows.
test("large violation chart retains only sourced witness steps and marks all omissions", () => {
  const states = Array.from({ length: 521 }, (_, i) => ({ id: String(i), values: { count: { type: "integer", value: String(i) } }, exploration: "unknown" }));
  const edges = Array.from({ length: 520 }, (_, i) => ({ from: String(i), to: String(i + 1), action: "Next" }));
  const evidence = { schema: "bowerbird/tlc-evidence/v1", outcome: "violation", states, edges, initial: ["0"],
    rules: [{ id: "TooEarly", kind: "invariant", status: "violated" }],
    trace: { kind: "finite-prefix", rule: "TooEarly", steps: [{ state: "0", action: null }, { state: "1", action: "Next" }] } };
  const chart = projectFlat(evidence);
  assert.equal(chart.nodes.length, 2);
  assert.equal(chart.edges.length, 1);
  assert.equal(chart.meta.projectionOmissions.states, 519);
  assert.equal(chart.meta.projectionOmissions.edges, 519);
  assert.match(chart.meta.subtitle, /partial.*counterexample/i);
  assert.match(chart.nodes[1].details, /1 outgoing step omitted/);
  assert.throws(() => projectFlat({ ...evidence, outcome: "completed", trace: null, rules: [{ id: "TooEarly", kind: "invariant", status: "checked-no-violation" }] }), /chart omitted.*500-state chart budget/);
});
