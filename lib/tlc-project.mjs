// One concrete TLC fingerprint per flat card. Never merge states or invent edges.
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

export function projectFlat(evidence) {
  if (evidence?.schema !== "bowerbird/tlc-evidence/v1" || !["completed", "violation"].includes(evidence.outcome)) {
    throw new Error("projection: evidence is unchecked; no chart produced");
  }
  const { states, edges, initial, rules, trace } = evidence;
  if (!Array.isArray(states) || !states.length || states.length > 100 || !Array.isArray(edges) || edges.length > 300 || !Array.isArray(initial) || !initial.length || !Array.isArray(rules)) {
    throw new Error("projection: missing evidence or flat chart budget exceeded (100 states, 300 steps); no chart produced");
  }
  const ids = new Set(states.map((s) => s.id));
  if (ids.size !== states.length || new Set(initial).size !== initial.length || states.some((s) => !/^-?\d+$/.test(s.id) || !s.values || typeof s.values !== "object") || initial.some((id) => !ids.has(id))) {
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
  const broken = trace?.kind === "finite-prefix" ? trace.steps.at(-1).state : null;
  const loopTarget = trace?.loop ? trace.steps[trace.loop.to].state : null;
  const nodes = states.map((s, i) => {
    const marks = [];
    if (witness.has(s.id)) marks.push({ kind: "bugPath", label: `${trace.rule} step ${witness.get(s.id).join(", ")}`, trace: "evidence.json" });
    if (s.id === broken) marks.push({ kind: "breaks", label: trace.rule, trace: "evidence.json" });
    return {
      id: nodeId(s.id), at: [i % 4, Math.floor(i / 4)], shape: "state", title: `State ${i + 1}`,
      lines: [initial.includes(s.id) ? "Initial model state" : "Concrete model state",
        ...(s.id === loopTarget ? [trace.kind === "stuttering" ? "Implicit stuttering loop" : "Temporal loop returns here"] : []),
        ...(s.id === broken && trace.rule === "deadlock" ? ["No enabled Next successor"] : []),
        ...Object.entries(s.values).slice(0, 1).map(([name, value]) => short(`${name} = ${display(value)}`))],
      details: `Concrete fingerprint: ${s.id}. Full typed values, rule results and provenance: [evidence.json](evidence.json).`,
      ...(marks.length ? { evidence: { marks } } : {}),
      ...(witness.has(s.id) ? { traces: ["witness"] } : {}),
    };
  });
  const chartEdges = edges.map((e) => ({ from: nodeId(e.from), to: nodeId(e.to), kind: "control", event: e.action,
    ...(witnessEdges.has(`${e.from}\u0000${e.to}\u0000${e.action}`) ? { traces: ["witness"] } : {}) }));
  return {
    schema: "bowerbird/v1",
    meta: { kind: "statechart", view: "flat", title: "Explored model states", kicker: "Finite TLC model evidence",
      subtitle: `Model/config only, not implementation proof. ${trace?.kind === "lasso" || trace?.kind === "stuttering" ? "Bounded temporal witness; not a shortest path." : evidence.outcome === "violation" ? "Exploration stopped at a violation; boundaries unknown." : "Observed graph complete."}`,
      verificationProjection: true, animation: "static", grid: { col: trace ? 400 : 300, row: trace ? 240 : 200, gap: 70 } },
    ...(trace ? { traces: [{ id: "witness", label: `${trace.rule} ${trace.kind === "finite-prefix" ? "finite witness" : "temporal loop"}` }] } : {}),
    nodes, edges: chartEdges,
  };
}
