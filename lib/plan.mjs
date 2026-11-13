// Deterministic planned-work import. Markdown is treated as a task ledger, never as a file tree.
import { SCHEMA, normalise } from "./model.mjs";

const ID = /\b(?:P\d+(?:\.\d+)*|T\d+[a-z]?(?:-min)?|T-\d{3,5})\b/gi;
const STATES = /\b(DONE|IMPLEMENTED|PR OPEN|ACTIVE CHILD|PENDING|BLOCKED|DEFERRED|QUARANTINED)\b/i;
const clean = (s) => s.replace(/`/g, "").replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
const ids = (s) => [...new Set([...s.matchAll(ID)].map((m) => m[0].toUpperCase()))];
const cells = (line) => line.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(clean);
const state = (s) => {
  const value = s.toUpperCase();
  if (/\bPR OPEN\b|\bACTIVE CHILD\b/.test(value)) return "partial";
  if (/\bDONE\b/.test(value)) return "implemented";
  if (/\bIMPLEMENTED\b/.test(value)) return "partial";
  return "planned";
};

export function parseWork(markdown) {
  const work = new Map();
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^#{2,4}\s+((?:P\d+(?:\.\d+)*|T\d+[a-z]?(?:-min)?|T-\d{3,5}))\b[.\s:—-]*(.*)/i);
    if (heading) {
      const id = heading[1].toUpperCase();
      const prior = work.get(id) ?? { id, title: id, deps: [], status: "planned" };
      if (prior.title === id && clean(heading[2])) prior.title = clean(heading[2]);
      work.set(id, prior);
      continue;
    }
    if (!/^\s*\|/.test(lines[i]) || i + 1 >= lines.length || !/^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) continue;
    const headers = cells(lines[i]).map((h) => h.toLowerCase());
    const idCol = headers.findIndex((h) => /^(p|id|task id|child|task|#)$/.test(h));
    if (idCol < 0) continue;
    const titleCol = headers.findIndex((h) => /^(task|title|goal)$/.test(h) && h !== headers[idCol]);
    const statusCol = headers.findIndex((h) => /^(state|status)$/.test(h));
    const depsCol = headers.findIndex((h) => /^(depends on|dependencies|blocked by|parent)$/.test(h));
    const infoCol = headers.findIndex((h) => /^(evidence or next action|definition of done or hold|notes)$/.test(h));
    i += 1;
    while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) {
      const row = cells(lines[++i]);
      const rawId = row[idCol] ?? "";
      if (!/^(?:P\d+(?:\.\d+)*|T\d+[a-z]?(?:-min)?|T-\d{3,5})$/i.test(rawId)) continue;
      const id = rawId.toUpperCase();
      const prior = work.get(id) ?? { id, title: id, deps: [], status: "planned" };
      const title = titleCol < 0 ? "" : clean(row[titleCol] ?? "");
      if (title && prior.title === id) prior.title = title;
      if (statusCol >= 0 && STATES.test(row[statusCol] ?? "")) prior.status = state(row[statusCol]);
      const deps = depsCol < 0 ? [] : ids(row[depsCol] ?? "");
      prior.deps = [...new Set([...prior.deps, ...deps.filter((dep) => dep !== id)])];
      if (infoCol >= 0) prior.prs = [...new Set([...(prior.prs ?? []), ...[...(row[infoCol] ?? "").matchAll(/\bPR\s+#(\d+)\b/gi)].map((m) => Number(m[1]))])];
      work.set(id, prior);
    }
  }
  return work;
}

export function planDiagram({ tasks, specs = [], prs = [], title = "Planned work" }) {
  if (typeof tasks !== "string") throw new TypeError("tasks must be Markdown text");
  if (!Array.isArray(specs) || specs.some((s) => typeof s !== "string")) throw new TypeError("specs must be Markdown texts");
  if (!Array.isArray(prs)) throw new TypeError("prs must be an array");
  const work = parseWork(tasks);
  for (const spec of specs) for (const [id, item] of parseWork(spec)) {
    const prior = work.get(id);
    if (prior) { if (prior.title === id) prior.title = item.title; prior.deps = [...new Set([...prior.deps, ...item.deps])]; }
  }
  const items = [...work.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const nodes = items.map((item, index) => {
    const matched = prs.filter((pr) => Number.isInteger(pr.number) &&
      ((item.prs ?? []).includes(pr.number) || ids(String(pr.headRefName ?? "")).includes(item.id)))
      .sort((a, b) => a.number - b.number);
    const status = item.status === "planned" && matched.some((pr) => pr.state === "OPEN") ? "partial" : item.status;
    const short = item.title.length > 18 ? `${item.title.slice(0, 17).trimEnd()}…` : item.title;
    const details = [short !== item.title ? `Task: ${item.title}` : "",
      ...matched.map((pr) => `PR #${pr.number}${pr.url ? `: ${pr.url}` : ""} (${pr.headRefName ?? "unknown branch"})`)].filter(Boolean).join("\n");
    return { id: item.id, planId: item.id, title: short, at: [index % 4, Math.floor(index / 4)], status,
      ...(details ? { details } : {}) };
  });
  const known = new Set(items.map((item) => item.id));
  const edges = items.flatMap((item) => item.deps.filter((dep) => known.has(dep)).sort().map((dep) => ({ from: dep, to: item.id, kind: "control", label: "blocks" })));
  const diagram = { schema: SCHEMA, meta: { title, statusTracking: true }, nodes, edges };
  normalise(diagram);
  return diagram;
}
