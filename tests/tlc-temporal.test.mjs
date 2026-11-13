import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { interpretEvidence } from "../lib/tlc-evidence.mjs";
import { reportForRun } from "../lib/tlc-report.mjs";

const fixture = (name) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const cli = fileURLToPath(new URL("../bin/bowerbird.mjs", import.meta.url));
const jar = process.env.TLC_TEST_JAR;
const java = process.env.TLC_TEST_JAVA ?? "java";
const json = (dir, name) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
const verify = (module, config) => {
  const dir = path.join(mkdtempSync(path.join(process.cwd(), ".tlc-test-")), "evidence");
  const child = spawnSync(process.execPath, [cli, "verify", fixture(`${module}.tla`), "--config", fixture(`${config}.cfg`), "--tlc-jar", jar, "--java", java, "--out", dir], { encoding: "utf8", timeout: 60000 });
  return { dir, child, run: json(dir, "run.json"), evidence: json(dir, "evidence.json"),
    chart: existsSync(path.join(dir, "model.bower.json")) ? json(dir, "model.bower.json") : null,
    report: readFileSync(path.join(dir, "report.md"), "utf8") };
};

// Why: a fair liveness loop must retain a concrete back edge, its rule and its non-shortest temporal provenance.
test("liveness loop retains a lasso witness without a finite-state BREAKS mark", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const { child, run, evidence, chart, report } = verify("Temporal", "TemporalLoop");
  assert.equal(child.status, 1, child.stderr);
  assert.equal(run.outcome, "temporal-violation");
  assert.equal(evidence.rules.find((r) => r.id === "Live").status, "violated");
  assert.equal(evidence.trace.kind, "lasso");
  assert.equal(evidence.trace.rule, "Live");
  assert.equal(evidence.trace.loop.to, 0);
  assert.equal(evidence.trace.shortest, false);
  const from = evidence.trace.steps.at(-1).state;
  const to = evidence.trace.steps[evidence.trace.loop.to].state;
  assert.ok(evidence.edges.some((edge) => edge.from === from && edge.to === to && edge.action === evidence.trace.loop.action));
  assert.ok(chart.edges.some((edge) => edge.traces?.includes("witness") && edge.event === evidence.trace.loop.action));
  assert.ok(chart.nodes.every((node) => !node.evidence?.marks.some((mark) => mark.kind === "breaks")));
  assert.match(report, /lasso.*not a shortest path/i);
  assert.match(report, /bounded temporal evidence.*not.*implementation proof/i);
});

// Why: a stuttering counterexample is an infinite repetition backed by TLC's dashed transition, not an invented finite error state.
test("liveness stutter keeps the implicit TLC loop separate from explicit actions", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const { child, evidence, chart, report } = verify("Temporal", "Temporal");
  assert.equal(child.status, 1, child.stderr);
  assert.equal(evidence.trace.kind, "stuttering");
  assert.equal(evidence.trace.loop.from, evidence.trace.loop.to);
  assert.ok(evidence.edges.some((edge) => edge.kind === "implicit-stutter" && edge.from === edge.to && edge.from === evidence.trace.steps[0].state));
  assert.ok(chart.edges.some((edge) => edge.event === "Stutter" && edge.traces?.includes("witness")));
  assert.match(report, /implicit stuttering.*not a shortest path/i);
});

// Why: a real deadlock has no Next successor, while an explicit stutter at only the intended terminal prevents that deadlock.
test("deadlock stays violated and intentional terminal stutter completes", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const dead = verify("Terminal", "TerminalDeadlock");
  assert.equal(dead.child.status, 1, dead.child.stderr);
  assert.equal(dead.run.outcome, "deadlock");
  assert.equal(dead.evidence.trace.rule, "deadlock");
  assert.equal(dead.evidence.trace.kind, "finite-prefix");
  const end = dead.evidence.trace.steps.at(-1).state;
  assert.equal(dead.evidence.edges.some((edge) => edge.from === end), false);
  assert.ok(dead.chart.nodes.some((node) => node.evidence?.marks.some((mark) => mark.kind === "breaks" && mark.label === "deadlock")));
  assert.match(dead.report, /Deadlock reached in model/);
  const terminal = verify("Terminal", "TerminalStutter");
  assert.equal(terminal.child.status, 0, terminal.child.stderr);
  assert.equal(terminal.evidence.rules.find((r) => r.id === "deadlock").status, "checked-no-violation");
  assert.deepEqual(terminal.evidence.edges.filter((edge) => edge.from === edge.to).map((edge) => edge.action), ["End"]);
  assert.equal(terminal.evidence.edges.find((edge) => edge.action === "End").from, terminal.evidence.states.find((state) => state.values.count.value === "1").id);
  assert.match(terminal.report, /only the specified model\/config/i);
});

// Why: a proved property in this finite model is not implementation proof, and several unattributed failures must stay unchecked.
test("completed temporal property is model-only; ambiguous multi-property failures exit 2", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const good = verify("Temporal", "TemporalPass");
  assert.equal(good.child.status, 0, good.child.stderr);
  assert.equal(good.evidence.rules.find((rule) => rule.id === "EventuallyOne").status, "checked-no-violation");
  assert.match(good.report, /does not prove the implementation correct/);
  const ambiguous = verify("Temporal", "TemporalTwo");
  assert.equal(ambiguous.child.status, 2);
  assert.equal(ambiguous.evidence.outcome, "unchecked");
  assert.equal(ambiguous.chart, null);
  assert.ok(ambiguous.evidence.rules.every((rule) => rule.status === "unchecked"));
  assert.match(ambiguous.report, /multiple temporal properties/);
});

// Why: a missing or unknown temporal return marker must remain unchecked, never masquerade as a completed counterexample.
test("malformed lasso marker does not become a verified violation", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const { dir, run } = verify("Temporal", "TemporalLoop");
  const stdout = path.join(dir, "tlc.stdout");
  writeFileSync(stdout, readFileSync(stdout, "utf8").replace("@!@!@STARTMSG 2122:4 @!@!@", "@!@!@STARTMSG 9999:4 @!@!@"));
  const evidence = interpretEvidence(run, dir);
  assert.equal(evidence.outcome, "unchecked");
  assert.ok(evidence.rules.every((rule) => rule.status === "unchecked"));
  assert.equal(reportForRun(run, evidence, dir).run.exitCode, 2);
});
