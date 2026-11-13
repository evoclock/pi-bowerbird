// Reconcile only marked task nodes and their dependency edges; leave hand-authored structure alone.
import { normalise } from "./model.mjs";

const edgeKey = (e) => `${e.from}\u0000${e.to}`;
const generatedEdge = (e, managed) => e.kind === "control" && e.label === "blocks" && managed.has(e.from) && managed.has(e.to);

export function updatePlan(existing, incoming) {
  normalise(existing);
  normalise(incoming);
  const previous = new Map(existing.nodes.filter((n) => n.planId).map((n) => [n.planId, n]));
  const wanted = new Map(incoming.nodes.map((n) => [n.planId, n]));
  const occupied = new Set(existing.nodes.filter((n) => !n.planId || wanted.has(n.planId)).flatMap((n) => {
    const cells = [];
    for (let x = 0; x < (n.span?.[0] ?? 1); x++) for (let y = 0; y < (n.span?.[1] ?? 1); y++) cells.push(`${n.at[0] + x},${n.at[1] + y}`);
    return cells;
  }));
  const nodes = existing.nodes.filter((n) => !n.planId || wanted.has(n.planId)).map((n) => {
    if (!n.planId) return n;
    const next = wanted.get(n.planId);
    const changed = { ...n, title: next.title, status: next.status };
    if (next.details && (!n.details || /^PR #\d+/.test(n.details))) changed.details = next.details;
    else if (!next.details && /^PR #\d+/.test(n.details ?? "")) delete changed.details;
    return changed;
  });
  for (const next of incoming.nodes) {
    if (previous.has(next.planId)) continue;
    if (nodes.some((n) => n.id === next.id)) throw new Error(`plan: imported ID ${next.id} conflicts with a hand-authored node`);
    let row = 0;
    while (occupied.has(`0,${row}`)) row++;
    occupied.add(`0,${row}`);
    nodes.push({ ...next, at: [0, row] });
  }
  const idOf = (id) => previous.get(id)?.id ?? id;
  const plannedEdges = incoming.edges.map((e) => ({ ...e, from: idOf(e.from), to: idOf(e.to) }));
  const desiredEdges = new Map(plannedEdges.map((e) => [edgeKey(e), e]));
  const oldIds = new Set(previous.values().map((n) => n.id));
  const keptEdges = existing.edges.filter((e) => !generatedEdge(e, oldIds) || desiredEdges.has(edgeKey(e)));
  const present = new Set(keptEdges.map(edgeKey));
  const edges = [...keptEdges, ...plannedEdges.filter((e) => !present.has(edgeKey(e)))];
  const diagram = { ...existing, nodes, edges };
  normalise(diagram);
  const changed = JSON.stringify(diagram) !== JSON.stringify(existing);
  return { diagram: changed ? diagram : existing, changed };
}
