// TLC 1.7.4 release asset, reviewed SHA-256. Caller supplies the jar; never download implicitly.
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { preflight } from "./tlc-preflight.mjs";
import { interpretEvidence } from "./tlc-evidence.mjs";
import { ChartOmittedError, projectFlat } from "./tlc-project.mjs";
import { build } from "./export.mjs";
import { reportForRun } from "./tlc-report.mjs";

export const TLC_VERSION = "1.7.4";
export const TLC_SHA256 = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const LOG_LIMIT = 8 * 1024 * 1024;
const DISK_LIMIT = 64 * 1024 * 1024;
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const size = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, entry) => {
  const name = path.join(dir, entry.name);
  return n + (entry.isDirectory() ? size(name) : entry.isFile() ? statSync(name).size : 0);
}, 0);

export async function runTlc(modelPath, configPath, { jar, out, java = "java", timeoutMs = 60000, signal,
  diagnose = true, distinctStateLimit, diagnosticStateLimit = 100000, trustedView } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) throw new Error("verify: --timeout-ms must be 100..600000");
  if ([distinctStateLimit, diagnosticStateLimit].some((n) => n !== undefined && (!Number.isSafeInteger(n) || n < 1 || n > 100000))) throw new Error("verify: diagnostic distinct-state limit must be 1..100000");
  const input = preflight(modelPath, configPath, { java });
  if (!jar || !out) throw new Error("verify: --tlc-jar and --out are required");
  const tool = path.resolve(jar);
  if (!existsSync(tool) || digest(tool) !== TLC_SHA256) throw new Error(`verify: TLC jar missing or SHA-256 differs from pinned ${TLC_VERSION} release`);
  // Importing an executable view grants it the caller's process privileges. Never infer trust from its filename.
  let view, viewInput;
  if (trustedView) {
    const file = path.resolve(trustedView);
    viewInput = { path: file, sha256: digest(file) };
    view = await import(pathToFileURL(file).href);
    if (typeof view.state !== "function" || (view.step !== undefined && typeof view.step !== "function") || (view.regions !== undefined && typeof view.regions !== "function")) throw new Error("verify: trusted view must export state(vars) and optional step/regions functions");
  }
  const destination = path.resolve(out);
  if (existsSync(destination)) throw new Error("verify: --out must name a new directory (do not overwrite evidence)");
  mkdirSync(destination, { recursive: true });
  const meta = path.join(destination, "tlc-meta");
  const dot = path.join(destination, "tlc.dot");
  // TLC 1.7.4 has no native distinct-state ceiling; monitor the streamed DOT and reject any over-bound final count.
  const overStateLimit = () => {
    if (!distinctStateLimit || !existsSync(dot)) return false;
    let count = 0;
    for (const _ of readFileSync(dot, "utf8").matchAll(/^-?\d+ \[label="/gm)) if (++count > distinctStateLimit) return true;
    return false;
  };
  mkdirSync(meta);
  const args = ["-Xmx256m", "-cp", tool, "tlc2.TLC", "-tool", "-workers", "1", "-seed", "1", "-fp", "0", "-metadir", meta,
    "-dump", "dot,actionlabels", dot, "-config", input.config, input.model];
  const command = { executable: java, args, cwd: path.dirname(input.model) };
  const record = {
    schema: "bowerbird/tlc-run/v1", tool: { version: TLC_VERSION, sha256: TLC_SHA256 },
    inputs: { model: { path: input.model, sha256: digest(input.model) }, config: { path: input.config, sha256: digest(input.config) } },
    ...(viewInput ? { trustedView: viewInput } : {}),
    replay: { status: "model-only", implementationEvidence: false, reason: "No implementation or executable replay contract supplied" },
    javaVersion: input.javaVersion, command, limits: { timeoutMs, heapMiB: 256, workers: 1, logBytes: LOG_LIMIT, metadataBytes: DISK_LIMIT, graphBytes: LOG_LIMIT,
      ...(distinctStateLimit ? { distinctStates: distinctStateLimit } : {}) },
    outcome: "incomplete", exitCode: 2,
  };
  const stdout = createWriteStream(path.join(destination, "tlc.stdout"), { flags: "wx" });
  const stderr = createWriteStream(path.join(destination, "tlc.stderr"), { flags: "wx" });
  let output = "", bytes = 0, stopped = null, child;
  const stop = (reason) => { if (!stopped) { stopped = reason; child?.kill("SIGKILL"); } };
  const onAbort = () => stop("cancelled");
  const clock = setTimeout(() => stop("timeout"), timeoutMs);
  const disk = setInterval(() => {
    try {
      if (size(meta) > DISK_LIMIT) stop("metadata limit");
      if (existsSync(dot) && statSync(dot).size > LOG_LIMIT) stop("graph limit");
      if (overStateLimit()) stop("distinct-state bound");
    }
    catch { stop("metadata read error"); }
  }, 200);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) stop("cancelled");
    if (!stopped) {
      const result = await new Promise((resolve) => {
        try {
          child = spawn(java, args, { cwd: command.cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
          child.stdout.on("data", (chunk) => { bytes += chunk.length; stdout.write(chunk); if (bytes <= LOG_LIMIT) output += chunk; else stop("log limit"); });
          child.stderr.on("data", (chunk) => { bytes += chunk.length; stderr.write(chunk); if (bytes > LOG_LIMIT) stop("log limit"); });
          child.once("error", (error) => resolve({ error: error.message }));
          child.once("close", (code, signalName) => resolve({ code, signalName }));
          if (signal?.aborted) stop("cancelled");
        } catch (error) { resolve({ error: error.message }); }
      });
      record.tlcExit = result;
    }
  } finally {
    clearTimeout(clock);
    clearInterval(disk);
    signal?.removeEventListener("abort", onAbort);
    await Promise.all([new Promise((resolve) => stdout.end(resolve)), new Promise((resolve) => stderr.end(resolve))]);
  }
  try {
    if (size(meta) > DISK_LIMIT) stopped ??= "metadata limit";
    if (existsSync(dot) && statSync(dot).size > LOG_LIMIT) stopped ??= "graph limit";
    if (overStateLimit() || (distinctStateLimit && Number(/@!@!@STARTMSG 2199:0 @!@!@\r?\n\d+ states generated, (\d+) distinct states found/.exec(output)?.[1]) > distinctStateLimit)) stopped ??= "distinct-state bound";
  } catch { stopped ??= "metadata read error"; }
  try {
    if (digest(input.model) !== record.inputs.model.sha256 || digest(input.config) !== record.inputs.config.sha256 || (viewInput && digest(viewInput.path) !== viewInput.sha256)) stopped ??= "input changed during check";
  } catch { stopped ??= "input unavailable after check"; }
  if (stopped) record.reason = stopped;
  // TLC -tool markers and process exit must agree. All other results stay incomplete.
  else if (record.tlcExit?.code === 0 && /@!@!@STARTMSG 2193:0 @!@!@/.test(output) && /@!@!@STARTMSG 2186:0 @!@!@/.test(output) && !/@!@!@STARTMSG \d+:1 @!@!@/.test(output)) {
    record.outcome = "completed-no-violation"; record.exitCode = 0;
  } else if (record.tlcExit?.code === 12 && /@!@!@STARTMSG 2110:1 @!@!@/.test(output) && /@!@!@STARTMSG 2186:0 @!@!@/.test(output)) {
    record.outcome = "violation"; record.exitCode = 1;
  } else if (record.tlcExit?.code === 11 && /@!@!@STARTMSG 2114:1 @!@!@/.test(output) && /@!@!@STARTMSG 2121:1 @!@!@/.test(output) && /@!@!@STARTMSG 2186:0 @!@!@/.test(output)) {
    record.outcome = "deadlock"; record.exitCode = 1;
  } else if (record.tlcExit?.code === 13 && /@!@!@STARTMSG 2116:1 @!@!@/.test(output) && /@!@!@STARTMSG 2264:1 @!@!@/.test(output) && /@!@!@STARTMSG 2186:0 @!@!@/.test(output)) {
    record.outcome = "temporal-violation"; record.exitCode = 1;
  } else record.reason = "TLC result is not a recognised completed run; rules may be unchecked";
  const evidence = interpretEvidence(record, destination);
  record.rawOutcome = record.outcome;
  record.rawExitCode = record.exitCode;
  record.evidence = { file: "evidence.json", outcome: evidence.outcome };
  if (evidence.outcome === "unchecked") {
    record.outcome = "incomplete";
    record.exitCode = 2;
    record.reason ??= evidence.reason;
  }
  writeFileSync(path.join(destination, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  if (evidence.outcome !== "unchecked") {
    try {
      const chart = projectFlat(evidence, { view });
      const chartFile = path.join(destination, "model.bower.json");
      writeFileSync(chartFile, JSON.stringify(chart, null, 2) + "\n");
      const rendered = await build(chartFile, { outDir: destination, view: "flat", formats: ["html", "svg"] });
      if (rendered.warnings.length) throw new Error(`flat chart has layout warnings: ${rendered.warnings.map((w) => w.code).join(", ")}`);
      record.projection = { status: chart.meta.projectionOmissions ? "rendered-partial" : "rendered", chart: "model.bower.json", html: "model.html", svg: "model.svg",
        ...(chart.meta.projectionOmissions ? { omittedStates: chart.meta.projectionOmissions.states, omittedEdges: chart.meta.projectionOmissions.edges } : {}) };
    } catch (error) {
      if (error instanceof ChartOmittedError) record.projection = { status: "omitted", reason: error.message,
        omittedStates: error.omittedStates, omittedEdges: error.omittedEdges };
      else {
        record.projection = { status: "unchecked", reason: error.message };
        record.reason = `chart projection incomplete: ${error.message}`;
        record.outcome = "incomplete";
        record.exitCode = 2;
      }
    }
  } else record.projection = { status: "unchecked", reason: evidence.reason };
  const report = reportForRun(record, evidence, destination);
  Object.assign(record, report.run);
  try {
    writeFileSync(path.join(destination, "report.md"), report.text, { flag: "wx" });
    record.report = { file: "report.md", status: "written" };
  } catch (error) {
    record.outcome = "incomplete";
    record.exitCode = 2;
    record.reason = `report unavailable: ${error.message}`;
    record.report = { status: "unchecked", reason: record.reason };
  }
  try {
    writeFileSync(path.join(destination, "run.json"), JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  } catch (error) {
    record.outcome = "incomplete";
    record.exitCode = 2;
    record.reason = `run metadata unavailable: ${error.message}`;
    try { writeFileSync(path.join(destination, "report.md"), reportForRun(record, evidence, destination).text); } catch { /* original error remains authoritative */ }
    throw error;
  }
  if (diagnose && record.exitCode === 1 && evidence.rules.some((rule) => rule.kind === "invariant" && rule.id === evidence.trace?.rule && rule.status === "violated")) {
    await runDiagnostics(record, evidence, destination, { jar: tool, java, timeoutMs, signal, diagnosticStateLimit });
  }
  return record;
}

async function runDiagnostics(original, evidence, destination, { jar, java, timeoutMs, signal, diagnosticStateLimit }) {
  const remaining = evidence.rules.filter((rule) => rule.kind === "invariant" && rule.status === "unchecked");
  if (!remaining.length) return;
  const source = readFileSync(original.inputs.config.path, "utf8");
  const excluded = [evidence.trace.rule];
  const checked = new Set(evidence.rules.filter((rule) => rule.status !== "unchecked").map((rule) => rule.id));
  const folder = path.join(destination, "diagnostics");
  mkdirSync(folder);
  // TLC resolves configs beside the spec. The copy is byte-identical; the original model/config never change.
  const modelCopy = path.join(folder, path.basename(original.inputs.model.path));
  writeFileSync(modelCopy, readFileSync(original.inputs.model.path), { flag: "wx" });
  const summary = { schema: "bowerbird/tlc-diagnostics/v1", original: { configSha256: original.inputs.config.sha256,
    outcome: original.outcome, exitCode: original.exitCode, run: "run.json", evidence: "evidence.json" },
    distinctStateLimit: diagnosticStateLimit, runs: [], unchecked: [], status: "partial" };
  const deadline = Date.now() + timeoutMs;
  for (let index = 1; index <= Math.min(remaining.length, 16); index++) {
    if (signal?.aborted || deadline - Date.now() < 100) { summary.reason = signal?.aborted ? "cancelled" : "diagnostic time budget"; break; }
    if (digest(original.inputs.config.path) !== original.inputs.config.sha256 || digest(original.inputs.model.path) !== original.inputs.model.sha256) {
      summary.reason = "original inputs changed; diagnostic runs stopped"; break;
    }
    const removed = new Set();
    const config = source.split(/(?<=\n)/).filter((line) => {
      const name = /^\s*INVARIANT\s+([A-Za-z_]\w*)\s*$/.exec(line.trim())?.[1];
      if (name && excluded.includes(name)) { removed.add(name); return false; }
      return true;
    }).join("");
    if (removed.size !== excluded.length || !config.includes("INVARIANT")) { summary.reason = "cannot safely remove only known failed rules"; break; }
    const configName = `diagnostics/pass-${index}.cfg`;
    const directory = `diagnostics/pass-${index}`;
    try { writeFileSync(path.join(destination, configName), config, { flag: "wx" }); }
    catch (error) { summary.reason = `diagnostic config unavailable: ${error.message}`; break; }
    const entry = { label: `Follow-on ${index}`, excluded: [...excluded], config: configName, configSha256: digest(path.join(destination, configName)),
      model: `diagnostics/${path.basename(modelCopy)}`, modelSha256: digest(modelCopy),
      directory, distinctStateLimit: diagnosticStateLimit, exitCode: 2, rules: [] };
    try {
      const run = await runTlc(modelCopy, path.join(destination, configName), { jar, java, out: path.join(destination, directory),
        timeoutMs: Math.min(timeoutMs, Math.max(100, deadline - Date.now())), signal, diagnose: false, distinctStateLimit: diagnosticStateLimit });
      const follow = JSON.parse(readFileSync(path.join(destination, directory, "evidence.json"), "utf8"));
      entry.exitCode = run.exitCode;
      entry.outcome = run.outcome;
      entry.reason = run.reason;
      entry.rules = follow.rules.map((rule) => ({ id: rule.id, kind: rule.kind, status: rule.status,
        provenance: { run: `${directory}/run.json`, evidence: `${directory}/evidence.json`, stdout: `${directory}/tlc.stdout`, messageCode: rule.provenance?.messageCode ?? null } }));
      for (const rule of entry.rules) if (rule.status !== "unchecked") checked.add(rule.id);
      summary.runs.push(entry);
      if (run.exitCode === 0) break;
      const newlyFailed = entry.rules.filter((rule) => rule.status === "violated" && !excluded.includes(rule.id));
      if (run.exitCode !== 1 || newlyFailed.length !== 1) { summary.reason = run.reason ?? "diagnostic verdict is incomplete or ambiguous"; break; }
      excluded.push(newlyFailed[0].id);
    } catch (error) {
      entry.reason = `diagnostic run unavailable: ${error.message}`;
      summary.runs.push(entry);
      summary.reason = entry.reason;
      break;
    }
  }
  summary.unchecked = evidence.rules.filter((rule) => !checked.has(rule.id)).map((rule) => rule.id);
  if (summary.unchecked.length && !summary.reason) summary.reason = summary.runs.length >= 16 ? "diagnostic run cap (16)" : "no further supported diagnostic rule";
  summary.status = summary.unchecked.length || summary.reason ? "partial" : "diagnosed";
  try {
    writeFileSync(path.join(destination, "diagnostics.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
    original.diagnostics = { file: "diagnostics.json", ...summary };
    writeFileSync(path.join(destination, "report.md"), reportForRun(original, evidence, destination).text);
    writeFileSync(path.join(destination, "run.json"), JSON.stringify(original, null, 2) + "\n");
  } catch (error) {
    original.exitCode = 2;
    original.outcome = "incomplete";
    original.reason = `diagnostic record unavailable: ${error.message}`;
    try { writeFileSync(path.join(destination, "run.json"), JSON.stringify(original, null, 2) + "\n"); } catch { /* CLI still returns 2 */ }
  }
}
