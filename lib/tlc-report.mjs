// Human-readable view of the original finite TLC result; the typed evidence remains authoritative.
import { existsSync, readFileSync } from "node:fs";
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
  if (violated && (!["violation", "deadlock", "temporal-violation"].includes(run.outcome) || evidence.outcome !== "violation" || rules.filter((rule) => rule.status === "violated").length !== 1 || evidence.trace?.rule !== rules.find((rule) => rule.status === "violated")?.id)) {
    issues.push("violation verdict disagrees with finite witness");
  }
  if (run.exitCode === 2 && run.outcome !== "incomplete") issues.push("incomplete verdict disagrees with exit code");
  if (![0, 1, 2].includes(run.exitCode)) issues.push("unknown exit code");
  const projectionStatus = run.projection?.status;
  if ((completed || violated) && !["rendered", "rendered-partial", "omitted"].includes(projectionStatus)) issues.push("chart projection unreadable or unaccounted for");
  if ((completed || violated) && projectionStatus === "omitted" && !(evidence.graphIdentity === "representative" || evidence.states?.length > 500 || evidence.edges?.length > 1500)) {
    issues.push("chart omitted without a supported reduction or explicit budget");
  }

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
      if (["tlc.stdout", "tlc.stderr", "evidence.json"].includes(name) || ((completed || violated) && (name === "tlc.dot" || projectionStatus !== "omitted" && ["model.bower.json", "model.html", "model.svg"].includes(name)))) {
        issues.push(`missing or unreadable ${name}`);
      }
    }
  }
  const result = issues.length ? { ...run, outcome: "incomplete", exitCode: 2,
    reason: [run.reason, ...issues].filter(Boolean).join("; ") } : { ...run };
  const verdict = result.exitCode === 0 ? "completed finite model check; no checked rule violated" :
    result.exitCode === 1 ? result.outcome === "deadlock" ? "Deadlock reached in model" :
      result.outcome === "temporal-violation" ? "temporal property violated in model" : "invariant violation in model" : "incomplete or unchecked";
  const values = Array.isArray(evidence?.states) ? evidence.states : [];
  const steps = Array.isArray(evidence?.edges) ? evidence.edges : [];
  const names = [...new Set(values.flatMap((s) => Object.keys(s.values ?? {})))];
  const actions = [...new Set(steps.map((s) => s.action).filter(Boolean))];
  const status = (rule) => rule.status === "violated" ? "violated" : rule.status === "checked-no-violation" ? "checked-no-violation" : "unchecked";
  const ruleLinks = ["tlc.stdout", "evidence.json"].map((name) => found.has(name) ? artifact(name) : `${name} (unavailable)`).join(", ");
  const ruleLines = rules.length ? rules.map((rule) => `- ${code(rule.id)}: **${status(rule)}** (${code(rule.kind ?? "unknown kind")}; provenance ${code(rule.provenance ?? "unavailable")}; ${ruleLinks}).`).join("\n") :
    "- Rule inventory unavailable; do not assume any rule was checked. Consult the original config and raw logs.";
  const trace = evidence?.trace;
  const witness = trace?.steps?.length ? trace.kind === "lasso" || trace.kind === "stuttering" ?
    `Rule ${code(trace.rule)}; ${trace.kind === "lasso" ? "lasso" : "implicit stuttering"} through fingerprints ${trace.steps.map((s) => code(s.state)).join(" → ")}; loop returns to step ${trace.loop.to + 1} via ${code(trace.loop.action)}. This is bounded temporal evidence, not a shortest path and not implementation proof. See ${artifact("evidence.json")} for the concrete loop and source marker.` :
    `Rule ${code(trace.rule)}; finite prefix through state IDs ${trace.steps.map((s) => code(s.state)).join(" → ")}. ${evidence.states?.some((s) => s.id === trace.steps.at(-1).state && s.exploration === "boundary-unexplored") ? "The last ID is witness-derived, not a TLC fingerprint: the invariant was evaluated at the boundary, but deadlock was not checked there. " : ""}${trace.rule === "deadlock" ? "The last state has no enabled Next successor. " : ""}This witness is model-only, not an implementation defect. See ${artifact("evidence.json")} for full typed states and actions.` :
    "No parsed witness. Do not infer that an incomplete check found no defect.";
  const raw = ["tlc.stdout", "tlc.stderr", "tlc.dot"].map((name) => found.has(name) ? artifact(name) : `${name} (unavailable)`).join(", ");
  const chart = ["rendered", "rendered-partial"].includes(result.projection?.status) && ["model.bower.json", "model.html", "model.svg"].every((name) => found.has(name)) ?
    `${result.projection.status === "rendered-partial" ? `partial (${result.projection.omittedStates} states and ${result.projection.omittedEdges} steps omitted); ` : ""}${artifact("model.bower.json")}, ${artifact("model.html")}, ${artifact("model.svg")}` :
    result.projection?.status === "omitted" ? `omitted (${result.projection.omittedStates} states and ${result.projection.omittedEdges} steps omitted; ${result.projection.reason}). Raw evidence remains linked.` :
    "unavailable (no checked chart; consult evidence.json and raw logs)";
  const reductions = evidence?.reductions ?? [];
  const constraint = reductions.some((r) => ["CONSTRAINT", "ACTION_CONSTRAINT"].includes(r.kind));
  const quotient = evidence?.graphIdentity === "representative";
  const reductionNotes = reductions.length ? `- Reductions: ${reductions.map((r) => `${code(r.kind)} ${code(r.name)}`).join(", ")} from the checked config. ${constraint ? "Boundary successors excluded from the DOT graph; exact count unknown. Boundary invariant evaluated only when a sourced witness identifies it; boundary deadlock not checked there. " : ""}${quotient ? "VIEW/SYMMETRY leave representative fingerprints; concrete states and transitions are not reconstructed, so the quotient chart is omitted. " : ""}This is partial model/config evidence, not unrestricted model coverage or implementation proof.\n` : "";
  const followOns = result.diagnostics;
  const diagnostics = followOns ? `## Follow-on diagnostics

These are separate model/config verdicts; not a combined proof. The original configuration, evidence and exit code above remain unchanged. Follow-on configurations omit only previously violated invariants and use a byte-identical copy of the source. Custom local module resolution may fail from the copy; that leaves the follow-on unchecked. Each follow-on has a ${code(followOns.distinctStateLimit)} distinct-state limit (monitored during execution and validated at completion; the process may briefly overshoot), plus the shared time and resource limits.

${followOns.runs.map((entry) => `- ${entry.label}: removed ${entry.excluded.map(code).join(", ")}; exit ${entry.exitCode}${entry.reason ? `, ${code(entry.reason)}` : ""}. Config [${entry.config}](${entry.config}) (SHA-256 ${entry.configSha256}); [source copy](${entry.model}) (SHA-256 ${entry.modelSha256}); ${["run.json", "evidence.json", "tlc.stdout"].map((name) => existsSync(path.join(dir, entry.directory, name)) ? `[${name}](${entry.directory}/${name})` : `${name} (unavailable)`).join(", ")}. Rules: ${entry.rules.map((rule) => `${code(rule.id)} ${rule.status} (${rule.provenance.stdout})`).join(", ") || "unchecked (no reliable rule results)"}.`).join("\n") || "- No follow-on run completed."}

Still unchecked across these separate runs: ${followOns.unchecked.map(code).join(", ") || "none reported"}. ${followOns.reason ? `Stopped: ${code(followOns.reason)}.` : ""} None of these checks proves the implementation correct.

` : "";
  const cp = result.command?.args?.indexOf("-cp") ?? -1;
  const rerun = { executable: "bowerbird", args: ["verify", result.inputs?.model?.path ?? "<model>", "--config", result.inputs?.config?.path ?? "<config>",
    "--tlc-jar", cp >= 0 ? result.command.args[cp + 1] : "<pinned-jar>", "--java", result.command?.executable ?? "java",
    "--timeout-ms", String(result.limits?.timeoutMs ?? 60000), ...(result.trustedView ? ["--trusted-view", result.trustedView.path] : []), "--out", "<new-output-directory>"] };
  const text = `# TLC model verification report

Outcome: ${verdict}. Exit: ${result.exitCode}. Cancellation, timeout, missing tools, unreadable evidence or partial output exit 2.
${result.reason ? `Reason: ${code(result.reason)}.\n` : ""}Original TLC outcome: ${code(result.rawOutcome ?? result.outcome)}; original exit: ${code(result.rawExitCode ?? result.exitCode)}. Projection and report errors do not turn this into a pass.

## Modelled and assumed

- Source: ${code(result.inputs?.model?.path ?? "unknown")}; Model SHA-256: ${result.inputs?.model?.sha256 ?? "unavailable"}.
- Config: ${code(result.inputs?.config?.path ?? "unknown")}; Config SHA-256: ${result.inputs?.config?.sha256 ?? "unavailable"}.
- Pinned TLC: ${code(result.tool?.version ?? "unknown")}; Tool SHA-256: ${result.tool?.sha256 ?? "unavailable"}. Java: ${code(result.javaVersion ?? "unknown")}.
- Variables seen: ${names.length ? names.map(code).join(", ") : "unavailable"}; actions seen: ${actions.length ? actions.map(code).join(", ") : "unavailable"}. This only describes observed model evidence, not implementation behavior.
- Assurance: model evidence; implementation defects require independent replay. Replay status: ${code(result.replay?.status ?? "model-only")}. No code-backed replay is performed by this command; a model violation is not an implementation defect.
- Display: ${result.trustedView ? `trusted executable view ${code(result.trustedView.path)} (SHA-256 ${result.trustedView.sha256}); display identities may group concrete fingerprints; all observed arrows remain in the chart` : "one card per observed concrete fingerprint"}. The chart is a faithful abstraction of observed model states, not a proof of implementation behaviour.
- Assumptions and constants are those supplied by the source and config above; this tool does not validate them against real code. Read both inputs to review their meaning. A finite TLC check supports only the specified model/config and checked rules; it does not prove the implementation correct.

## Bounds and omissions

- Timeout: ${code(result.limits?.timeoutMs ?? "unknown")} ms; heap: ${code(result.limits?.heapMiB ?? "unknown")} MiB; workers: ${code(result.limits?.workers ?? "unknown")}; log: ${code(result.limits?.logBytes ?? "unknown")} bytes; metadata: ${code(result.limits?.metadataBytes ?? "unknown")} bytes; graph: ${code(result.limits?.graphBytes ?? "unknown")} bytes. ${result.limits?.distinctStates ? `Distinct-state bound: ${code(result.limits.distinctStates)} (monitored during execution and checked against the final count; any over-bound result is incomplete)` : "No explicit distinct-state bound is set for TLC in this run"}. 500-state chart budget / 1500-step budget; larger graphs omit a no-violation chart or show only a complete sourced witness, with exact visual omissions recorded.
- Parsed ${quotient ? "representative quotient" : "model"} graph: ${evidence?.statistics?.distinct ?? values.length} TLC DOT states, ${values.length - (evidence?.statistics?.distinct ?? values.length)} witness-only boundary states, ${steps.length} sourced steps, ${Array.isArray(evidence?.initial) ? evidence.initial.length : "unknown"} initial states. If parsing was incomplete, these counts are not a coverage claim.
${reductionNotes}- Boundary status: ${result.exitCode === 0 ? "TLC reported completed for this model/config (subject to its configured constraints)" : result.exitCode === 1 && result.outcome === "temporal-violation" && evidence.boundary?.startsWith("none (") ? "state exploration completed for this model/config; temporal property violated" : "unknown"}. An early invariant or deadlock violation does not establish the full graph. No code-backed counterexample replay or hidden-state abstraction is claimed.${trace?.kind === "lasso" || trace?.kind === "stuttering" ? " This single temporal witness is bounded and not necessarily shortest." : " No temporal/liveness diagnosis is claimed."}${followOns ? " Follow-on verdicts are listed separately below; they do not upgrade the original result." : " No multi-run rule recovery is claimed."}
- Unchecked rules: ${rules.filter((rule) => status(rule) === "unchecked").map((rule) => code(rule.id)).join(", ") || "none reported"}; unchecked does not mean passed.

## Per-rule results

${ruleLines}

## Witness

${witness}

Replay: **model-only**. No implementation or executable replay contract was supplied. Reproduce a witness against real code independently before claiming an implementation defect.

${diagnostics}## Artifacts and reproduction

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
