import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseValue, parseGraph, interpretEvidence } from "../lib/tlc-evidence.mjs";
import { runTlc } from "../lib/tlc-runner.mjs";

const fixture = (name) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const jar = process.env.TLC_TEST_JAR;
const java = process.env.TLC_TEST_JAVA ?? "java";
const available = Boolean(jar);
const out = () => path.join(mkdtempSync(path.join(process.cwd(), ".tlc-test-")), "evidence");
const run = (name, config) => { const destination = out(); return runTlc(fixture(name), fixture(config), { jar, java, out: destination }).then((record) => ({ record, destination,
  evidence: JSON.parse(readFileSync(path.join(destination, "evidence.json"), "utf8")) })); };

// Why: unknown value syntax must not be coerced to an apparently verified value.
test("TLC values preserve types and reject unsupported syntax", () => {
  assert.deepEqual(parseValue('"hello world"'), { type: "string", value: "hello world" });
  assert.deepEqual(parseValue("-9007199254740993"), { type: "integer", value: "-9007199254740993" });
  assert.deepEqual(JSON.parse(JSON.stringify(parseValue("{TRUE, [a |-> <<1, Token>>]}"))), { type: "set", elements: [
    { type: "boolean", value: true }, { type: "record", fields: { a: { type: "sequence", elements: [{ type: "integer", value: "1" }, { type: "model-value", name: "Token" }] } } },
  ] });
  assert.throws(() => parseValue("1..3"), /unsupported TLC value syntax/);
  assert.throws(() => parseValue("[a |-> 1, a |-> 2]"), /invalid TLC record field/);
});

// Why: a truncated graph or missing edge must be unchecked, not a clean projection.
test("malformed and incomplete machine graphs reject rather than invent states", () => {
  const complete = 'strict digraph DiskGraph {\nnodesep=0.35;\nsubgraph cluster_graph {\ncolor="white";\n1 [label="n = 0",style = filled]\n1 -> 2 [label="Step",color="black",fontcolor="black"];\n2 [label="n = 1"];\n}\n}\n';
  assert.deepEqual(parseGraph(complete).edges, [{ from: "1", to: "2", action: "Step" }]);
  assert.throws(() => parseGraph(complete.slice(0, -2)), /incomplete TLC DOT graph/);
  assert.throws(() => parseGraph(complete.replace('2 [label="n = 1"];\n', '')), /missing TLC states/);
  const destination = mkdtempSync(path.join(process.cwd(), ".tlc-test-"));
  writeFileSync(path.join(destination, "tlc.dot"), complete.slice(0, -2));
  writeFileSync(path.join(destination, "tlc.stdout"), "@!@!@STARTMSG 2193:0 @!@!@\n@!@!@STARTMSG 2186:0 @!@!@\n");
  const evidence = interpretEvidence({ exitCode: 0, inputs: { config: { path: fixture("Counter.cfg") } } }, destination);
  assert.equal(evidence.outcome, "unchecked");
  assert.deepEqual(evidence.rules.map((rule) => [rule.id, rule.status]), [["TypeOK", "unchecked"]]);
  writeFileSync(path.join(destination, "tlc.dot"), complete);
  const missingCount = interpretEvidence({ exitCode: 0, inputs: { config: { path: fixture("Counter.cfg") } } }, destination);
  assert.equal(missingCount.outcome, "unchecked");
  assert.match(missingCount.reason, /final state counts/);
  const reducedConfig = path.join(destination, "reduced.cfg");
  writeFileSync(reducedConfig, "SPECIFICATION Spec\nINVARIANT TypeOK\nCONSTRAINT SmallStates\n");
  const reduced = interpretEvidence({ exitCode: 0, inputs: { config: { path: reducedConfig } } }, destination);
  assert.equal(reduced.outcome, "unchecked");
  assert.ok(reduced.rules.every((rule) => rule.status === "unchecked"));
  assert.match(reduced.reason, /reductions and boundary/);
});

// Why: a finite pass records actual initial states, action edges, typed values and checked rule provenance.
test("real TLC pass agrees with machine graph and completion log", { skip: !available && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const { record, evidence, destination } = await run("Counter.tla", "Counter.cfg");
  const stdout = readFileSync(path.join(destination, "tlc.stdout"), "utf8");
  assert.equal(record.exitCode, 0);
  assert.equal(evidence.outcome, "completed");
  assert.match(stdout, /@!@!@STARTMSG 2193:0/);
  assert.equal(evidence.states.length, 3);
  assert.equal(evidence.initial.length, 1);
  assert.equal(evidence.edges.length, 2);
  assert.ok(evidence.edges.every((edge) => edge.action === "Increment"));
  assert.equal(evidence.rules.find((r) => r.id === "TypeOK")?.status, "checked-no-violation");
  assert.ok(evidence.states.every((s) => s.exploration === "explored"));
});

// Why: a known violation needs the same rule, concrete states and witness edges in both sources.
test("real TLC invariant failure has linked finite-prefix provenance", { skip: !available && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const { record, evidence, destination } = await run("Counter.tla", "CounterFail.cfg");
  const stdout = readFileSync(path.join(destination, "tlc.stdout"), "utf8");
  assert.equal(record.exitCode, 1);
  assert.match(stdout, /Invariant UnderTwo is violated/);
  assert.equal(evidence.rules.find((r) => r.id === "UnderTwo")?.status, "violated");
  assert.equal(evidence.trace.rule, "UnderTwo");
  assert.equal(evidence.trace.kind, "finite-prefix");
  assert.equal(evidence.trace.steps.length, 3);
  assert.deepEqual(evidence.trace.steps.map((step) => evidence.states.find((s) => s.id === step.state).values.count.value), ["0", "1", "2"]);
  assert.equal(evidence.boundary, "unknown (stopped at violation)");
});

// Why: typed model values must stay distinct from display strings and unsafe number conversion.
test("real TLC values retain booleans, sets, sequences, records and model values", { skip: !available && "Set TLC_TEST_JAR to run real TLC tests" }, async () => {
  const { record, evidence } = await run("Typed.tla", "Typed.cfg");
  assert.equal(record.exitCode, 0, record.reason);
  const values = evidence.states[0].values;
  assert.equal(values.flag.type, "boolean");
  assert.equal(values.index.type, "integer");
  assert.equal(values.bag.type, "set");
  assert.equal(values.steps.type, "sequence");
  assert.equal(values.data.type, "record");
  assert.equal(values.token.type, "model-value");
  assert.equal(evidence.rules.find((rule) => rule.id === "deadlock")?.status, "checked-no-violation");
});
