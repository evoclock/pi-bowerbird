#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { writePlanFile } from "../lib/plan-file.mjs";
import { writeComposition } from "../lib/composition.mjs";
import { analyse, journeys, toTla } from "../lib/verify.mjs";
import { runTlc } from "../lib/tlc-runner.mjs";
import { diffAgainst } from "../lib/diff.mjs";
import path from "node:path";
import { parseArgs } from "node:util";
import { build, loadDiagram, basenameOf, FORMATS } from "../lib/export.mjs";
import { layout } from "../lib/layout.mjs";
import { syncFile } from "../lib/status.mjs";
import { BowerError } from "../lib/model.mjs";
import { starter } from "../lib/starter.mjs";
import { embedSnippets } from "../lib/snippets.mjs";

const HELP = `bowerbird: reproducible HTML/SVG/PNG/WebP architecture diagrams

  bowerbird render <file.bower.json> [--out dir] [--view flat|iso] [--direction LR|TD] [--style restrained|expressive]
                   [--formats html,svg,png,webp] [--dark dark|path]
                   [--light light|path] [--default-theme dark|light] [--light-flat-fill dots|filled]
                   [--embed-font [path]] [--scale 2] [--repo-root dir]
  With no --view (and no meta.view), render writes both <name>.flat.* and <name>.iso.*.
  --view flat or --view iso limits output to one view with <name>.* filenames.
  bowerbird composition <file.bower.json> --out <file.html> [--input-sha <40-hex>]\n                                           one standalone light isometric composition map\n  bowerbird validate <file> [--strict]     schema + layout checks (strict: warnings fail)
  bowerbird sync <file> [--check] [--merge-ref origin/main] [--render ...]
                                           refresh node status from git evidence
  bowerbird plan --tasks <md> [--spec <md> ...] [--prs <json>] --out <file.bower.json> [--update <existing.bower.json>]
                                           import planned work from task ledgers
  bowerbird init <file> [--title "..."]    write a starter diagram
  bowerbird snippets <file> [--out dir]    README <picture>, MARP, and markdown embeds
  bowerbird diff <file> [--against REF]    structural changes since a git ref (default HEAD)

statecharts (nodes with shape initial/final/choice, edges with event/guard/action):
  bowerbird check <file>                   unreachable states, dead ends, ambiguous events
  bowerbird journeys <file>                initial -> final paths as Given/When/Then
  bowerbird tla <file> [--out dir]         abstract control-flow export (does not run TLC)
  bowerbird verify <file.tla> --config <file.cfg> --tlc-jar <pinned.jar> --out <new-dir>
                   [--java executable] [--timeout-ms 60000] [--trusted-view local-view.mjs]
                                           TLC execution + report.md + flat model-evidence chart
                                           exit 0: completed/no violation; 1: model violation; 2: incomplete/error (including cancellation)
`;

const opts = {
  out: { type: "string" }, "input-sha": { type: "string" }, view: { type: "string" }, formats: { type: "string" },
  dark: { type: "string" }, light: { type: "string" }, "default-theme": { type: "string" }, "light-flat-fill": { type: "string" },
  "embed-font": { type: "string" }, scale: { type: "string" }, "repo-root": { type: "string" },
  strict: { type: "boolean" }, check: { type: "boolean" }, render: { type: "boolean" },
  title: { type: "string" }, config: { type: "string" }, "trusted-view": { type: "string" }, java: { type: "string" }, "tlc-jar": { type: "string" }, "timeout-ms": { type: "string" }, tasks: { type: "string" }, spec: { type: "string", multiple: true }, prs: { type: "string" }, update: { type: "string" }, against: { type: "string" }, direction: { type: "string" }, "merge-ref": { type: "string" }, style: { type: "string" }, help: { type: "boolean", short: "h" },
};

function embedFlag(argv) {
  const i = argv.indexOf("--embed-font");
  if (i === -1) return undefined;
  const next = argv[i + 1];
  if (!next || next.startsWith("--") || next.endsWith(".json")) { argv.splice(i + 1, 0, ""); return true; }
  return next;
}

