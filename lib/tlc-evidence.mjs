// TLC 1.7.4 -tool messages + -dump dot,actionlabels only. Unknown syntax fails closed.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export function parseValue(source) {
  const tokens = [];
  const tokenPattern = /<<|>>|\|->|\{|\}|\[|\]|,|-?\d+|TRUE|FALSE|"(?:\\.|[^"\\])*"|[A-Za-z_]\w*/y;
  for (let pos = 0; pos < source.length;) {
    if (/\s/.test(source[pos])) { pos++; continue; }
    tokenPattern.lastIndex = pos;
    const match = tokenPattern.exec(source);
    if (!match) throw new Error("unsupported TLC value syntax");
    tokens.push(match[0]);
    pos = tokenPattern.lastIndex;
  }
  let index = 0;
  const take = (expected) => { if (tokens[index++] !== expected) throw new Error(`expected ${expected} in TLC value`); };
  const list = (close, item) => {
    const values = [];
    while (tokens[index] !== close) {
      if (index >= tokens.length) throw new Error("unterminated TLC value");
      if (values.length) take(",");
      values.push(item());
    }
    take(close);
    return values;
  };
  const value = () => {
    const token = tokens[index++];
    if (token === "TRUE" || token === "FALSE") return { type: "boolean", value: token === "TRUE" };
    if (/^-?\d+$/.test(token ?? "")) return { type: "integer", value: token }; // decimal string: no JS precision loss
    if (token?.startsWith('"')) return { type: "string", value: JSON.parse(token) };
    if (token === "{") return { type: "set", elements: list("}", value) };
    if (token === "<<") return { type: "sequence", elements: list(">>", value) };
    if (token === "[") {
      const fields = Object.create(null);
      const entries = list("]", () => {
        const name = tokens[index++];
        if (!/^[A-Za-z_]\w*$/.test(name ?? "") || Object.hasOwn(fields, name)) throw new Error("invalid TLC record field");
        take("|->");
        fields[name] = value();
        return name;
      });
      if (!entries.length) return { type: "record", fields: {} };
      return { type: "record", fields };
    }
    if (/^[A-Za-z_]\w*$/.test(token ?? "")) return { type: "model-value", name: token };
    throw new Error("unsupported TLC value");
  };
  const result = value();
  if (index !== tokens.length) throw new Error("trailing TLC value tokens");
  return result;
}

function state(label) {
  const vars = Object.create(null);
  for (const line of label.split("\n")) {
    const match = /^(?:\/\\ )?([A-Za-z_]\w*) = (.+)$/.exec(line.trim());
    if (!match || Object.hasOwn(vars, match[1])) throw new Error("unsupported or duplicate TLC state variable");
    vars[match[1]] = parseValue(match[2]);
  }
  if (!Object.keys(vars).length) throw new Error("empty TLC state");
  return vars;
}

