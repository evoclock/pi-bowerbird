// Bowerbird diagram model: parse, validate, and normalise a *.bower.json file.
// Layout is grid-based on purpose: agents place nodes by [col,row] and the
// renderer owns pixels, so re-renders are deterministic and diffs stay small.

export const SCHEMA = "bowerbird/v1";
export const STATUSES = ["implemented", "partial", "planned"];
export const EDGE_KINDS = ["data", "control", "failure"];
// Statechart pseudo-states render as small glyphs; "state"/"card" are boxes.
export const SHAPES = ["card", "state", "initial", "final", "choice"];
export const PSEUDO = new Set(["initial", "final", "choice"]);

// UML transition label: event [guard] / action. Kept as fields so TLA+ and
// journey export can read structure instead of parsing prose.
export function transitionLabel(e) {
  if (e.label) return e.label;
  const parts = [];
  if (e.event) parts.push(e.event);
  if (e.guard) parts.push(`[${e.guard}]`);
  if (e.action) parts.push(`/ ${e.action}`);
  return parts.length ? parts.join(" ") : undefined;
}
const SIDES = ["top", "right", "bottom", "left"];

const DEFAULT_CATEGORIES = {
  sage: { label: "Planning" },
  rust: { label: "Workers" },
  peach: { label: "Review" },
  mustard: { label: "Execution" },
  slate: { label: "Routing" },
  mauve: { label: "Persistence" },
};

export class BowerError extends Error {
  constructor(problems) {
    super(`bowerbird: ${problems.length} problem(s)\n` + problems.map((p) => `  - [${p.code}] ${p.message}`).join("\n"));
    this.problems = problems;
  }
}

