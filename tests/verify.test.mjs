import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { normalise } from "../lib/model.mjs";
import { analyse, journeys, toTla } from "../lib/verify.mjs";
import { diffModels } from "../lib/diff.mjs";

const FILE = new URL("../examples/proposal-to-merge.bower.json", import.meta.url);
const lifecycle = () => normalise(JSON.parse(readFileSync(FILE, "utf8")));

test("check finds the two seeded statechart faults", () => {
  const found = analyse(lifecycle()).map((f) => `${f.code}:${f.node}`).sort();
  assert.deepEqual(found, ["ambiguous:blocked", "dead-end:lease"]);
});

test("a fixed statechart has no findings", () => {
  const raw = JSON.parse(readFileSync(FILE, "utf8"));
  raw.edges.find((e) => e.from === "blocked" && e.to === "dropped").guard = "grant refused";
  raw.edges.push({ from: "lease", to: "dispatched", event: "lease", guard: "worker free" }, { from: "lease", to: "dropped", event: "expire" });
  assert.deepEqual(analyse(normalise(raw)), []);
});

test("journeys start at the initial target and end at a final or dead end", () => {
  const js = journeys(lifecycle());
  assert.ok(js.length >= 3);
  assert.match(js[0], /^Journey 1: Proposed -> /);
  assert.match(js[0], /Given the chart is in "Proposed"/);
  assert.ok(js.some((j) => j.includes('"Awaiting lease"')));
});

test("TLA+ output declares every state and one action per transition", () => {
  const model = lifecycle();
  const { tla, cfg } = toTla(model, "ProposalToMerge");
  assert.match(tla, /MODULE ProposalToMerge/);
  for (const n of model.nodes.filter((x) => x.shape !== "initial")) assert.ok(tla.includes(`"${n.id}"`), n.id);
  assert.equal((tla.match(/^T\d+_/gm) ?? []).length, model.edges.length - 1);
  assert.match(cfg, /CHECK_DEADLOCK TRUE/);
});

const chart = (nodes, edges) => normalise({ schema: "bowerbird/v1", meta: { title: "Test", kind: "statechart" }, nodes, edges });
const initial = { id: "init", title: "Init", shape: "initial", at: [0, 0] };
const done = { id: "done", title: "Done", shape: "final", at: [1, 0] };

test("no finals warn without making check fail or claiming completion", () => {
  const model = chart([initial, { id: "work", title: "Work", at: [1, 0] }], [{ from: "init", to: "work" }]);
  assert.equal(analyse(model).find((f) => f.code === "no-final")?.severity, "warning");
  assert.ok(!analyse(model).some((f) => f.severity === "error"));
  const dir = mkdtempSync(path.join(os.tmpdir(), "bowerbird-verify-"));
  try {
    const file = path.join(dir, "test.bower.json");
    writeFileSync(file, JSON.stringify({ schema: "bowerbird/v1", meta: { title: "Test", kind: "statechart" }, nodes: [initial, { id: "work", title: "Work", at: [1, 0] }], edges: [{ from: "init", to: "work" }] }));
    const result = spawnSync(process.execPath, [new URL("../bin/bowerbird.mjs", import.meta.url).pathname, "check", file], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /every state can finish/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("initial must have exactly one outgoing transition in both verifier and exporter", () => {
  for (const edges of [[], [{ from: "init", to: "done" }, { from: "init", to: "work" }]]) {
    const nodes = edges.length ? [initial, done, { id: "work", title: "Work", at: [2, 0] }] : [initial, done];
    const model = chart(nodes, edges);
    assert.equal(analyse(model).find((f) => f.code === "initial-out")?.severity, "error");
    assert.throws(() => toTla(model), /the initial pseudo-state needs exactly one outgoing transition/);
  }
});

test("final outgoing edge is an error but journeys stop and TLA preserves it", () => {
  const model = chart([initial, done, { id: "after", title: "After", at: [2, 0] }], [{ from: "init", to: "done" }, { from: "done", to: "after", event: "continue" }]);
  assert.deepEqual(analyse(model).filter((f) => f.code === "final-out").map((f) => [f.severity, f.node]), [["error", "done"]]);
  assert.ok(journeys(model).every((j) => !j.includes("After")));
  assert.ok(toTla(model).tla.includes('state = "done" /\\ state\' = "after"'));
});

test("diff reports added, removed, and status changes", () => {
  const before = normalise({ schema: "bowerbird/v1", meta: { title: "t" }, nodes: [{ id: "a", title: "A", at: [0, 0] }, { id: "b", title: "B", at: [1, 0] }], edges: [{ from: "a", to: "b" }] });
  const after = normalise({ schema: "bowerbird/v1", meta: { title: "t" }, nodes: [{ id: "a", title: "A", at: [0, 0], status: "implemented" }, { id: "c", title: "C", at: [1, 0] }], edges: [{ from: "a", to: "c" }] });
  const types = diffModels(before, after).map((c) => c.type).sort();
  assert.deepEqual(types, ["edge-added", "edge-removed", "node-added", "node-removed", "status"]);
});
