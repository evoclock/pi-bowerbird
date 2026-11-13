// TLC 1.7.4 release asset, reviewed SHA-256. Caller supplies the jar; never download implicitly.
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { preflight } from "./tlc-preflight.mjs";

export const TLC_VERSION = "1.7.4";
export const TLC_SHA256 = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const LOG_LIMIT = 8 * 1024 * 1024;
const DISK_LIMIT = 64 * 1024 * 1024;
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const size = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, entry) => {
  const name = path.join(dir, entry.name);
  return n + (entry.isDirectory() ? size(name) : entry.isFile() ? statSync(name).size : 0);
}, 0);

export async function runTlc(modelPath, configPath, { jar, out, java = "java", timeoutMs = 60000, signal } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) throw new Error("verify: --timeout-ms must be 100..600000");
  const input = preflight(modelPath, configPath, { java });
  if (!jar || !out) throw new Error("verify: --tlc-jar and --out are required");
  const tool = path.resolve(jar);
  if (!existsSync(tool) || digest(tool) !== TLC_SHA256) throw new Error(`verify: TLC jar missing or SHA-256 differs from pinned ${TLC_VERSION} release`);
  const destination = path.resolve(out);
  if (existsSync(destination)) throw new Error("verify: --out must name a new directory (do not overwrite evidence)");
  mkdirSync(destination, { recursive: true });
  const meta = path.join(destination, "tlc-meta");
  mkdirSync(meta);
  const args = ["-Xmx256m", "-cp", tool, "tlc2.TLC", "-tool", "-workers", "1", "-seed", "1", "-fp", "0", "-metadir", meta, "-config", input.config, input.model];
  const command = { executable: java, args, cwd: path.dirname(input.model) };
  const record = {
    schema: "bowerbird/tlc-run/v1", tool: { version: TLC_VERSION, sha256: TLC_SHA256 },
    inputs: { model: { path: input.model, sha256: digest(input.model) }, config: { path: input.config, sha256: digest(input.config) } },
    javaVersion: input.javaVersion, command, limits: { timeoutMs, heapMiB: 256, workers: 1, logBytes: LOG_LIMIT, metadataBytes: DISK_LIMIT },
    outcome: "incomplete", exitCode: 2,
  };
  const stdout = createWriteStream(path.join(destination, "tlc.stdout"), { flags: "wx" });
  const stderr = createWriteStream(path.join(destination, "tlc.stderr"), { flags: "wx" });
  let output = "", bytes = 0, stopped = null, child;
  const stop = (reason) => { if (!stopped) { stopped = reason; child?.kill("SIGKILL"); } };
  const onAbort = () => stop("cancelled");
  const clock = setTimeout(() => stop("timeout"), timeoutMs);
  const disk = setInterval(() => {
    try { if (size(meta) > DISK_LIMIT) stop("metadata limit"); }
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
  try { if (size(meta) > DISK_LIMIT) stopped ??= "metadata limit"; }
  catch { stopped ??= "metadata read error"; }
  try {
    if (digest(input.model) !== record.inputs.model.sha256 || digest(input.config) !== record.inputs.config.sha256) stopped ??= "input changed during check";
  } catch { stopped ??= "input unavailable after check"; }
  if (stopped) record.reason = stopped;
  // TLC -tool markers and process exit must agree. All other results stay incomplete.
  else if (record.tlcExit?.code === 0 && /@!@!@STARTMSG 2193:0 @!@!@/.test(output) && /@!@!@STARTMSG 2186:0 @!@!@/.test(output) && !/@!@!@STARTMSG \d+:1 @!@!@/.test(output)) {
    record.outcome = "completed-no-violation"; record.exitCode = 0;
  } else if (record.tlcExit?.code === 12 && /@!@!@STARTMSG 2110:1 @!@!@/.test(output) && /@!@!@STARTMSG 2186:0 @!@!@/.test(output)) {
    record.outcome = "violation"; record.exitCode = 1;
  } else record.reason = "TLC result is not a recognised completed run; rules may be unchecked";
  writeFileSync(path.join(destination, "run.json"), JSON.stringify(record, null, 2) + "\n");
  return record;
}
