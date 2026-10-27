// Pi extension: exposes the bowerbird CLI as one agent tool and a /bowerbird
// command, so agents never need to know where the package is installed.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "bowerbird.mjs");
const ACTIONS = ["render", "validate", "check", "journeys", "tla", "diff", "sync", "snippets", "init"];

function run(args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0;
      resolve({ code, out: [stdout, stderr].filter(Boolean).join("\n").trim() });
    });
  });
}

export default function bowerbird(pi: any) {
  if (typeof pi?.registerTool === "function") {
    pi.registerTool({
      name: "bowerbird",
      label: "bowerbird",
      description:
        "Render and check *.bower.json diagrams (architecture maps, statecharts, concept maps). " +
        "Actions: render (HTML + SVG + PNG/WebP; view flat|iso), validate (layout warnings), " +
        "check (statechart: unreachable, dead-end, ambiguous), journeys (Given/When/Then paths), " +
        "tla (TLA+ spec + TLC cfg), diff (changes since a git ref), sync (refresh node status from git), " +
        "snippets (README/MARP embeds), init (starter file). Load the bowerbird skill before authoring a diagram.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ACTIONS },
          file: { type: "string", description: "Path to the *.bower.json file, relative to the working directory" },
          out: { type: "string", description: "Output directory (render, tla, snippets)" },
          view: { type: "string", enum: ["flat", "iso"] },
          direction: { type: "string", enum: ["LR", "TD"], description: "Layout direction (overrides meta.direction)" },
          style: { type: "string", enum: ["restrained", "expressive"], description: "Design language: restrained (minimal, default) or expressive (expressive)" },
          categoryFillParity: { type: "string", enum: ["mode", "dark"], description: "Light-mode category fills: default chalky or dark-mode parity" },
          formats: { type: "string", description: "Comma list of html,svg,png,webp (render)" },
          against: { type: "string", description: "Git ref for diff (default HEAD)" },
          check: { type: "boolean", description: "sync: report without writing; exits non-zero on changes" },
          strict: { type: "boolean", description: "validate: treat warnings as failure" },
        },
        required: ["action", "file"],
      },
      async execute(_id: string, p: any, _signal: unknown, _onUpdate: unknown, ctx: any) {
        const args = [p.action, p.file];
        if (p.out) args.push("--out", p.out);
        if (p.view) args.push("--view", p.view);
        if (p.direction) args.push("--direction", p.direction);
        if (p.style) args.push("--style", p.style);
        if (p.categoryFillParity) args.push("--category-fill-parity", p.categoryFillParity);
        if (p.formats) args.push("--formats", p.formats);
        if (p.against) args.push("--against", p.against);
        if (p.check) args.push("--check");
        if (p.strict) args.push("--strict");
        const { code, out } = await run(args, ctx?.cwd ?? process.cwd());
        return { content: [{ type: "text", text: out || `(exit ${code})` }], details: { exitCode: code }, isError: code > 1 };
      },
    });
  }

  if (typeof pi?.registerCommand === "function") {
    pi.registerCommand("bowerbird", {
      description: "Run bowerbird: /bowerbird <action> <file> [flags]",
      argumentHint: "render docs/arch.bower.json --view iso",
      handler: async (args: string, ctx: any) => {
        const argv = String(args ?? "").trim().split(/\s+/).filter(Boolean);
        const { out } = await run(argv.length ? argv : ["--help"], ctx?.cwd ?? process.cwd());
        ctx?.ui?.notify?.(out, "info");
      },
    });
  }
}