async function main(argv) {
  const embedFont = embedFlag(argv);
  const { positionals, values } = parseArgs({ args: argv, options: opts, allowPositionals: true });
  const [cmd, file] = positionals;
  if (values.help || !cmd) { process.stdout.write(HELP); return 0; }
  if (!file && cmd !== "plan") throw new Error(`${cmd}: missing <file>`);
  const repoRoot = values["repo-root"] ?? process.cwd();
  const renderOpts = () => ({
    outDir: values.out,
    view: values.view,
    direction: values.direction,
    style: values.style,
    lightFlatFill: values["light-flat-fill"],
    formats: values.formats ? values.formats.split(",").map((s) => s.trim()) : FORMATS,
    darkTheme: values.dark, lightTheme: values.light,
    defaultTheme: values["default-theme"],
    scale: values.scale ? Number(values.scale) : undefined,
    repoRoot,
    embedFont: embedFont === true ? true : embedFont || undefined,
  });
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

  switch (cmd) {
    case "composition": {
      if (positionals.length !== 2 || !values.out || !values.out.endsWith(".html")) throw new Error("composition: expected one input and --out <file.html>");
      console.log(writeComposition(file, values.out, values["input-sha"]));
      return 0;
    }
    case "verify": {
      if (positionals.length !== 2) throw new Error("verify: expected exactly one .tla model");
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      try {
        const result = await runTlc(file, values.config, { java: values.java, jar: values["tlc-jar"], out: values.out,
          timeoutMs: values["timeout-ms"] === undefined ? undefined : Number(values["timeout-ms"]), trustedView: values["trusted-view"], signal: controller.signal });
        console.error(`verify: ${result.outcome} (exit ${result.exitCode}); ${result.report?.status === "written" ? `report.md and evidence in ${values.out}` : `report unavailable; evidence in ${values.out}`}; finite model/config only, not implementation correctness`);
        return result.exitCode;
      } finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
    }
    case "plan": {
      if (file || !values.tasks || (!values.out && !values.update)) throw new Error("plan: expected --tasks <md> --out <file.bower.json> (no positional file)");
      const result = writePlanFile({ tasksPath: values.tasks, specPaths: values.spec ?? [], prsPath: values.prs,
        outPath: values.out, updatePath: values.update, title: values.title });
      console.log(`${result.changed ? "wrote" : "unchanged"} ${result.path}`);
      return 0;
    }
    case "render": {
      let r;
      try { r = await build(file, clean(renderOpts())); }
      catch (err) {
        if (err.receipt) console.log(JSON.stringify(err.receipt, null, 2));
        throw err;
      }
      for (const w of r.warnings) console.error(`warning [${w.code}] ${w.message}`);
      for (const p of r.written) console.log(path.relative(process.cwd(), p));
      return 0;
    }
    case "validate": {
      const model = loadDiagram(file);
      const { warnings } = layout(model);
      for (const w of warnings) console.error(`warning [${w.code}] ${w.message}`);
      console.log(`ok: ${model.nodes.length} nodes, ${model.edges.length} edges, ${warnings.length} warning(s)`);
      return values.strict && warnings.length ? 1 : 0;
    }
    case "sync": {
      const { changes, mergeRef } = syncFile(file, { repoRoot, write: !values.check, mergeRef: values["merge-ref"] });
      console.log(mergeRef ? `merge target: ${mergeRef}` : "merge target: none found (nothing counts as merged yet)");
      for (const c of changes) console.log(`${c.id}: ${c.from} -> ${c.to}`);
      if (!changes.length) console.log("status: up to date");
      if (values.check) return changes.length ? 1 : 0;
      if (values.render) {
        const r = await build(file, clean(renderOpts()));
        for (const p of r.written) console.log(path.relative(process.cwd(), p));
      }
      return 0;
    }
    case "init": {
      if (existsSync(file)) throw new Error(`init: ${file} already exists`);
      writeFileSync(file, JSON.stringify(starter(values.title ?? basenameOf(file)), null, 2) + "\n");
      console.log(`wrote ${file}`);
      return 0;
    }
    case "snippets": {
      process.stdout.write(embedSnippets(file, { outDir: values.out, repoRoot, view: values.view }));
      return 0;
    }
    case "diff": {
      const { ref, changes } = diffAgainst(file, { ref: values.against ?? "HEAD", repoRoot, current: loadDiagram(file), sourcePath: process.env.BOWERBIRD_SOURCE_PATH ?? file });
      console.log(changes.length ? `changes since ${ref}:\n${changes.map((c) => `  ${c.text}`).join("\n")}` : `no changes since ${ref}`);
      return 0;
    }
    case "check": {
      const model = loadDiagram(file);
      if (model.meta.verificationProjection) throw new Error("check: model-derived chart is not an authored graph check; consult its TLC evidence");
      const findings = analyse(model);
      for (const f of findings) console.log(`${f.severity} [${f.code}] ${f.message}`);
      if (!findings.some((f) => f.severity === "error")) {
        const canFinish = !findings.some((f) => f.code === "no-final");
        console.log(`ok: every state reachable${canFinish ? ", every state can finish" : ""}; initial transition valid; ambiguity checked`);
      }
      return findings.some((f) => f.severity === "error") ? 1 : 0;
    }
    case "journeys": {
      const model = loadDiagram(file);
      if (model.meta.verificationProjection) throw new Error("journeys: model-derived chart is not an exhaustive behaviour map; consult its TLC evidence");
      console.log(journeys(model).join("\n\n"));
      return 0;
    }
    case "tla": {
      const model = loadDiagram(file);
      const name = basenameOf(file).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ?? "").toUpperCase()).replace(/^./, (c) => c.toUpperCase());
      const { tla, cfg } = toTla(model, name);
      const dir = path.resolve(values.out ?? path.dirname(file));
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${name}.tla`), tla);
      writeFileSync(path.join(dir, `${name}.cfg`), cfg);
      console.log(path.relative(process.cwd(), path.join(dir, `${name}.tla`)));
      console.log(path.relative(process.cwd(), path.join(dir, `${name}.cfg`)));
      return 0;
    }
    default:
      throw new Error(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof BowerError ? err.message : `bowerbird: ${err.message}`);
    process.exit(2);
  },
);
