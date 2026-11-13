// Human-readable view of the original finite TLC result; the typed evidence remains authoritative.
import { readFileSync } from "node:fs";
import path from "node:path";

const artifact = (name) => `[${name}](${name})`;
const code = (value) => `\`${JSON.stringify(value).replaceAll("`", "\\u0060")}\``;
const lines = (value) => JSON.stringify(value, null, 2).split("\n").map((line) => `    ${line}`).join("\n");

export function reportForRun(run, evidence, dir) {
  const issues = [];
  const completed = run.exitCode === 0;
  const violated = run.exitCode === 1;
  const rules = Array.isArray(evidence?.rules) ? evidence.rules : [];
  if (evidence?.schema !== "bowerbird/tlc-evidence/v1" || !rules.length) issues.push("typed rule evidence missing");
  if (rules.some((rule) => !["violated", "checked-no-violation", "unchecked"].includes(rule.status))) issues.push("unknown rule status");
  if (completed && (run.outcome !== "completed-no-violation" || evidence.outcome !== "completed" || rules.some((rule) => rule.status !== "checked-no-violation"))) {
    issues.push("completed verdict disagrees with per-rule evidence");
  }
  if (violated && (run.outcome !== "violation" || evidence.outcome !== "violation" || rules.filter((rule) => rule.status === "violated").length !== 1 || evidence.trace?.rule !== rules.find((rule) => rule.status === "violated")?.id)) {
    issues.push("violation verdict disagrees with finite witness");
  }
  if (run.exitCode === 2 && run.outcome !== "incomplete") issues.push("incomplete verdict disagrees with exit code");
  if (![0, 1, 2].includes(run.exitCode)) issues.push("unknown exit code");
  if ((completed || violated) && run.projection?.status !== "rendered") issues.push("chart projection not rendered");

  const files = ["tlc.stdout", "tlc.stderr", "evidence.json", "tlc.dot", "model.bower.json", "model.html", "model.svg"];
  const found = new Set();
  for (const name of files) {
    try {
      const content = readFileSync(path.join(dir, name));
      found.add(name);
      if (["tlc.stdout", "tlc.dot"].includes(name) && (completed || violated) && !content.length) throw new Error("empty raw TLC output");
      if (name === "evidence.json" && JSON.stringify(JSON.parse(content.toString("utf8"))) !== JSON.stringify(evidence)) throw new Error("evidence differs from parsed result");
      if (name === "model.bower.json" && JSON.parse(content.toString("utf8")).meta?.verificationProjection !== true) throw new Error("invalid chart");
      if (name === "model.svg" && !content.toString("utf8").trimStart().startsWith("<svg")) throw new Error("invalid SVG");
      if (name === "model.html" && !content.toString("utf8").trimStart().startsWith("<!doctype html>")) throw new Error("invalid HTML");
    } catch {
      found.delete(name);
      if (["tlc.stdout", "tlc.stderr", "evidence.json"].includes(name) || ((completed || violated) && ["tlc.dot", "model.bower.json", "model.html", "model.svg"].includes(name))) {
        issues.push(`missing or unreadable ${name}`);
      }
    }
  }
  const result = issues.length ? { ...run, outcome: "incomplete", exitCode: 2,
    reason: [run.reason, ...issues].filter(Boolean).join("; ") } : { ...run };
  const verdict = result.exitCode === 0 ? "completed finite model check; no checked rule violated" :
    result.exitCode === 1 ? "invariant violation in model" : "incomplete or unchecked";
  const values = Array.isArray(evidence?.states) ? evidence.states : [];
  const steps = Array.isArray(evidence?.edges) ? evidence.edges : [];
  const names = [...new Set(values.flatMap((s) => Object.keys(s.values ?? {})))];
  const actions = [...new Set(steps.map((s) => s.action).filter(Boolean))];
  const status = (rule) => rule.status === "violated" ? "violated" : rule.status === "checked-no-violation" ? "checked-no-violation" : "unchecked";
  const ruleLinks = ["tlc.stdout", "evidence.json"].map((name) => found.has(name) ? artifact(name) : `${name} (unavailable)`).join(", ");
  const ruleLines = rules.length ? rules.map((rule) => `- ${code(rule.id)}: **${status(rule)}** (${code(rule.kind ?? "unknown kind")}; provenance ${code(rule.provenance ?? "unavailable")}; ${ruleLinks}).`).join("\n") :
    "- Rule inventory unavailable; do not assume any rule was checked. Consult the original config and raw logs.";
  const trace = evidence?.trace;
  const witness = trace?.steps?.length ? `Rule ${code(trace.rule)}; finite prefix through fingerprints ${trace.steps.map((s) => code(s.state)).join(" → ")}. This witness is model-only, not an implementation defect. See ${artifact("evidence.json")} for full typed states and actions.` :
    "No parsed witness. Do not infer that an incomplete check found no defect.";
  const raw = ["tlc.stdout", "tlc.stderr", "tlc.dot"].map((name) => found.has(name) ? artifact(name) : `${name} (unavailable)`).join(", ");
  const chart = result.projection?.status === "rendered" && ["model.bower.json", "model.html", "model.svg"].every((name) => found.has(name)) ?
    `${artifact("model.bower.json")}, ${artifact("model.html")}, ${artifact("model.svg")}` :
    "unavailable (all chart states/steps omitted; consult evidence.json and raw logs)";
  const cp = result.command?.args?.indexOf("-cp") ?? -1;
  const rerun = { executable: "bowerbird", args: ["verify", result.inputs?.model?.path ?? "<model>", "--config", result.inputs?.config?.path ?? "<config>",
    "--tlc-jar", cp >= 0 ? result.command.args[cp + 1] : "<pinned-jar>", "--java", result.command?.executable ?? "java",
    "--timeout-ms", String(result.limits?.timeoutMs ?? 60000), "--out", "<new-output-directory>"] };
  const text = `# TLC model verification report

Outcome: ${verdict}. Exit: ${result.exitCode}. Cancellation, timeout, missing tools, unreadable evidence or partial output exit 2.
${result.reason ? `Reason: ${code(result.reason)}.\n` : ""}Original TLC outcome: ${code(result.rawOutcome ?? result.outcome)}; original exit: ${code(result.rawExitCode ?? result.exitCode)}. Projection and report errors do not turn this into a pass.

## Modelled and assumed

- Source: ${code(result.inputs?.model?.path ?? "unknown")}; Model SHA-256: ${result.inputs?.model?.sha256 ?? "unavailable"}.
- Config: ${code(result.inputs?.config?.path ?? "unknown")}; Config SHA-256: ${result.inputs?.config?.sha256 ?? "unavailable"}.
- Pinned TLC: ${code(result.tool?.version ?? "unknown")}; Tool SHA-256: ${result.tool?.sha256 ?? "unavailable"}. Java: ${code(result.javaVersion ?? "unknown")}.
- Variables seen: ${names.length ? names.map(code).join(", ") : "unavailable"}; actions seen: ${actions.length ? actions.map(code).join(", ") : "unavailable"}. This only describes observed model evidence, not implementation behavior.
- Assumptions and constants are those supplied by the source and config above; this tool does not validate them against real code. Read both inputs to review their meaning. A finite TLC check supports only the specified model/config and checked rules; it does not prove the implementation correct.

## Bounds and omissions

- Timeout: ${code(result.limits?.timeoutMs ?? "unknown")} ms; heap: ${code(result.limits?.heapMiB ?? "unknown")} MiB; workers: ${code(result.limits?.workers ?? "unknown")}; log: ${code(result.limits?.logBytes ?? "unknown")} bytes; metadata: ${code(result.limits?.metadataBytes ?? "unknown")} bytes; graph: ${code(result.limits?.graphBytes ?? "unknown")} bytes. No explicit distinct-state bound is set for TLC in this run. Chart budget: 100 states / 300 steps; beyond that, the chart is unavailable, not truncated to imply completeness.
- Parsed concrete graph: ${values.length} states, ${steps.length} steps, ${Array.isArray(evidence?.initial) ? evidence.initial.length : "unknown"} initial states. If parsing was incomplete, these counts are not a coverage claim.
- Boundary status: ${result.exitCode === 0 ? "TLC reported completed for this model/config (subject to its configured constraints)" : "unknown"}. An early violation does not establish the full graph. No code-backed counterexample replay, temporal/liveness diagnosis, multi-run rule recovery or hidden-state abstraction is claimed.
- Unchecked rules: ${rules.filter((rule) => status(rule) === "unchecked").map((rule) => code(rule.id)).join(", ") || "none reported"}; unchecked does not mean passed.

## Per-rule results

${ruleLines}

## Witness

${witness}

## Artifacts and reproduction

- Raw TLC output: ${raw}.
- Typed evidence: ${found.has("evidence.json") ? artifact("evidence.json") : "evidence.json (unavailable)"}; metadata and exact input hashes: ${artifact("run.json")}.
- Chart: ${chart}.
- Exact TLC invocation (executable and ordered argv, with working directory; JSON strings are literal arguments):

${lines(result.command ?? { executable: "unavailable", args: [], cwd: "unavailable" })}

To repeat the check, invoke this CLI argv (replace only the output-directory placeholder with a **new** directory; the existing evidence is never overwritten):

${lines(rerun)}

Exit 0 means completed/no violation for this model/config only; exit 1 means a detected model violation; exit 2 means incomplete/error, including cancellation.
`;
  return { run: result, text };
}
