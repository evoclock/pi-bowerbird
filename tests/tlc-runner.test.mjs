import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTlc, TLC_SHA256 } from "../lib/tlc-runner.mjs";

const model = fileURLToPath(new URL("fixtures/Counter.tla", import.meta.url));
const passing = fileURLToPath(new URL("fixtures/Counter.cfg", import.meta.url));
const failing = fileURLToPath(new URL("fixtures/CounterFail.cfg", import.meta.url));
const jar = process.env.TLC_TEST_JAR;
const java = process.env.TLC_TEST_JAVA ?? "java";
const available = Boolean(jar);
const out = () => path.join(mkdtempSync(path.join(process.cwd(), ".tlc-test-")), "evidence");
const run = (config, options = {}) => runTlc(model, config, { jar, java, out: out(), ...options });

// Why: a real TLC success must preserve machine output and only support its model/config.
test("pinned TLC runs a passing handwritten model with recorded bounds and source digests", { skip: !available && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const destination = out();
  const result = await run(passing, { out: destination });
  assert.equal(result.exitCode, 0);
  assert.equal(result.outcome, "completed-no-violation");
  assert.equal(result.tool.sha256, TLC_SHA256);
  assert.equal(result.inputs.model.sha256.length, 64);
  assert.deepEqual(result.command.args.slice(-3), ["-config", passing, model]);
  // Why: concurrent TLC processes must not extract standard modules into the shared JVM temp directory.
  const tempArg = `-Djava.io.tmpdir=${path.join(destination, "tlc-meta", "java-tmp")}`;
  assert.ok(result.command.args.includes(tempArg));
  assert.ok(existsSync(path.join(destination, "tlc-meta", "java-tmp")));
  assert.match(readFileSync(path.join(destination, "tlc.stdout"), "utf8"), /@!@!@STARTMSG 2193:0/);
});

// Why: a detected invariant failure has a distinct status and keeps its raw counterexample.
test("pinned TLC runs a failing handwritten model and preserves witness", { skip: !available && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const destination = out();
  const result = await run(failing, { out: destination });
  assert.equal(result.exitCode, 1);
  assert.equal(result.outcome, "violation");
  assert.equal(result.tlcExit.code, 12);
  assert.match(readFileSync(path.join(destination, "tlc.stdout"), "utf8"), /Invariant UnderTwo is violated/);
  assert.equal(JSON.parse(readFileSync(path.join(destination, "run.json"), "utf8")).outcome, "violation");
  assert.ok(existsSync(path.join(destination, "tlc.stderr")));
});

// Why: an invalid config must never be reclassified as a checked, passing rule.
test("malformed config remains incomplete and retains TLC diagnostics", { skip: !available && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const destination = out();
  const invalid = fileURLToPath(new URL("fixtures/CounterInvalid.cfg", import.meta.url));
  const result = await run(invalid, { out: destination });
  assert.equal(result.exitCode, 2);
  assert.match(readFileSync(path.join(destination, "tlc.stdout"), "utf8"), /MissingOperator specified in the configuration file/);
});

// Why: incomplete execution after a timeout or cancellation cannot be reported as success.
test("timeout and cancellation remain incomplete", { skip: !available && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const timed = await run(passing, { timeoutMs: 100 });
  assert.equal(timed.exitCode, 2);
  assert.equal(timed.reason, "timeout");
  const controller = new AbortController();
  controller.abort();
  const cancelled = await run(passing, { signal: controller.signal });
  assert.equal(cancelled.exitCode, 2);
  assert.equal(cancelled.reason, "cancelled");
});

// Why: the public CLI must map raw completed, violation and incomplete outcomes to separate exit codes.
test("CLI returns 0 for a completed run, 1 for invariant violation, 2 for incomplete", { skip: !available && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const cli = fileURLToPath(new URL("../bin/bowerbird.mjs", import.meta.url));
  for (const [config, expected] of [[passing, 0], [failing, 1], [fileURLToPath(new URL("fixtures/CounterInvalid.cfg", import.meta.url)), 2]]) {
    const destination = out();
    const result = spawnSync(process.execPath, [cli, "verify", model, "--config", config, "--tlc-jar", jar, "--out", destination, "--java", java], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, expected, result.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(destination, "run.json"), "utf8")).exitCode, expected);
  }
});

// Why: an arbitrary jar or reused evidence directory must never enter the checker.
test("pin mismatch and occupied output fail before running", { skip: !available && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  await assert.rejects(run(passing, { jar: model }), /SHA-256 differs/);
  await assert.rejects(run(passing, { out: path.dirname(model) }), /new directory/);
});
