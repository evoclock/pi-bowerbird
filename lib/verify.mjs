// Statechart verification bridge. Three levels, cheapest first:
//   1. analyse(): graph checks that need no tools (unreachable, dead ends,
//      ambiguous transitions).
//   2. journeys(): initial -> final paths as Given/When/Then lines, to seed a
//      pstack verification skill's feature map.
//   3. toTla(): a TLA+ module + TLC config for model checking.
// The diagram is the single source, so the spec and the picture always agree.

function graph(model) {
  const out = new Map(model.nodes.map((n) => [n.id, []]));
  for (const e of model.edges) out.get(e.from).push(e);
  const initials = model.nodes.filter((n) => n.shape === "initial");
  const finals = new Set(model.nodes.filter((n) => n.shape === "final").map((n) => n.id));
  return { out, initials, finals };
}

export function analyse(model) {
  const { out, initials, finals } = graph(model);
  const findings = [];
  if (initials.length !== 1) findings.push({ code: "initial-count", severity: "error", message: `statechart needs exactly one initial pseudo-state, found ${initials.length}` });
  if (!finals.size) findings.push({ code: "no-final", severity: "warning", message: "can finish was not checked because there are no final states" });
  for (const id of finals) if (out.get(id).length) findings.push({ code: "final-out", severity: "error", node: id, message: `final state "${id}" has outgoing transitions` });
  if (initials.length === 1 && out.get(initials[0].id).length !== 1) findings.push({ code: "initial-out", severity: "error", node: initials[0].id, message: "the initial pseudo-state needs exactly one outgoing transition" });
  if (!initials.length) return findings;

  const seen = new Set();
  const stack = [initials[0].id];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of out.get(id)) stack.push(e.to);
  }
  for (const n of model.nodes) {
    if (!seen.has(n.id)) findings.push({ code: "unreachable", severity: "error", node: n.id, message: `"${n.title ?? n.id}" cannot be reached from the initial state` });
  }

  // Dead end: a non-final state from which no final state is reachable.
  const reverse = new Map(model.nodes.map((n) => [n.id, []]));
  for (const e of model.edges) reverse.get(e.to).push(e.from);
  const canFinish = new Set();
  const queue = [...finals];
  while (queue.length) {
    const id = queue.pop();
    if (canFinish.has(id)) continue;
    canFinish.add(id);
    queue.push(...reverse.get(id));
  }
  if (finals.size) {
    for (const n of model.nodes) {
      if (seen.has(n.id) && !canFinish.has(n.id)) {
        findings.push({ code: "dead-end", severity: "error", node: n.id, message: `"${n.title ?? n.id}" is reachable but no final state is reachable from it; nothing can finish from here` });
      }
    }
  }

  // Ambiguity: same source + event, and the guards do not tell them apart.
  for (const [from, edges] of out) {
    const byEvent = new Map();
    for (const e of edges) {
      if (!e.event) continue;
      if (!byEvent.has(e.event)) byEvent.set(e.event, []);
      byEvent.get(e.event).push(e);
    }
    for (const [event, group] of byEvent) {
      if (group.length < 2) continue;
      const guards = group.map((e) => e.guard ?? "");
      if (guards.includes("") || new Set(guards).size < guards.length) {
        findings.push({ code: "ambiguous", severity: "warning", node: from, message: `"${from}" has ${group.length} transitions on "${event}" whose guards do not distinguish them; either one may fire` });
      }
    }
  }
  return findings;
}

export function journeys(model, { limit = 40 } = {}) {
  const { out, initials, finals } = graph(model);
  if (!initials.length) return [];
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const name = (id) => byId.get(id).title ?? id;
  const paths = [];
  // Simple paths only (no repeated state), bounded, deterministic order.
  const walk = (id, edges, visited) => {
    if (paths.length >= limit) return;
    if (finals.has(id) || out.get(id).length === 0) { paths.push(edges); return; }
    for (const e of out.get(id)) {
      if (visited.has(e.to)) continue;
      visited.add(e.to);
      walk(e.to, [...edges, e], visited);
      visited.delete(e.to);
    }
  };
  walk(initials[0].id, [], new Set([initials[0].id]));
  return paths.map((edges, i) => {
    // The first edge leaves the initial pseudo-state: it sets the start.
    const start = edges.length ? name(edges[0].to) : name(initials[0].id);
    const lines = [`Journey ${i + 1}: ${[start, ...edges.slice(1).map((e) => name(e.to))].join(" -> ")}`, `  Given the chart is in "${start}"`];
    for (const e of edges.slice(1)) {
      const guard = e.guard ? ` and ${e.guard}` : "";
      lines.push(`  When ${e.event ?? "it continues"}${guard}`);
      lines.push(`  Then it is in "${name(e.to)}"${e.action ? `, after ${e.action}` : ""}`);
    }
    return lines.join("\n");
  });
}

