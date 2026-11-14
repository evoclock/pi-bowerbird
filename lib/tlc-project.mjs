// Concrete fingerprints are retained in evidence.json; mapped cards have separate display identities.
export const CHART_STATE_BUDGET = 500;
export const CHART_EDGE_BUDGET = 1500;
export class ChartOmittedError extends Error {
  constructor(reason, states, edges) {
    super(reason);
    this.omittedStates = states;
    this.omittedEdges = edges;
  }
}
const nodeId = (fingerprint) => `state_${fingerprint.replace(/^-/u, "n")}`;
const short = (text) => text.length > 26 ? `${text.slice(0, 25)}…` : text;
const display = (typed) => {
  switch (typed.type) {
    case "integer": return typed.value;
    case "boolean": return String(typed.value);
    case "string": return JSON.stringify(typed.value);
    case "model-value": return typed.name;
    case "set": return `set (${typed.elements.length})`;
    case "sequence": return `sequence (${typed.elements.length})`;
    case "record": return `record (${Object.keys(typed.fields).length})`;
    default: throw new Error("projection: unsupported typed value");
  }
};

// Region labels describe one observed joint state, never separate interleaving processes.
function regionLeaves(tree, prefix = [], depth = 0) {
  if (!tree || typeof tree !== "object" || Array.isArray(tree) || depth > 3 || !Object.keys(tree).length) throw new Error("projection: regions need a nonempty nested object (up to three levels)");
  return Object.entries(tree).flatMap(([name, value]) => {
    if (!/^[A-Za-z][\w -]{0,30}$/.test(name)) throw new Error("projection: invalid region name");
    const key = [...prefix, name];
    if (typeof value === "string" && value.trim() && value.length <= 60) return [{ path: key, value }];
    return regionLeaves(value, key, depth + 1);
  });
}
const condition = (leaves) => leaves.map(({ path, value }) => `${path.join(".")}=${value}`).join(" & ");

