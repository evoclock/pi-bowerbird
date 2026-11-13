// TLC 1.7.4 -tool messages + -dump dot,actionlabels only. Unknown syntax fails closed.
import { readFileSync } from "node:fs";
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
    throw new Error(`unsupported TLC DOT line: ${line.slice(0, 100)}`);
  }
  if (!nodes.size || !initial.length || edges.some((edge) => !nodes.has(edge.from) || !nodes.has(edge.to))) throw new Error("missing TLC states/initials/edge target");
  return { states: [...nodes.values()], initial, edges };
}

export function interpretEvidence(run, directory) {
  const result = { schema: "bowerbird/tlc-evidence/v1", outcome: "unchecked", rules: [], states: [], initial: [], edges: [], trace: null,
    provenance: { stdout: "tlc.stdout", stderr: "tlc.stderr", graph: "tlc.dot", run: "run.json" },
    assurance: "A finite check supports only this model/config and assumptions, not implementation correctness." };
  try {
    const config = readFileSync(run.inputs.config.path, "utf8");
    const rules = [...config.matchAll(/^\s*(INVARIANT|PROPERTY)\s+([A-Za-z_]\w*)\s*$/gm)];
    result.rules = rules.map((r) => ({ id: r[2], kind: r[1].toLowerCase(), status: "unchecked", provenance: { file: run.inputs.config.path } }));
    const checkDeadlock = !/^\s*CHECK_DEADLOCK\s+FALSE\s*$/m.test(config);
    if (checkDeadlock) result.rules.push({ id: "deadlock", kind: "deadlock", status: "unchecked", provenance: { file: run.inputs.config.path } });
    if (run.exitCode === 2) throw new Error("TLC did not finish with a recognised outcome");
    if (/^\s*(?:CONSTRAINT|ACTION_CONSTRAINT|VIEW|SYMMETRY)\b/m.test(config)) throw new Error("reductions and boundary states require a future evidence adapter");
    const stdout = readFileSync(path.join(directory, "tlc.stdout"), "utf8");
    const graph = parseGraph(readFileSync(path.join(directory, "tlc.dot"), "utf8"));
    Object.assign(result, graph);
    const counts = /@!@!@STARTMSG 2199:0 @!@!@\r?\n\d+ states generated, (\d+) distinct states found, (\d+) states left on queue\.\r?\n@!@!@ENDMSG 2199 @!@!@/.exec(stdout);
    if (!counts || Number(counts[1]) !== result.states.length || (run.exitCode === 0 && Number(counts[2]) !== 0)) {
      throw new Error("TLC graph and final state counts disagree or are missing");
    }
    if (!rules.length) throw new Error("no supported rules declared in config");
    if (rules.some((r) => r[1] !== "INVARIANT")) throw new Error("temporal rules require a future evidence adapter");
    const declared = config.split(/\r?\n/).filter((line) => /^\s*(INVARIANT|PROPERTY)\b/.test(line));
    if (declared.length !== rules.length) throw new Error("unsupported rule declaration");
    const failure = [...stdout.matchAll(/@!@!@STARTMSG 2110:1 @!@!@\r?\nInvariant ([A-Za-z_]\w*) is violated\.\r?\n@!@!@ENDMSG 2110 @!@!@/g)];
    if (run.exitCode === 1 && failure.length !== 1) throw new Error("missing or ambiguous invariant violation");
    if (run.exitCode === 0 && failure.length) throw new Error("contradictory TLC verdict");
    const violated = failure[0]?.[1];
    if (violated && !rules.some((r) => r[2] === violated)) throw new Error("violation of undeclared rule");
    result.rules = rules.map((r) => ({ id: r[2], kind: "invariant", status: run.exitCode === 0 ? "checked-no-violation" : r[2] === violated ? "violated" : "unchecked",
      provenance: { file: "tlc.stdout", messageCode: r[2] === violated ? 2110 : 2193 } }));
    if (checkDeadlock) result.rules.push({ id: "deadlock", kind: "deadlock", status: run.exitCode === 0 ? "checked-no-violation" : "unchecked",
      provenance: { file: "tlc.stdout", messageCode: run.exitCode === 0 ? 2193 : null } });
    if (run.exitCode === 1) {
      const byValue = new Map(result.states.map((s) => [JSON.stringify(s.values), s.id]));
      if (byValue.size !== result.states.length) throw new Error("ambiguous witness state identity");
      const blocks = [...stdout.matchAll(/@!@!@STARTMSG 2217:4 @!@!@\r?\n([\s\S]*?)@!@!@ENDMSG 2217 @!@!@/g)];
      if (!blocks.length) throw new Error("missing TLC witness");
      const steps = blocks.map((block, i) => {
        const match = /^(\d+): <([^>]+)>\r?\n([\s\S]+?)\s*$/.exec(block[1]);
        if (!match || Number(match[1]) !== i + 1) throw new Error("malformed TLC witness step");
        const id = byValue.get(JSON.stringify(state(match[3].trim())));
        if (!id) throw new Error("witness state missing from graph");
        return { state: id, action: i ? match[2].split(" ")[0] : null, messageCode: 2217, offset: block.index };
      });
      for (let i = 1; i < steps.length; i++) {
        if (!result.edges.some((edge) => edge.from === steps[i - 1].state && edge.to === steps[i].state && edge.action === steps[i].action)) throw new Error("witness edge missing from graph");
      }
      result.trace = { kind: "finite-prefix", rule: violated, steps, provenance: "tlc.stdout" };
    }
    result.states.forEach((s) => { s.exploration = run.exitCode === 0 ? "explored" : "unknown"; });
    result.boundary = run.exitCode === 0 ? "none (completed graph)" : "unknown (stopped at violation)";
    result.outcome = run.exitCode === 0 ? "completed" : "violation";
  } catch (error) {
    result.outcome = "unchecked";
    result.reason = error.message;
    result.rules = result.rules.map((r) => ({ ...r, status: "unchecked" }));
    result.trace = null;
  }
  return result;
}
