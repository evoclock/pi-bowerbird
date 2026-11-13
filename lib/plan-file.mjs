// File adapter for local scripts and the CLI. It never invokes a model or a network service.
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { planDiagram } from "./plan.mjs";
import { updatePlan } from "./plan-update.mjs";

export function writePlanFile({ tasksPath, specPaths = [], prsPath, outPath, updatePath, title = "Planned work" }) {
  if (!tasksPath || (!outPath && !updatePath) || !Array.isArray(specPaths)) throw new TypeError("plan: tasksPath and outPath or updatePath are required");
  const destination = outPath ?? updatePath;
  const identity = (p) => existsSync(p) ? realpathSync(p) : path.resolve(p);
  if ([tasksPath, ...specPaths, prsPath].filter(Boolean).some((p) => identity(p) === identity(destination))) throw new Error("plan: output cannot replace an input document");
  const imported = planDiagram({
    tasks: readFileSync(tasksPath, "utf8"),
    specs: specPaths.map((p) => readFileSync(p, "utf8")),
    prs: prsPath ? JSON.parse(readFileSync(prsPath, "utf8")) : [],
    title,
  });
  const current = updatePath ? readFileSync(updatePath, "utf8") : null;
  const { diagram, changed } = current ? updatePlan(JSON.parse(current), imported) : { diagram: imported, changed: true };
  const output = current && !changed ? current : JSON.stringify(diagram, null, 2) + "\n";
  if (existsSync(destination) && readFileSync(destination, "utf8") !== output && (!updatePath || identity(destination) !== identity(updatePath))) throw new Error(`plan: refusing to overwrite differing output ${destination}`);
  if (!existsSync(destination)) writeFileSync(destination, output, { flag: "wx" });
  else if (readFileSync(destination, "utf8") !== output) writeFileSync(destination, output);
  return { path: destination, changed, diagram };
}