const unescapeDot = (raw) => {
  if (/\\(?!n|"|\\| )/.test(raw)) throw new Error("unsupported TLC DOT escape");
  return raw.replace(/\\(n|"|\\)/g, (_, c) => c === "n" ? "\n" : c);
};
const labelPattern = '((?:\\\\.|[^"\\\\])*)';
const nodeLine = new RegExp(`^(-?\\d+) \\[label="${labelPattern}"(,style = filled)?\\];?$`);
const edgeLine = new RegExp(`^(-?\\d+) -> (-?\\d+) \\[label="${labelPattern}",color="(?:black|red)",fontcolor="(?:black|red)"\\];$`);
const stutterLine = /^(-?\d+) -> (-?\d+) \[style="dashed"\];$/;

export function parseGraph(dot) {
  const lines = dot.trimEnd().split(/\r?\n/);
  if (lines[0] !== "strict digraph DiskGraph {" || lines.at(-1) !== "}" || lines.at(-2) !== "}") throw new Error("incomplete TLC DOT graph");
  const nodes = new Map(), edges = [], initial = [];
  for (const line of lines.slice(1, -2)) {
    if (["nodesep=0.35;", 'subgraph cluster_graph {', 'color="white";'].includes(line) || /^\{rank = same; -?\d+;\}$/.test(line)) continue;
    const node = nodeLine.exec(line);
    if (node) {
      if (nodes.has(node[1])) throw new Error("duplicate TLC fingerprint");
      nodes.set(node[1], { id: node[1], values: state(unescapeDot(node[2])), exploration: "unknown" });
      if (node[3]) initial.push(node[1]);
      continue;
    }
    const edge = edgeLine.exec(line);
    if (edge) { edges.push({ from: edge[1], to: edge[2], action: unescapeDot(edge[3]) }); continue; }
    const stutter = stutterLine.exec(line);
    if (stutter && stutter[1] === stutter[2]) {
      edges.push({ from: stutter[1], to: stutter[2], action: "Stutter", kind: "implicit-stutter" }); continue;
    }
    throw new Error(`unsupported TLC DOT line: ${line.slice(0, 100)}`);
  }
  if (!nodes.size || !initial.length || edges.some((edge) => !nodes.has(edge.from) || !nodes.has(edge.to))) throw new Error("missing TLC states/initials/edge target");
  return { states: [...nodes.values()], initial, edges };
}

// interpretEvidence previously handled only finite prefixes; isolate marker matching so temporal returns share its concrete edge checks.
function parseWitness(stdout, graph, rule, outcome, allowBoundary = false) {
  const byValue = new Map(graph.states.map((s) => [JSON.stringify(s.values), s.id]));
  if (byValue.size !== graph.states.length) throw new Error("ambiguous witness state identity");
  const blocks = [...stdout.matchAll(/@!@!@STARTMSG 2217:4 @!@!@\r?\n([\s\S]*?)@!@!@ENDMSG 2217 @!@!@/g)];
  if (!blocks.length) throw new Error("missing TLC witness");
  const steps = blocks.map((block, i) => {
    const match = /^(\d+): <([^>]+)>\r?\n([\s\S]+?)\s*$/.exec(block[1]);
    if (!match || Number(match[1]) !== i + 1) throw new Error("malformed TLC witness step");
    const values = state(match[3].trim());
    let id = byValue.get(JSON.stringify(values));
    if (!id && allowBoundary && outcome === "violation" && i === blocks.length - 1 && i > 0) {
      // The constraint-excluded state has no TLC DOT fingerprint. Use a visibly derived witness ID, never a fabricated fingerprint.
      id = `boundary_${createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 16)}`;
      if (graph.states.some((s) => s.id === id)) throw new Error("ambiguous boundary witness identity");
      graph.states.push({ id, values, exploration: "boundary-unexplored", origin: "tlc.stdout", evaluatedRules: [rule], deadlockChecked: false });
    }
    if (!id) throw new Error("witness state missing from graph");
    return { state: id, action: i ? match[2].split(" ")[0] : null, messageCode: 2217, offset: block.index };
  });
  if (!graph.initial.includes(steps[0].state)) throw new Error("witness does not start in an initial state");
  const hasEdge = (from, to, action) => graph.edges.some((edge) => edge.from === from && edge.to === to && edge.action === action);
  for (let i = 1; i < steps.length; i++) {
    if (!hasEdge(steps[i - 1].state, steps[i].state, steps[i].action)) {
      if (!allowBoundary || i !== steps.length - 1 || !graph.states.some((s) => s.id === steps[i].state && s.exploration === "boundary-unexplored")) {
        throw new Error("witness edge missing from graph");
      }
      graph.edges.push({ from: steps[i - 1].state, to: steps[i].state, action: steps[i].action, kind: "boundary-witness", provenance: "tlc.stdout" });
    }
  }
  const backs = [...stdout.matchAll(/@!@!@STARTMSG 2122:4 @!@!@\r?\n(\d+): Back to state: <([^>]+)>\s*@!@!@ENDMSG 2122 @!@!@/g)];
  const stutters = [...stdout.matchAll(/@!@!@STARTMSG 2218:4 @!@!@\r?\n(\d+): Stuttering\s*@!@!@ENDMSG 2218 @!@!@/g)];
  if (outcome !== "temporal-violation") {
    if (backs.length || stutters.length) throw new Error("unexpected temporal witness marker");
    if (outcome === "deadlock" && graph.edges.some((edge) => edge.from === steps.at(-1).state && edge.kind !== "implicit-stutter")) {
      throw new Error("deadlock state has an enabled Next transition");
    }
    return { kind: "finite-prefix", rule, steps, provenance: "tlc.stdout" };
  }
  if (backs.length + stutters.length !== 1 || Math.max(backs[0]?.index ?? -1, stutters[0]?.index ?? -1) < blocks.at(-1).index) {
    throw new Error("missing or ambiguous temporal loop marker");
  }
  let loop, kind;
  if (backs.length) {
    const back = backs[0];
    const to = Number(back[1]) - 1;
    const action = back[2].split(" ")[0];
    if (!Number.isSafeInteger(to) || to < 0 || to >= steps.length || !hasEdge(steps.at(-1).state, steps[to].state, action)) {
      throw new Error("temporal back edge missing from graph");
    }
    loop = { from: steps.length - 1, to, action, messageCode: 2122, offset: back.index };
    kind = "lasso";
  } else {
    const stutter = stutters[0];
    if (Number(stutter[1]) !== steps.length + 1 || !hasEdge(steps.at(-1).state, steps.at(-1).state, "Stutter")) {
      throw new Error("implicit stuttering edge missing from graph");
    }
    loop = { from: steps.length - 1, to: steps.length - 1, action: "Stutter", messageCode: 2218, offset: stutter.index };
    kind = "stuttering";
  }
  return { kind, rule, steps, loop, shortest: false, provenance: "tlc.stdout" };
}

export function interpretEvidence(run, directory) {
  const result = { schema: "bowerbird/tlc-evidence/v1", outcome: "unchecked", rules: [], states: [], initial: [], edges: [], trace: null,
    reductions: [], graphIdentity: "concrete",
    provenance: { stdout: "tlc.stdout", stderr: "tlc.stderr", graph: "tlc.dot", run: "run.json" },
    assurance: "A finite check supports only this model/config and assumptions, not implementation correctness." };
  try {
    const config = readFileSync(run.inputs.config.path, "utf8");
    const rules = [...config.matchAll(/^\s*(INVARIANT|PROPERTY)\s+([A-Za-z_]\w*)\s*$/gm)];
    result.rules = rules.map((r) => ({ id: r[2], kind: r[1].toLowerCase(), status: "unchecked", provenance: { file: run.inputs.config.path } }));
    const checkDeadlock = !/^\s*CHECK_DEADLOCK\s+FALSE\s*$/m.test(config);
    if (checkDeadlock) result.rules.push({ id: "deadlock", kind: "deadlock", status: "unchecked", provenance: { file: run.inputs.config.path } });
    if (run.exitCode === 2) throw new Error("TLC did not finish with a recognised outcome");
    const reductionLines = config.split(/\r?\n/).filter((line) => /^\s*(?:CONSTRAINT|ACTION_CONSTRAINT|VIEW|SYMMETRY)\b/.test(line));
    result.reductions = reductionLines.map((line) => {
      const match = /^\s*(CONSTRAINT|ACTION_CONSTRAINT|VIEW|SYMMETRY)\s+([A-Za-z_]\w*)\s*$/.exec(line);
      if (!match) throw new Error("unsupported reduction declaration");
      return { kind: match[1], name: match[2], provenance: run.inputs.config.path };
    });
    result.graphIdentity = result.reductions.some((r) => ["VIEW", "SYMMETRY"].includes(r.kind)) ? "representative" : "concrete";
    const constrained = result.reductions.some((r) => ["CONSTRAINT", "ACTION_CONSTRAINT"].includes(r.kind));
    const stdout = readFileSync(path.join(directory, "tlc.stdout"), "utf8");
    const graph = parseGraph(readFileSync(path.join(directory, "tlc.dot"), "utf8"));
    Object.assign(result, graph);
    const counts = /@!@!@STARTMSG 2199:0 @!@!@\r?\n(\d+) states generated, (\d+) distinct states found, (\d+) states left on queue\.\r?\n@!@!@ENDMSG 2199 @!@!@/.exec(stdout);
    if (!counts || Number(counts[2]) !== result.states.length || (run.exitCode === 0 && Number(counts[3]) !== 0)) {
      throw new Error("TLC graph and final state counts disagree or are missing");
    }
    result.statistics = { generated: Number(counts[1]), distinct: Number(counts[2]), queued: Number(counts[3]) };
    if (!rules.length && !checkDeadlock) throw new Error("no supported rules declared in config");
    const properties = rules.filter((r) => r[1] === "PROPERTY");
    if (properties.length > 1) throw new Error("multiple temporal properties need separate attributed checks");
    const declared = config.split(/\r?\n/).filter((line) => /^\s*(INVARIANT|PROPERTY)\b/.test(line));
    if (declared.length !== rules.length) throw new Error("unsupported rule declaration");
    const failure = [...stdout.matchAll(/@!@!@STARTMSG 2110:1 @!@!@\r?\nInvariant ([A-Za-z_]\w*) is violated\.\r?\n@!@!@ENDMSG 2110 @!@!@/g)];
    if (run.outcome === "violation" ? failure.length !== 1 : failure.length !== 0) throw new Error("missing or contradictory invariant verdict");
    const violated = failure[0]?.[1];
    if (violated && !rules.some((r) => r[1] === "INVARIANT" && r[2] === violated)) throw new Error("violation of undeclared invariant");
    if (run.outcome === "deadlock" && (!checkDeadlock || !/@!@!@STARTMSG 2114:1 @!@!@\r?\nDeadlock reached\.\r?\n@!@!@ENDMSG 2114 @!@!@/.test(stdout))) throw new Error("unattributed deadlock");
    if (run.outcome === "temporal-violation" && (properties.length !== 1 || Number(counts[3]) !== 0 || !/@!@!@STARTMSG 2192:0 @!@!@/.test(stdout) || !/@!@!@STARTMSG 2267:0 @!@!@/.test(stdout))) {
      throw new Error("temporal violation lacks one property or completed-state provenance");
    }
    const failedRule = run.outcome === "deadlock" ? "deadlock" : run.outcome === "temporal-violation" ? properties[0][2] : violated;
    result.rules = rules.map((r) => ({ id: r[2], kind: r[1].toLowerCase(), status: run.exitCode === 0 ? "checked-no-violation" : r[2] === failedRule ? "violated" : "unchecked",
      provenance: { file: "tlc.stdout", messageCode: r[2] === failedRule ? r[1] === "PROPERTY" ? 2116 : 2110 : run.exitCode === 0 ? 2193 : null } }));
    if (checkDeadlock) result.rules.push({ id: "deadlock", kind: "deadlock", status: run.exitCode === 0 ? "checked-no-violation" : run.outcome === "deadlock" ? "violated" : "unchecked",
      provenance: { file: "tlc.stdout", messageCode: run.outcome === "deadlock" ? 2114 : run.exitCode === 0 ? 2193 : null } });
    if (run.exitCode === 1) {
      if (result.graphIdentity === "representative") throw new Error("reduced witness identity is not attributable to concrete states");
      result.trace = parseWitness(stdout, result, failedRule, run.outcome, constrained);
    }
    const completedGraph = run.exitCode === 0 || run.outcome === "temporal-violation";
    result.states.forEach((s) => {
      if (s.exploration !== "boundary-unexplored") s.exploration = result.graphIdentity === "representative" ? "representative" : completedGraph ? "explored" : "unknown";
    });
    result.boundary = constrained ? { status: "partial", excludedSuccessors: "unknown (not in TLC DOT)",
      ruleEvaluation: "invariants may be evaluated at excluded successors; only a sourced witness identifies one",
      deadlock: "boundary deadlock check not performed" } :
      result.graphIdentity === "representative" ? "concrete boundaries unknown (VIEW/SYMMETRY quotient)" :
        completedGraph ? "none (completed state exploration for this model/config)" : "unknown (stopped at violation)";
    if (run.outcome === "temporal-violation") result.assurance = "Bounded temporal evidence for this model/config only; not a shortest path or implementation proof.";
    result.outcome = run.exitCode === 0 ? "completed" : "violation";
  } catch (error) {
    result.outcome = "unchecked";
    result.reason = error.message;
    result.rules = result.rules.map((r) => ({ ...r, status: "unchecked" }));
    result.trace = null;
  }
  return result;
}