export function projectFlat(evidence, { view } = {}) {
  if (evidence?.schema !== "bowerbird/tlc-evidence/v1" || !["completed", "violation"].includes(evidence.outcome)) {
    throw new Error("projection: evidence is unchecked; no chart produced");
  }
  const { states, edges, initial, rules, trace } = evidence;
  if (!Array.isArray(states) || !states.length || !Array.isArray(edges) || !Array.isArray(initial) || !initial.length || !Array.isArray(rules)) {
    throw new Error("projection: missing concrete graph or rules");
  }
  if (evidence.graphIdentity === "representative") {
    throw new ChartOmittedError("chart omitted: VIEW/SYMMETRY representative graph cannot be shown as concrete states or steps", states.length, edges.length);
  }
  const ids = new Set(states.map((s) => s.id));
  if (ids.size !== states.length || new Set(initial).size !== initial.length || states.some((s) => !/^(?:-?\d+|boundary_[a-f0-9]{16})$/.test(s.id) || !s.values || typeof s.values !== "object") || initial.some((id) => !ids.has(id))) {
    throw new Error("projection: invalid concrete state identity");
  }
  if (edges.some((e) => !ids.has(e.from) || !ids.has(e.to) || typeof e.action !== "string" || !e.action)) {
    throw new Error("projection: unsupported or missing concrete transition");
  }
  if (new Set(rules.map((r) => r.id)).size !== rules.length) throw new Error("projection: duplicate rule identity");
  const failures = rules.filter((r) => r.status === "violated");
  if ((evidence.outcome === "completed" && (trace || failures.length || !rules.length || rules.some((r) => r.status !== "checked-no-violation"))) ||
      (evidence.outcome === "violation" && (failures.length !== 1 || rules.some((r) => r.status !== "violated" && r.status !== "unchecked") || trace?.rule !== failures[0].id ||
        !(failures[0].kind === "property" ? ["lasso", "stuttering"].includes(trace?.kind) : trace?.kind === "finite-prefix")))) {
    throw new Error("projection: rule results and finite witness disagree");
  }
  const witness = new Map();
  const witnessEdges = new Set();
  if (trace) {
    if (!Array.isArray(trace.steps) || !trace.steps.length || !initial.includes(trace.steps[0].state)) throw new Error("projection: invalid witness start");
    trace.steps.forEach((step, i) => {
      if (!ids.has(step.state)) throw new Error("projection: witness state missing from graph");
      witness.set(step.state, [...(witness.get(step.state) ?? []), i + 1]);
      if (i) {
        const prior = trace.steps[i - 1].state;
        const matching = edges.some((edge) => edge.from === prior && edge.to === step.state && edge.action === step.action);
        if (!matching) throw new Error("projection: witness transition missing from graph");
        witnessEdges.add(`${prior}\u0000${step.state}\u0000${step.action}`);
      }
    });
    if (trace.kind !== "finite-prefix") {
      const loop = trace.loop;
      if (!loop || loop.from !== trace.steps.length - 1 || !Number.isSafeInteger(loop.to) || loop.to < 0 || loop.to >= trace.steps.length ||
          (trace.kind === "stuttering" && (loop.from !== loop.to || loop.action !== "Stutter")) ||
          !edges.some((edge) => edge.from === trace.steps[loop.from].state && edge.to === trace.steps[loop.to].state && edge.action === loop.action &&
            (trace.kind !== "stuttering" || edge.kind === "implicit-stutter"))) throw new Error("projection: temporal loop missing from graph");
      witnessEdges.add(`${trace.steps[loop.from].state}\u0000${trace.steps[loop.to].state}\u0000${loop.action}`);
    }
  }
  for (const s of states) for (const value of Object.values(s.values)) display(value);
  const oversized = states.length > CHART_STATE_BUDGET || edges.length > CHART_EDGE_BUDGET;
  let shownStates = states, shownEdges = edges, omissions = null;
  if (oversized) {
    if (!trace) throw new ChartOmittedError("chart omitted: 500-state chart budget or 1500-step budget exceeded without a witness", states.length, edges.length);
    const selected = new Set(trace.steps.map((step) => step.state));
    shownStates = states.filter((state) => selected.has(state.id));
    shownEdges = edges.filter((edge) => witnessEdges.has(`${edge.from}\u0000${edge.to}\u0000${edge.action}`));
    if (shownStates.length > CHART_STATE_BUDGET || shownEdges.length > CHART_EDGE_BUDGET) {
      throw new ChartOmittedError("chart omitted: witness exceeds 500-state chart budget or 1500-step budget", states.length, edges.length);
    }
    omissions = { states: states.length - shownStates.length, edges: edges.length - shownEdges.length,
      policy: "counterexample-first, witness-only", completeness: "partial" };
  }
  const constrained = evidence.reductions?.some((r) => r.kind === "CONSTRAINT" || r.kind === "ACTION_CONSTRAINT");
  const broken = trace?.kind === "finite-prefix" ? trace.steps.at(-1).state : null;
  const loopTarget = trace?.loop ? trace.steps[trace.loop.to].state : null;
  const nodes = shownStates.map((s, i) => {
    const marks = [];
    if (witness.has(s.id)) marks.push({ kind: "bugPath", label: `${trace.rule} step ${witness.get(s.id).join(", ")}`, trace: "evidence.json" });
    if (s.id === broken) marks.push({ kind: "breaks", label: trace.rule, trace: "evidence.json" });
    return {
      id: nodeId(s.id), at: [i % 4, Math.floor(i / 4)], shape: "state", title: `State ${i + 1}`,
      lines: [s.exploration === "boundary-unexplored" ? "Boundary (unexplored)" : initial.includes(s.id) ? "Initial model state" : "Concrete model state",
        ...(s.id === loopTarget ? [trace.kind === "stuttering" ? "Implicit stuttering loop" : "Temporal loop returns here"] : []),
        ...(s.id === broken && trace.rule === "deadlock" ? ["No enabled Next successor"] : []),
        ...Object.entries(s.values).slice(0, 1).map(([name, value]) => short(`${name} = ${display(value)}`))],
      details: `${s.origin === "tlc.stdout" ? "Witness-derived boundary ID" : "Concrete fingerprint"}: ${s.id}. ${omissions ? `${edges.filter((edge) => edge.from === s.id).length - shownEdges.filter((edge) => edge.from === s.id).length} outgoing step omitted from this partial chart. ` : ""}${constrained ? "Constraint-excluded successors are not shown; a missing arrow does not imply a terminal or a boundary deadlock check. " : ""}Full typed values, rule results and provenance: [evidence.json](evidence.json).`,
      ...(marks.length ? { evidence: { marks } } : {}),
      ...(witness.has(s.id) ? { traces: ["witness"] } : {}),
    };
  });
  const chartEdges = shownEdges.map((e) => ({ from: nodeId(e.from), to: nodeId(e.to), kind: "control", event: e.action,
    ...(witnessEdges.has(`${e.from}\u0000${e.to}\u0000${e.action}`) ? { traces: ["witness"] } : {}) }));
  // Preserve one arrow per observed step, including parallel aggregate arrows and witness paths.
  let jointRegionNames;
  if (view) {
    if (typeof view.state !== "function" || (view.step !== undefined && typeof view.step !== "function") || (view.regions !== undefined && typeof view.regions !== "function")) throw new Error("projection: view needs state(vars) and optional step/regions functions");
    const joint = new Map();
    let names;
    if (view.regions) for (const state of shownStates) {
      const leaves = regionLeaves(view.regions(structuredClone(state.values)));
      if (new Set(leaves.map((leaf) => leaf.path.join("."))).size !== leaves.length || new Set(leaves.map((leaf) => leaf.path[0])).size < 2) throw new Error("projection: joint regions need at least two distinct regions");
      const shape = leaves.map((leaf) => leaf.path.join("."));
      if (names && JSON.stringify(shape) !== JSON.stringify(names)) throw new Error("projection: joint region structure differs between states");
      names = shape;
      joint.set(state.id, leaves);
    }
    jointRegionNames = names;
    const buckets = new Map();
    for (const [i, state] of shownStates.entries()) {
      const label = view.state(structuredClone(state.values));
      if (typeof label !== "string" || !label.trim() || label.length > 160) throw new Error("projection: view.state must return a nonempty label up to 160 characters");
      // Equal display labels cannot merge different observed joint combinations.
      const key = JSON.stringify([label, joint.get(state.id)?.map((leaf) => leaf.value) ?? null]);
      if (!buckets.has(key)) buckets.set(key, { label, members: [] });
      buckets.get(key).members.push({ state, node: nodes[i] });
    }
    const mapped = new Map();
    const aggregated = [...buckets.values()].map(({ label, members }, i) => {
      const id = `view_${i + 1}`;
      for (const { state } of members) mapped.set(state.id, id);
      const paths = members.flatMap(({ node }) => node.evidence?.marks.filter((m) => m.kind === "bugPath") ?? []);
      const failures = members.flatMap(({ node }) => node.evidence?.marks.filter((m) => m.kind === "breaks") ?? []);
      const marks = [...paths, ...failures.map((mark) => ({ ...mark, kind: failures.length === members.length ? "breaks" : "mayBreak" }))];
      return { ...members[0].node, id, title: label,
        lines: [joint.size ? "Observed joint state" : members.length === 1 ? "Concrete state" : `${members.length} states`],
        details: `Display identity: ${label}. Concrete IDs: ${members.map(({ state }) => state.id).join(", ")}. ${joint.size ? `Nested parallel-region labels in this single observed joint state: ${condition(joint.get(members[0].state.id))}. No independent region execution order is inferred. ` : ""}Full typed values and provenance: [evidence.json](evidence.json).`,
        ...(marks.length ? { evidence: { marks } } : {}),
        traces: paths.length ? ["witness"] : [] };
    });
    const byId = new Map(states.map((s) => [s.id, s.values]));
    const arrows = shownEdges.map((edge, i) => {
      const action = view.step ? view.step(edge.action, structuredClone(byId.get(edge.from)), structuredClone(byId.get(edge.to))) : edge.action;
      if (typeof action !== "string" || !action.trim()) throw new Error("projection: view.step must return a nonempty action label");
      const source = joint.get(edge.from), target = joint.get(edge.to);
      const changes = source?.flatMap((leaf, n) => leaf.value === target[n].value ? [] : [`${leaf.path.join(".")}: ${leaf.value} → ${target[n].value}`]);
      return { ...chartEdges[i], from: mapped.get(edge.from), to: mapped.get(edge.to), event: action,
        ...(source ? { guard: condition(source), action: changes.length ? changes.join("; ") : "region labels unchanged",
          details: `Observed joint transition ${edge.from} → ${edge.to}. Source: ${condition(source)}. Target: ${condition(target)}. No invented concurrency; consult evidence.json.` } : {}) };
    });
    nodes.splice(0, nodes.length, ...aggregated);
    chartEdges.splice(0, chartEdges.length, ...arrows);
  }
  return {
    schema: "bowerbird/v1",
    meta: { kind: "statechart", view: "flat", title: "Explored model states", kicker: "Finite TLC model evidence",
      subtitle: `Model evidence; implementation defects require independent replay. Faithful abstraction of observed model states. Model/config only, not implementation proof. ${omissions ? "Partial counterexample-first chart: omitted states and steps are in evidence.json." : constrained ? "Constraint-excluded successors omitted; apparent dead ends are not terminals." : trace?.kind === "lasso" || trace?.kind === "stuttering" ? "Bounded temporal witness; not a shortest path." : evidence.outcome === "violation" ? "Exploration stopped at a violation; boundaries unknown." : "Observed graph complete."}`,
      ...(omissions ? { projectionOmissions: omissions } : {}),
      ...(jointRegionNames ? { jointRegions: { paths: jointRegionNames, semantics: "observed joint states; no independent region execution order", evidence: "evidence.json" } } : {}),
      verificationProjection: true, animation: "static", grid: { col: trace ? 400 : 300, row: trace ? 240 : 200, gap: 70 } },
    ...(trace ? { traces: [{ id: "witness", label: `${trace.rule} ${trace.kind === "finite-prefix" ? "finite witness" : "temporal loop"}` }] } : {}),
    nodes, edges: chartEdges,
  };
}
