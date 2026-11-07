// Structural changes between two versions of a diagram: what the map says
// changed since a git ref, short enough to scan at a glance.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { normalise } from "./model.mjs";

const edgeKey = (e) => `${e.from} -> ${e.to}${e.event ? ` on ${e.event}` : ""}`;

export function diffModels(before, after) {
  const changes = [];
  const bNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const aNodes = new Map(after.nodes.map((n) => [n.id, n]));
  for (const [id, n] of aNodes) {
    const old = bNodes.get(id);
    if (!old) { changes.push({ type: "node-added", id, text: `+ ${n.title ?? id}` }); continue; }
    if ((old.status ?? "planned") !== (n.status ?? "planned")) changes.push({ type: "status", id, text: `~ ${n.title ?? id}: ${old.status ?? "planned"} -> ${n.status ?? "planned"}` });
    if (old.title !== n.title) changes.push({ type: "renamed", id, text: `~ ${id}: "${old.title}" -> "${n.title}"` });
  }
  for (const [id, n] of bNodes) if (!aNodes.has(id)) changes.push({ type: "node-removed", id, text: `- ${n.title ?? id}` });
  const bEdges = new Map(before.edges.map((e) => [edgeKey(e), e]));
  const aEdges = new Map(after.edges.map((e) => [edgeKey(e), e]));
  for (const [k, e] of aEdges) {
    const old = bEdges.get(k);
    if (!old) changes.push({ type: "edge-added", text: `+ ${k}${e.guard ? ` [${e.guard}]` : ""}` });
    else if ((old.guard ?? "") !== (e.guard ?? "") || (old.action ?? "") !== (e.action ?? "") || old.kind !== e.kind) changes.push({ type: "edge-changed", text: `~ ${k}: ${old.label ?? ""} -> ${e.label ?? ""}` });
  }
  for (const k of bEdges.keys()) if (!aEdges.has(k)) changes.push({ type: "edge-removed", text: `- ${k}` });
  return changes;
}

export function diffAgainst(file, { ref = "HEAD", repoRoot = process.cwd(), current, sourcePath = file } = {}) {
  const rel = path.relative(repoRoot, path.resolve(sourcePath)).split(path.sep).join("/");
  let before;
  try {
    before = normalise(JSON.parse(execFileSync("git", ["-C", repoRoot, "show", `${ref}:${rel}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })));
  } catch {
    return { ref, changes: [{ type: "new-file", text: `+ ${rel} (not present at ${ref})` }] };
  }
  return { ref, changes: diffModels(before, current) };
}
