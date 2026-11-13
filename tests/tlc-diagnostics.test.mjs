import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { runTlc } from "../lib/tlc-runner.mjs";

const fixture = (name) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const jar = process.env.TLC_TEST_JAR;
const java = process.env.TLC_TEST_JAVA ?? "java";
const out = () => path.join(mkdtempSync(path.join(process.cwd(), ".tlc-test-")), "evidence");
const json = (dir, name) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
const sha = (text) => createHash("sha256").update(text).digest("hex");
const opts = (dir) => ({ jar, java, out: dir });

// Why: two separately detected failures must retain their own configurations, witnesses and unchecked rules without changing the first result.
test("multiple invariant failures use labelled bounded follow-ons, never a combined verdict", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const config = fixture("MultiRule.cfg");
  const original = readFileSync(config, "utf8");
  const dir = out();
  const run = await runTlc(fixture("MultiRule.tla"), config, opts(dir));
  assert.equal(run.exitCode, 1, run.reason);
  assert.equal(readFileSync(config, "utf8"), original);
  assert.equal(run.inputs.config.sha256, sha(original));
  const originalEvidence = json(dir, "evidence.json");
  assert.equal(originalEvidence.trace.rule, "UnderOne");
  assert.equal(originalEvidence.rules.find((r) => r.id === "UnderTwo").status, "unchecked");
  assert.equal(json(dir, "run.json").rawExitCode, 1);
  const diagnostics = json(dir, "diagnostics.json");
  assert.equal(diagnostics.original.configSha256, sha(original));
  assert.deepEqual(diagnostics.runs.map((r) => r.excluded), [["UnderOne"], ["UnderOne", "UnderTwo"]]);
  assert.deepEqual(diagnostics.runs.map((r) => r.exitCode), [1, 0]);
  assert.deepEqual(diagnostics.runs.map((r) => r.rules.find((rule) => rule.status === "violated")?.id ?? null), ["UnderTwo", null]);
  assert.ok(diagnostics.runs.every((r) => r.distinctStateLimit === 100000));
  for (const entry of diagnostics.runs) {
    const folder = path.join(dir, entry.directory);
    const cfg = readFileSync(path.join(dir, entry.config), "utf8");
    assert.ok(cfg.includes("INVARIANT TypeOK"));
    for (const name of entry.excluded) assert.ok(!cfg.includes(`INVARIANT ${name}\n`));
    assert.equal(sha(cfg), entry.configSha256);
    assert.equal(sha(readFileSync(path.join(dir, entry.model))), entry.modelSha256);
    assert.equal(entry.modelSha256, run.inputs.model.sha256);
    assert.equal(json(folder, "run.json").limits.distinctStates, 100000);
    assert.equal(json(folder, "evidence.json").rules.find((rule) => rule.id === "TypeOK").status, entry.exitCode === 0 ? "checked-no-violation" : "unchecked");
  }
  const report = readFileSync(path.join(dir, "report.md"), "utf8");
  assert.match(report, /Original TLC outcome:.*violation/);
  assert.match(report, /UnderTwo.*unchecked/);
  assert.match(report, /UnderTwo.*violated.*diagnostics/);
  assert.match(report, /separate model\/config verdicts; not a combined proof/i);
  assert.match(report, /not prove the implementation correct/);
  assert.ok(existsSync(path.join(dir, "diagnostics", "pass-1", "tlc.stdout")));
});

// Why: hitting a diagnostic state cap must not turn untouched rules into passes or rewrite the original violation.
test("distinct-state bound leaves other rules unchecked while preserving original exit 1", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const dir = out();
  const run = await runTlc(fixture("MultiRule.tla"), fixture("MultiRule.cfg"), { ...opts(dir), diagnosticStateLimit: 1 });
  assert.equal(run.exitCode, 1);
  assert.equal(json(dir, "evidence.json").trace.rule, "UnderOne");
  const diagnostics = json(dir, "diagnostics.json");
  assert.equal(diagnostics.runs.length, 1);
  assert.equal(diagnostics.runs[0].exitCode, 2);
  assert.match(diagnostics.runs[0].reason, /distinct-state bound/);
  assert.ok(diagnostics.unchecked.includes("UnderTwo"));
  assert.match(readFileSync(path.join(dir, "report.md"), "utf8"), /unchecked.*UnderTwo/s);
});

// Why: the user-facing command must keep the original failure code even when later checks find another failure.
test("CLI reports an original violation and linked follow-on evidence", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, () => {
  const dir = out();
  const cli = fileURLToPath(new URL("../bin/bowerbird.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [cli, "verify", fixture("MultiRule.tla"), "--config", fixture("MultiRule.cfg"), "--tlc-jar", jar, "--java", java, "--out", dir], { encoding: "utf8", timeout: 60000 });
  assert.equal(child.status, 1, child.stderr);
  assert.equal(json(dir, "run.json").diagnostics.runs.length, 2);
  assert.match(readFileSync(path.join(dir, "report.md"), "utf8"), /Follow-on 2:.*pass-2\.cfg/);
});

// Why: existing one-rule checks and invalid inputs must not start synthetic diagnostic runs.
test("single-rule and preflight failures do not manufacture follow-on verdicts", { skip: !jar && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const dir = out();
  const run = await runTlc(fixture("Counter.tla"), fixture("CounterFail.cfg"), opts(dir));
  assert.equal(run.exitCode, 1);
  assert.equal(existsSync(path.join(dir, "diagnostics.json")), false);
  const cli = fileURLToPath(new URL("../bin/bowerbird.mjs", import.meta.url));
  const bad = spawnSync(process.execPath, [cli, "verify", fixture("MultiRule.tla"), "--config", fixture("MultiRule.cfg"), "--tlc-jar", "missing.jar", "--java", "no-such-java", "--out", out()], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});