const tlaId = (s) => String(s).replace(/[^A-Za-z0-9_]/g, "_");

export function toTla(model, moduleName = "Statechart") {
  const { initials, finals } = graph(model);
  if (initials.length !== 1) throw new Error("toTla: statechart needs exactly one initial pseudo-state");
  const states = model.nodes.filter((n) => n.shape !== "initial");
  const initEdges = model.edges.filter((e) => e.from === initials[0].id);
  if (initEdges.length !== 1) throw new Error("toTla: the initial pseudo-state needs exactly one outgoing transition");
  const guards = [...new Set(model.edges.map((e) => e.guard).filter(Boolean))];
  const guardVar = new Map(guards.map((g, i) => [g, `g${i + 1}`]));
  const transitions = model.edges.filter((e) => e.from !== initials[0].id);
  const lines = [
    `---------------------------- MODULE ${tlaId(moduleName)} ----------------------------`,
    `\\* Generated by bowerbird from ${model.meta.title}. Regenerate; do not hand-edit.`,
    `\\* Guards are abstracted to free booleans chosen each step, so TLC explores`,
    `\\* both outcomes. Refine a guard by replacing its variable with real state.`,
    `VARIABLES state${guards.length ? ", " + guards.map((g) => guardVar.get(g)).join(", ") : ""}`,
    `vars == <<state${guards.length ? ", " + guards.map((g) => guardVar.get(g)).join(", ") : ""}>>`,
    ``,
    `States == {${states.map((n) => `"${n.id}"`).join(", ")}}`,
    `Finals == {${[...finals].map((id) => `"${id}"`).join(", ")}}`,
    ...guards.map((g) => `\\* ${guardVar.get(g)} : ${g.replace(/\n/g, " ")}`),
    ``,
    `TypeOK == state \\in States${guards.map((g) => ` /\\ ${guardVar.get(g)} \\in BOOLEAN`).join("")}`,
    ``,
    `Init == state = "${initEdges[0].to}"${guards.map((g) => ` /\\ ${guardVar.get(g)} \\in BOOLEAN`).join("")}`,
    ``,
  ];
  const freshGuards = guards.length ? ` /\\ ${guards.map((g) => `${guardVar.get(g)}' \\in BOOLEAN`).join(" /\\ ")}` : "";
  transitions.forEach((e, i) => {
    const name = `T${i + 1}_${tlaId(e.event ?? `${e.from}_to_${e.to}`)}`;
    e._tla = name;
    const guard = e.guard ? ` /\\ ${guardVar.get(e.guard)}` : "";
    lines.push(`\\* ${e.from} --${e.label ?? ""}--> ${e.to}`);
    lines.push(`${name} == state = "${e.from}"${guard} /\\ state' = "${e.to}"${freshGuards}`);
  });
  lines.push(
    ``,
    `\\* Final states stutter so reaching one is not reported as deadlock.`,
    `Done == state \\in Finals /\\ UNCHANGED vars`,
    ``,
    `Next == ${[...transitions.map((e) => e._tla), "Done"].join("\n    \\/ ")}`,
    ``,
    `Spec == Init /\\ [][Next]_vars /\\ WF_vars(Next)`,
    ``,
    `\\* Liveness: every behaviour eventually finishes (fails on cycles with no exit).`,
    `EventuallyDone == <>(state \\in Finals)`,
    `=============================================================================`,
  );
  const cfg = [`SPECIFICATION Spec`, `INVARIANT TypeOK`, `PROPERTY EventuallyDone`, `CHECK_DEADLOCK TRUE`, ``].join("\n");
  return { tla: lines.join("\n") + "\n", cfg };
}
