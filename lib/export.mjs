import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync, copyFileSync } from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { normalise } from "./model.mjs";
import { evidenceExtension } from "./evidence.mjs";
import { layout } from "./layout.mjs";
import { renderSvg } from "./render-svg.mjs";
import { renderHtml } from "./render-html.mjs";
import { loadTheme } from "./themes.mjs";
import { isoLayout, renderIsoSvg } from "./render-iso.mjs";
import { analyse } from "./verify.mjs";

export const FORMATS = ["html", "svg", "png", "webp"];

function hasBinary(name, versionFlag = "--version") {
  try { execFileSync(name, [versionFlag], { stdio: "ignore" }); return true; } catch { return false; }
}

async function optional(spec) {
  try { return await import(spec); } catch { return null; }
}

// Raster path: librsvg + libwebp CLIs when present (fast, no npm deps),
// otherwise the optional @resvg/resvg-js and sharp packages.
async function rasterise(svg, scale) {
  if (hasBinary("rsvg-convert")) {
    // Pass a file rather than piping SVG: a converter that exits before reading
    // stdin can otherwise turn its real error into a parent-side EPIPE.
    const tmpSvg = path.join(os.tmpdir(), `bowerbird-${process.pid}-${crypto.randomUUID()}.src.svg`);
    writeFileSync(tmpSvg, svg);
    try {
      try {
        return execFileSync("rsvg-convert", ["--zoom", String(scale), "--format", "png", tmpSvg], { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      } catch (cause) {
        const stderr = cause.stderr?.toString().trim();
        if (stderr) throw new Error(`rsvg-convert failed: ${stderr}`, { cause });
        throw cause;
      }
    } finally { unlinkSync(tmpSvg); }
  }
  const resvg = await optional("@resvg/resvg-js");
  if (resvg) return Buffer.from(new resvg.Resvg(svg, { fitTo: { mode: "zoom", value: scale } }).render().asPng());
  throw new Error("PNG export needs rsvg-convert (brew install librsvg) or the optional @resvg/resvg-js package");
}

async function toWebp(png, outFile) {
  if (hasBinary("cwebp", "-version")) {
    const tmpPng = path.join(os.tmpdir(), `bowerbird-${process.pid}-${crypto.randomUUID()}.src.png`);
    writeFileSync(tmpPng, png);
    try { execFileSync("cwebp", ["-quiet", "-q", "92", tmpPng, "-o", outFile]); }
    finally { unlinkSync(tmpPng); }
    return;
  }
  const sharp = await optional("sharp");
  if (sharp) { await sharp.default(png).webp({ quality: 92 }).toFile(outFile); return; }
  throw new Error("WebP export needs cwebp (brew install webp) or the optional sharp package");
}

// Geist Sans for embedding into standalone SVGs. An explicit path wins;
// otherwise look where `brew install --cask font-geist` and manual installs
// put it. Returns null when absent, and SVGs fall back to system fonts.
const GEIST_CANDIDATES = [
  "Library/Fonts/Geist-Variable.woff2", "Library/Fonts/Geist[wght].ttf", "Library/Fonts/GeistVF.ttf",
  "Library/Fonts/Geist-Regular.otf", ".local/share/fonts/Geist[wght].ttf", ".local/share/fonts/GeistVF.ttf",
];

export function findGeist(explicit) {
  const candidates = explicit ? [explicit] : GEIST_CANDIDATES.map((p) => path.join(os.homedir(), p));
  for (const file of candidates) {
    if (existsSync(file)) return { file, ext: path.extname(file).toLowerCase(), data: readFileSync(file) };
  }
  if (explicit) throw new Error(`embed font not found: ${explicit}`);
  return null;
}

export function loadDiagram(file, { direction, style, lightFlatFill } = {}) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (direction) raw.meta = { ...raw.meta, direction };
  if (style) raw.meta = { ...raw.meta, style };
  if (lightFlatFill) raw.meta = { ...raw.meta, lightFlatFill };
  return normalise(raw, { extensions: [evidenceExtension] });
}

export function basenameOf(file) {
  return path.basename(file).replace(/\.bower\.json$|\.json$/, "");
}

export async function build(file, {
  outDir,
  formats = FORMATS,
  view,
  darkTheme = "dark",
  lightTheme = "light",
  defaultTheme = "dark",
  scale = 2,
  repoRoot = process.cwd(),
  embedFont,
  direction,
  style,
  lightFlatFill,
} = {}) {
  const model = loadDiagram(file, { direction, style, lightFlatFill });
  if (model.meta.kind === "statechart" && !model.meta.verificationProjection) {
    for (const f of analyse(model)) if (f.node) (model.nodes.find((n) => n.id === f.node)._findings ??= []).push(f);
  }
  const requestedView = view ?? model.meta.view;
  if (requestedView && !["flat", "iso"].includes(requestedView)) throw new Error(`view must be "flat" or "iso"`);
  const views = requestedView ? [requestedView] : ["flat", "iso"];
  const dark = loadTheme(darkTheme);
  const light = loadTheme(lightTheme);
  const lay = layout(model);
  // embedFont is opt-in: true = search known locations, string = explicit path.
  const font = embedFont ? findGeist(typeof embedFont === "string" ? embedFont : undefined) : null;
  const base = basenameOf(file);
  const dir = path.resolve(outDir ?? path.dirname(file));
  mkdirSync(dir, { recursive: true });
  const written = [];
  const planned = [];
  const warnings = [];
  const stage = mkdtempSync(path.join(dir, ".bowerbird-stage-"));
  const write = (name, data) => { const p = path.join(stage, name); writeFileSync(p, data); planned.push(name); };
  const animate = model.meta.animation !== "static";
  let activeView;
  try {
  for (const v of views) {
    activeView = v;
    const iso = v === "iso" ? isoLayout(model, lay) : null;
    const name = views.length === 2 ? `${base}.${v}` : base;
    warnings.push(...(iso ?? lay).warnings);
    const svgFor = (theme, extra = {}) => (iso ? renderIsoSvg(model, iso, { theme, font, ...extra }) : renderSvg(model, lay, { theme, font, ...extra }));
    if (formats.includes("html")) {
      const svgOverride = iso ? renderIsoSvg(model, iso, { interactive: true, animate: true, themes: { dark, light } }) : undefined;
      write(`${name}.html`, renderHtml(model, iso ?? lay, {
        light, dark, defaultTheme, repoRoot: path.resolve(repoRoot), outDir: dir, basename: name, sourceBasename: base, svgOverride, view: v, font,
        ...(iso ? { standaloneFor: (theme) => renderIsoSvg(model, iso, { theme }) } : {}),
      }));
    }
    if (formats.includes("svg")) {
      write(`${name}.svg`, svgFor(light, { darkTheme: dark, animate }));
      write(`${name}.dark.svg`, svgFor(dark, { animate }));
      write(`${name}.light.svg`, svgFor(light, { animate }));
    }
    for (const [mode, theme] of [["dark", dark], ["light", light]]) {
      if (!formats.includes("png") && !formats.includes("webp")) break;
      const png = await rasterise(svgFor(theme, { animate: false }), scale);
      if (formats.includes("png")) write(`${name}.${mode}.png`, png);
      if (formats.includes("webp")) { const filename = `${name}.${mode}.webp`; await toWebp(png, path.join(stage, filename)); planned.push(filename); }
    }
  }
  // Keep prior destination files available for rollback if publication itself fails.
  for (const name of planned) {
    const target = path.join(dir, name);
    if (existsSync(target)) copyFileSync(target, path.join(stage, `${name}.previous`));
    renameSync(path.join(stage, name), target);
    written.push(target);
  }
  return { model, written, warnings, view: requestedView ?? "both" };
  } catch (cause) {
    for (const target of written) {
      const backup = path.join(stage, `${path.basename(target)}.previous`);
      if (existsSync(backup)) renameSync(backup, target);
      else unlinkSync(target);
    }
    const receipt = { written: [], skipped: views.slice(views.indexOf(activeView) + 1), failed: [{ view: activeView ?? views[0], reason: cause.message }] };
    throw Object.assign(new Error(`render failed: ${cause.message}`), { receipt, cause });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
