// Status sync: derive each node's implemented/partial/planned status from
// repository facts, so a commit can refresh "built vs remaining" on the map.
//
// Policy (owner decision): a component is built once its work is tested and
// merged. "Merged" means present on the merge target (the default branch),
// read from that ref's tree, so feature-branch work shows as partial until
// its pull request lands.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { normalise, STATUSES } from "./model.mjs";

function git(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

const lines = (s) => s.split("\0").filter(Boolean);

// Explicit ref > meta.statusRef > origin's default branch > main > master.
export function resolveMergeRef(repoRoot, preferred) {
  const candidates = [preferred];
  try { candidates.push(git(repoRoot, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]).trim().replace(/^refs\/remotes\//, "")); } catch {}
  candidates.push("origin/main", "main", "origin/master", "master");
  for (const ref of candidates.filter(Boolean)) {
    try { git(repoRoot, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]); return ref; } catch {}
  }
  return null;
}

// Facts are gathered once per sync; deriveNodeStatus stays a pure function so
// it is trivially testable without a git repository.
export function gatherFacts(repoRoot, { mergeRef } = {}) {
  const tracked = new Set(lines(git(repoRoot, ["ls-files", "-z"])));
  let staged = new Set();
  try { staged = new Set(lines(git(repoRoot, ["diff", "--cached", "--name-only", "-z"]))); } catch {}
  const ref = resolveMergeRef(repoRoot, mergeRef);
  const merged = ref ? new Set(lines(git(repoRoot, ["ls-tree", "-r", "-z", "--name-only", ref]))) : new Set();
  return { tracked, staged, merged, mergeRef: ref };
}

// Glob-lite: "dir/" matches any file under dir; "*" matches one segment.
export function pathPresent(pattern, files) {
  const p = pattern.replace(/^\.\//, "");
  if (p.endsWith("/")) { for (const f of files) if (f.startsWith(p)) return true; return false; }
  if (!p.includes("*")) return files.has(p);
  const re = new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);
  for (const f of files) if (re.test(f)) return true;
  return false;
}

/**
 * Decide one node's status from its evidence and the repository facts.
 *
 * node.evidence = { paths: string[], tests?: string[], status?: "pinned" }
 * facts         = { tracked, staged, merged: Set<string> }
 * returns       "implemented" | "partial" | "planned" | null (null = leave as is)
 */
export function deriveNodeStatus(node, facts) {
  const ev = node.evidence;
  if (!ev || ev.status === "pinned") return null;
  const paths = ev.paths ?? [];
  const tests = ev.tests ?? [];
  if (!paths.length && !tests.length) return null;
  const onMain = (p) => pathPresent(p, facts.merged);
  const anywhere = (p) => onMain(p) || pathPresent(p, facts.tracked) || pathPresent(p, facts.staged ?? new Set());
  // Built: tested (at least one declared test) and merged (every path and test on the merge target).
  if (tests.length && [...paths, ...tests].every(onMain)) return "implemented";
  // Partial: work exists somewhere (a branch, the index, or merged but untested).
  if ([...paths, ...tests].some(anywhere)) return "partial";
  return "planned";
}

// Keep every evidence value's original JSON bytes even when status changes.
// Walk JSON strings and balanced values rather than matching braces inside labels.
function evidenceValues(text) {
  const values = [];
  let i = 0;
  const quoted = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i++] === '"') break;
    }
    return text.slice(start, i);
  };
  while (i < text.length) {
    if (text[i] !== '"') { i++; continue; }
    const key = quoted();
    if (key !== '"evidence"') continue;
    let j = i;
    while (/\s/.test(text[j] ?? "")) j++;
    if (text[j] !== ":") continue;
    j++;
    while (/\s/.test(text[j] ?? "")) j++;
    const start = j;
    if (text[j] === "{" || text[j] === "[") {
      const stack = [];
      i = j;
      do {
        if (text[i] === '"') { quoted(); continue; }
        if (text[i] === "{" || text[i] === "[") stack.push(text[i]);
        if (text[i] === "}" || text[i] === "]") stack.pop();
        i++;
      } while (stack.length && i < text.length);
    } else if (text[j] === '"') { i = j; quoted(); }
    else { i = j; while (i < text.length && !/[,}\]]/.test(text[i])) i++; }
    values.push({ start, end: i, value: text.slice(start, i).trimEnd() });
  }
  return values;
}

function keepEvidenceBytes(before, after) {
  const old = evidenceValues(before), fresh = evidenceValues(after);
  if (old.length !== fresh.length) throw new Error("evidence count changed during status sync");
  for (let i = fresh.length - 1; i >= 0; i--) after = after.slice(0, fresh[i].start) + old[i].value + after.slice(fresh[i].end);
  return after;
}

export function syncFile(file, { repoRoot = process.cwd(), write = true, facts, mergeRef } = {}) {
  const source = readFileSync(file, "utf8");
  const raw = JSON.parse(source);
  normalise(raw);
  const f = facts ?? gatherFacts(repoRoot, { mergeRef: mergeRef ?? raw.meta?.statusRef });
  const changes = [];
  for (const node of raw.nodes) {
    const next = deriveNodeStatus(node, f);
    if (next === null || next === undefined) continue;
    if (!STATUSES.includes(next)) throw new Error(`deriveNodeStatus returned "${next}" for ${node.id}`);
    if ((node.status ?? "planned") !== next) {
      changes.push({ id: node.id, title: node.title, from: node.status ?? "planned", to: next });
      node.status = next;
    }
  }
  if (write && changes.length) writeFileSync(file, keepEvidenceBytes(source, JSON.stringify(raw, null, 2) + "\n"));
  return { changes, mergeRef: f.mergeRef ?? null };
}