export function normalise(input) {
  const problems = [];
  const fail = (code, message) => problems.push({ code, message });
  if (input?.schema !== SCHEMA) fail("schema", `"schema" must be "${SCHEMA}"`);

  const meta = {
    title: "Untitled diagram",
    grid: { col: 300, row: 200, gap: 44 },
    statusTracking: false,
    ...input?.meta,
  };
  meta.grid = { col: 300, row: 200, gap: 44, ...input?.meta?.grid };

  const categories = { ...(input?.categories ?? DEFAULT_CATEGORIES) };
  const zones = (input?.zones ?? []).map((z, i) => ({ category: null, index: i, ...z }));
  const zoneIds = new Set();
  for (const z of zones) {
    if (!z.id) fail("zone-id", `zone #${z.index} has no id`);
    else if (zoneIds.has(z.id)) fail("zone-dup", `duplicate zone id "${z.id}"`);
    zoneIds.add(z.id);
    if (z.category && !categories[z.category]) fail("category", `zone "${z.id}" uses unknown category "${z.category}"`);
  }

  const traceIds = new Set((input?.traces ?? []).map((t) => t.id));
  const nodes = (input?.nodes ?? []).map((n) => ({ lines: [], traces: [], span: [1, 1], ...n }));
  const nodeIds = new Set();
  const occupied = new Map();
  for (const n of nodes) {
    if (!n.id) { fail("node-id", "a node has no id"); continue; }
    if (nodeIds.has(n.id)) fail("node-dup", `duplicate node id "${n.id}"`);
    nodeIds.add(n.id);
    if (n.shape && !SHAPES.includes(n.shape)) fail("shape", `node "${n.id}" shape must be one of ${SHAPES.join(", ")}`);
    if (!n.title && !PSEUDO.has(n.shape)) fail("node-title", `node "${n.id}" has no title`);
    if (!Array.isArray(n.at) || n.at.length !== 2 || !n.at.every(Number.isFinite)) {
      fail("node-at", `node "${n.id}" needs "at": [col, row]`);
      continue;
    }
    if (n.zone && !zoneIds.has(n.zone)) fail("node-zone", `node "${n.id}" references unknown zone "${n.zone}"`);
    if (n.category && !categories[n.category] && !String(n.category).startsWith("#")) {
      fail("category", `node "${n.id}" uses unknown category "${n.category}"`);
    }
    if (n.status && !STATUSES.includes(n.status)) fail("status", `node "${n.id}" status must be one of ${STATUSES.join(", ")}`);
    for (const t of n.traces) if (!traceIds.has(t)) fail("trace", `node "${n.id}" references unknown trace "${t}"`);
    for (let dc = 0; dc < n.span[0]; dc++) {
      for (let dr = 0; dr < n.span[1]; dr++) {
        const key = `${n.at[0] + dc},${n.at[1] + dr}`;
        if (occupied.has(key)) fail("overlap", `nodes "${occupied.get(key)}" and "${n.id}" share grid cell ${key}`);
        occupied.set(key, n.id);
      }
    }
  }

  const edges = (input?.edges ?? []).map((e, i) => ({ kind: "data", traces: [], index: i, ...e, label: transitionLabel(e) }));
  for (const e of edges) {
    if (!nodeIds.has(e.from)) fail("edge-from", `edge #${e.index} from unknown node "${e.from}"`);
    if (!nodeIds.has(e.to)) fail("edge-to", `edge #${e.index} to unknown node "${e.to}"`);
    if (e.from === e.to) fail("edge-self", `edge #${e.index} is a self-loop; not supported`);
    if (!EDGE_KINDS.includes(e.kind)) fail("edge-kind", `edge #${e.index} kind must be one of ${EDGE_KINDS.join(", ")}`);
    for (const side of [e.fromSide, e.toSide]) {
      if (side && !SIDES.includes(side)) fail("edge-side", `edge #${e.index} side "${side}" must be one of ${SIDES.join(", ")}`);
    }
    for (const t of e.traces) if (!traceIds.has(t)) fail("trace", `edge #${e.index} references unknown trace "${t}"`);
  }

  if (meta.direction && !["LR", "TD"].includes(meta.direction)) fail("direction", `meta.direction must be "LR" or "TD"`);
  if (meta.style && !["restrained", "expressive"].includes(meta.style)) fail("style", `meta.style must be "restrained" or "expressive"`);
  if (meta.categoryFillParity && !["mode", "dark"].includes(meta.categoryFillParity)) fail("category-fill-parity", `meta.categoryFillParity must be "mode" or "dark"`);
  meta.style ??= "restrained";
  meta.categoryFillParity ??= "mode";
  if (problems.length) throw new BowerError(problems);
  const model = { meta, categories, zones, nodes, edges, traces: input.traces ?? [] };
  return meta.direction === "TD" ? transpose(model) : model;
}

// Authors lay out on a grid in reading order; TD is the same grid transposed.
// Swapping cells, spans, gaps, and pinned sides is enough: routing, labels,
// iso projection, and TLA+ export never assume a direction.
const SIDE_T = { right: "bottom", bottom: "right", left: "top", top: "left" };
function transpose(model) {
  // Preserve node width/height; only the channels swap axes.
  const { col, row, gap } = model.meta.grid;
  const [gx, gy] = Array.isArray(gap) ? gap : [gap, gap];
  model.meta.grid = { ...model.meta.grid, col: col - gx + gy, row: row - gy + gx, gap: [gy, gx] };
  for (const n of model.nodes) { n.at = [n.at[1], n.at[0]]; n.span = [n.span[1], n.span[0]]; }
  for (const e of model.edges) {
    if (e.fromSide) e.fromSide = SIDE_T[e.fromSide];
    if (e.toSide) e.toSide = SIDE_T[e.toSide];
  }
  return model;
}

export function statusSummary(model) {
  const counts = { implemented: 0, partial: 0, planned: 0, untracked: 0 };
  // With tracking on, a node without a status is drawn as planned; count it so.
  const fallback = model.meta.statusTracking ? "planned" : "untracked";
  for (const n of model.nodes) counts[n.status ?? fallback] += 1;
  return counts;
}
