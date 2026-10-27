#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { analyse, journeys, toTla } from "../lib/verify.mjs";
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
  bowerbird validate <file> [--strict]     schema + layout checks (strict: warnings fail)
  bowerbird sync <file> [--check] [--merge-ref origin/main] [--render ...]
                                           refresh node status from git evidence
  bowerbird init <file> [--title "..."]    write a starter diagram
  bowerbird snippets <file> [--out dir]    README <picture>, MARP, and markdown embeds
  bowerbird diff <file> [--against REF]    structural changes since a git ref (default HEAD)

statecharts (nodes with shape initial/final/choice, edges with event/guard/action):
  bowerbird check <file>                   unreachable states, dead ends, ambiguous events
  bowerbird journeys <file>                initial -> final paths as Given/When/Then
  bowerbird tla <file> [--out dir]         TLA+ module + TLC config for model checking
`;

const opts = {
  out: { type: "string" }, view: { type: "string" }, formats: { type: "string" },
  dark: { type: "string" }, light: { type: "string" }, "default-theme": { type: "string" }, "light-flat-fill": { type: "string" },
  "embed-font": { type: "string" }, scale: { type: "string" }, "repo-root": { type: "string" },
  strict: { type: "boolean" }, check: { type: "boolean" }, render: { type: "boolean" },
  title: { type: "string" }, against: { type: "string" }, direction: { type: "string" }, "merge-ref": { type: "string" }, style: { type: "string" }, help: { type: "boolean", short: "h" },
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
  if (!file) throw new Error(`${cmd}: missing <file>`);
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
    case "render": {
      const r = await build(file, clean(renderOpts()));
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
      const { ref, changes } = diffAgainst(file, { ref: values.against ?? "HEAD", repoRoot, current: loadDiagram(file) });
      console.log(changes.length ? `changes since ${ref}:\n${changes.map((c) => `  ${c.text}`).join("\n")}` : `no changes since ${ref}`);
      return 0;
    }
    case "check": {
      const findings = analyse(loadDiagram(file));
      for (const f of findings) console.log(`${f.severity} [${f.code}] ${f.message}`);
      if (!findings.length) console.log("ok: every state reachable, every state can finish, no ambiguous events");
      return findings.some((f) => f.severity === "error") ? 1 : 0;
    }
    case "journeys": {
      console.log(journeys(loadDiagram(file)).join("\n\n"));
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
