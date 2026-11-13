import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { preflight } from "../lib/tlc-preflight.mjs";

const model = fileURLToPath(new URL("fixtures/Counter.tla", import.meta.url));
const config = fileURLToPath(new URL("fixtures/Counter.cfg", import.meta.url));
const java = (version) => (_command, args, options) => {
  assert.deepEqual(args, ["-version"]);
  assert.equal(options.timeout, 5000);
  return { status: 0, stderr: `openjdk version "${version}"` };
};

test("handwritten model/config preflight records readiness but makes no verification claim", () => {
  const result = preflight(model, config, { run: java("21.0.3") });
  assert.deepEqual(result, { model, config, javaVersion: 21 });
});

test("spaced model/config directories work without a shell", () => {
  const spaced = fileURLToPath(new URL("fixtures/space dir/Counter.tla", import.meta.url));
  const cfg = fileURLToPath(new URL("fixtures/space dir/Counter.cfg", import.meta.url));
  assert.equal(preflight(spaced, cfg, { run: java("17.0.1") }).javaVersion, 17);
});

test("missing, mismatched and empty inputs fail before invoking Java", () => {
  const never = () => { assert.fail("Java should not run"); };
  for (const [m, c, pattern] of [
    [model, undefined, /supply a .tla/],
    [model + "-missing", config, /supply a .tla/],
    [model, config + "-missing", /supply a .tla/],
    [fileURLToPath(new URL("fixtures/space dir/Other.tla", import.meta.url)), config, /MODULE name/],
    [model, fileURLToPath(new URL("fixtures/space dir/Empty.cfg", import.meta.url)), /cfg is empty/],
  ]) assert.throws(() => preflight(m, c, { run: never }), pattern);
  assert.throws(() => preflight("missing.tla", config, { run: never }), /cannot read/);
});

test("Java failure, unsupported version and timeout never pass preflight", () => {
  for (const run of [java("11.0.2"), () => ({ status: 1, stderr: "bad" }), () => ({ error: new Error("timed out"), status: null }), () => ({ status: 0, stderr: "unknown" })]) {
    assert.throws(() => preflight(model, config, { run }), /Java/);
  }
});

test("verify CLI stays incomplete even when model and Java inputs are supplied", () => {
  const cli = new URL("../bin/bowerbird.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, "verify", model, "--config", config, "--java", "not-a-java-executable"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Java preflight failed/);
  assert.doesNotMatch(result.stdout + result.stderr, /verification passed|rules passed/i);
  const missing = spawnSync(process.execPath, [cli, "verify", model], { encoding: "utf8" });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /supply a .tla/);
});
