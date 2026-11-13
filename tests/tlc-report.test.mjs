import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportForRun } from "../lib/tlc-report.mjs";
import { runTlc } from "../lib/tlc-runner.mjs";

const fixture = (name) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const cli = fileURLToPath(new URL("../bin/bowerbird.mjs", import.meta.url));
const jar = process.env.TLC_TEST_JAR;
const java = process.env.TLC_TEST_JAVA ?? "java";
const out = () => path.join(mkdtempSync(path.join(process.cwd(), ".tlc-test-")), "evidence");
const verify = (config) => {
  const dir = out();
  const child = spawnSync(process.execPath, [cli, "verify", fixture("Counter.tla"), "--config", fixture(config), "--tlc-jar", jar, "--java", java, "--out", dir], { encoding: "utf8", timeout: 60000 });
  return { dir, child, run: JSON.parse(readFileSync(path.join(dir, "run.json"), "utf8")), report: readFileSync(path.join(dir, "report.md"), "utf8") };
};

// Why: a completed finite run needs checked rules, traceable inputs, exact invocation and readable artifacts.
test("end-to-end pass reports model/config only, rule provenance and reproduction", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const { dir, child, run, report } = verify("Counter.cfg");
  assert.equal(child.status, 0, child.stderr);
  assert.equal(run.exitCode, 0);
  assert.match(report, /Outcome: completed finite model check; no checked rule violated\. Exit: 0/);
  assert.match(report, /TypeOK.*checked-no-violation.*tlc\.stdout/);
  assert.match(report, /Model SHA-256: [a-f0-9]{64}/);
  assert.match(report, /Config SHA-256: [a-f0-9]{64}/);
  assert.match(report, /Tool SHA-256: [a-f0-9]{64}/);
  assert.match(report, /Exact TLC invocation/);
  assert.ok(report.includes(JSON.stringify(run.command.args.at(-1))));
  assert.match(report, /not prove the implementation correct/);
  for (const name of ["tlc.stdout", "tlc.stderr", "tlc.dot", "evidence.json", "model.bower.json", "model.html", "model.svg"]) {
    assert.ok(existsSync(path.join(dir, name)));
    assert.ok(report.includes(`[${name}](${name})`), name);
  }
});

// Why: an invariant counterexample must name the same rule and concrete states as the linked evidence.
test("end-to-end violation reports exact rule and finite witness without claiming code defect", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const { dir, child, run, report } = verify("CounterFail.cfg");
  assert.equal(child.status, 1, child.stderr);
  assert.equal(run.exitCode, 1);
  const evidence = JSON.parse(readFileSync(path.join(dir, "evidence.json"), "utf8"));
  assert.match(report, /Outcome: invariant violation in model\. Exit: 1/);
  assert.match(report, /UnderTwo.*violated.*tlc\.stdout/);
  assert.match(report, /Boundary status: unknown/);
  assert.match(report, /model-only.*not an implementation defect/i);
  for (const step of evidence.trace.steps) assert.ok(report.includes(step.state));
});

// Why: bad input and cancellation remain incomplete even when some evidence files exist.
test("invalid config and cancellation exit 2 with explicit unchecked rules", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const invalid = verify("CounterInvalid.cfg");
  assert.equal(invalid.child.status, 2);
  assert.match(invalid.report, /Outcome: incomplete or unchecked\. Exit: 2/);
  assert.match(invalid.report, /TypeOK.*unchecked/);
  assert.match(invalid.report, /Chart: unavailable/);
  const controller = new AbortController();
  controller.abort();
  const dir = out();
  const cancelled = await runTlc(fixture("Counter.tla"), fixture("Counter.cfg"), { jar, java, out: dir, signal: controller.signal });
  assert.equal(cancelled.exitCode, 2);
  assert.match(readFileSync(path.join(dir, "report.md"), "utf8"), /cancelled/);
});

// Why: missing or unreadable output cannot preserve a success exit or a success-shaped report.
test("report validation downgrades missing or unreadable artifacts and unchecked rules", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const { dir, run } = verify("Counter.cfg");
  const evidence = JSON.parse(readFileSync(path.join(dir, "evidence.json"), "utf8"));
  writeFileSync(path.join(dir, "model.svg"), "not svg");
  const unreadable = reportForRun(run, evidence, dir);
  assert.equal(unreadable.run.exitCode, 2);
  assert.match(unreadable.text, /Outcome: incomplete or unchecked\. Exit: 2/);
  assert.match(unreadable.text, /unreadable model.svg/);
  const changed = { ...evidence, rules: evidence.rules.map((rule) => ({ ...rule, status: "unchecked" })) };
  writeFileSync(path.join(dir, "evidence.json"), JSON.stringify(changed));
  const unchecked = reportForRun(run, changed, dir);
  assert.equal(unchecked.run.exitCode, 2);
  assert.match(unchecked.text, /TypeOK.*unchecked/);
  assert.match(unchecked.text, /completed verdict disagrees/);
});

// Why: known counterexamples and unexamined rules must remain distinct in a single report.
test("violation report retains other rules as unchecked", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const { dir, run } = verify("CounterFail.cfg");
  const evidence = JSON.parse(readFileSync(path.join(dir, "evidence.json"), "utf8"));
  evidence.rules.push({ id: "Other", kind: "invariant", status: "unchecked", provenance: { file: "tlc.stdout" } });
  writeFileSync(path.join(dir, "evidence.json"), JSON.stringify(evidence));
  const report = reportForRun(run, evidence, dir);
  assert.equal(report.run.exitCode, 1);
  assert.match(report.text, /Other.*unchecked/);
  assert.match(report.text, /UnderTwo.*violated/);
});

// Why: missing Java is a preflight error, never a success-shaped output directory.
test("missing Java fails with exit 2 before output creation", () => {
  const dir = out();
  const child = spawnSync(process.execPath, [cli, "verify", fixture("Counter.tla"), "--config", fixture("Counter.cfg"), "--tlc-jar", "nonexistent.jar", "--java", "definitely-not-a-java-executable", "--out", dir], { encoding: "utf8" });
  assert.equal(child.status, 2);
  assert.equal(existsSync(dir), false);
  assert.match(child.stderr, /verify:/);
});
