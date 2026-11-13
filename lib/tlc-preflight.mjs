// Input/toolchain readiness only. No TLC invocation or model verdict lives here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function preflight(modelPath, configPath, { java = "java", run = spawnSync } = {}) {
  if (!modelPath?.endsWith(".tla") || !configPath?.endsWith(".cfg")) {
    throw new Error("verify: supply a .tla model and a .cfg with --config");
  }
  const model = path.resolve(modelPath);
  const config = path.resolve(configPath);
  let source, settings;
  try {
    source = readFileSync(model, "utf8");
    settings = readFileSync(config, "utf8");
  } catch (error) {
    throw new Error(`verify: cannot read model/config: ${error.message}`);
  }
  const moduleName = path.basename(model, ".tla");
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(moduleName) ||
      !source.split(/\r?\n/).some((line) => /^-+\s*MODULE\s+([A-Za-z][A-Za-z0-9_]*)\s*-+\s*$/.exec(line)?.[1] === moduleName)) {
    throw new Error("verify: TLA+ MODULE name must match the .tla filename");
  }
  if (!settings.trim()) throw new Error("verify: .cfg is empty");
  const result = run(java, ["-version"], { encoding: "utf8", timeout: 15000, maxBuffer: 65536, windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`verify: Java preflight failed: ${result.error?.message ?? result.stderr ?? `exit ${result.status}`}`);
  }
  const version = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.match(/\bversion\s+"(?:1\.)?(\d+)(?:[._+\-][^"\s]*)?"/i);
  if (!version || Number(version[1]) < 17) {
    throw new Error("verify: Java 17+ is required; Java version was missing or unsupported");
  }
  return { model, config, javaVersion: Number(version[1]) };
}
