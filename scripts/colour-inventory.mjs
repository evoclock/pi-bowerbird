// Inventory literal colours and opacities in rendered HTML. Unknown values are failures.
// Usage: node scripts/colour-inventory.mjs file.html [file.html ...] > colour-inventory.md
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTheme, mix } from "../lib/themes.mjs";
import { isoCss } from "../lib/render-iso.mjs";
import { paintCss, paintDefs } from "../lib/paint.mjs";
import { styleCss } from "../lib/styles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const themes = Object.fromEntries(["light", "dark"].map((id) => [id, loadTheme(id)]));
const sources = ["lib/render-iso.mjs", "lib/styles.mjs", "lib/paint.mjs", "lib/themes.mjs", "lib/render-html.mjs"];
const sourceLines = sources.flatMap((name) => readFileSync(path.join(root, name), "utf8").split("\n")
  .map((text, i) => ({ text, ref: `${name}:${i + 1}` })));
const tokenEntries = Object.entries(themes).flatMap(([mode, theme]) =>
  ["surfaces", "edges", "categories"].flatMap((section) => Object.entries(theme[section])
    .map(([key, value]) => ({ value: value.toLowerCase(), path: `themes/${mode}.json:${section}.${key}` }))));
const byToken = new Map();
for (const { value, path: tokenPath } of tokenEntries) {
  if (!byToken.has(value)) byToken.set(value, []);
  byToken.get(value).push(tokenPath);
}
// Ratios are discovered from existing rule-builder source, not supplied by this tool.
const ratios = [...new Set(sourceLines.filter(({ text }) => text.includes("mix(") || text.includes("dark ?"))
  .flatMap(({ text }) => [...text.matchAll(/(?<!\d)(?:0?\.\d+|1)(?!\d)/g)].map((m) => Number(m[0])))
  .filter((n) => n >= 0 && n <= 1))];
const mixes = new Map();
for (const a of tokenEntries) for (const b of tokenEntries.filter((entry) => entry.path.split("/")[1] === a.path.split("/")[1])) for (const ratio of ratios) {
  const result = mix(a.value, b.value, ratio).toLowerCase();
  if (!mixes.has(result)) mixes.set(result, []);
  if (mixes.get(result).length < 3) mixes.get(result).push(`${a.path} + ${b.path}; mix() ${ratio}`);
}
const categories = Object.fromEntries(Object.keys(themes.light.categories).map((id) => [id, { label: id }]));
const builderPalette = new Map();
for (const [name, theme] of Object.entries(themes)) for (const [source, text] of [
  ["lib/render-iso.mjs:176-195", isoCss(theme, categories)],
  ["lib/styles.mjs:167-229", styleCss(theme, categories, { style: "restrained", iso: true })],
  ["lib/styles.mjs:110-145", styleCss(theme, categories, { style: "expressive", iso: true })],
  ["lib/paint.mjs:14-54", paintDefs(theme, categories, { iso: true })],
  ["lib/paint.mjs:56-102", paintCss(theme, categories, "", { iso: true })],
]) for (const value of text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
  if (!builderPalette.has(value.toLowerCase())) builderPalette.set(value.toLowerCase(), source);
}
const named = new Set(["black", "white", "red", "green", "blue", "transparent", "currentcolor", "gray", "grey", "orange", "purple", "yellow"]);
export function collect(text) {
  const values = new Set((text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((v) => v.toLowerCase()));
  for (const m of text.matchAll(/\brgba?\([^)]*\)/gi)) values.add(m[0].toLowerCase());
  for (const m of text.matchAll(/(?:^|[;{\s])(?:fill|stroke|color|background|stop-color|flood-color)\s*[:=]\s*["']?([a-z]+)\b/gi)) {
    if (named.has(m[1].toLowerCase())) values.add(m[1].toLowerCase());
  }
  for (const m of text.matchAll(/(?:fill-opacity|stroke-opacity|(?<![\w-])opacity)\s*[:=]\s*["']?((?:\d*\.)?\d+)\b/g)) values.add(`${m[0].split(/\s*[:=]/)[0]}=${m[1]}`);
  return [...values].sort();
}
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
export function inventory(files) {
  const out = ["# Rendered colour and opacity inventory", "", "Values are literal CSS/SVG emissions, not computed pixels. A generated palette value without an identifiable mix ratio is disclosed as such, never assigned a guessed ratio."];
  let failures = 0;
  for (const file of files) {
    const values = collect(readFileSync(file, "utf8"));
    const direct = [], derived = [], unknown = [];
    for (const value of values) {
      if (byToken.has(value)) { direct.push([value, byToken.get(value).join(", ")]); continue; }
      if (value.includes("opacity=")) {
        const [, fraction] = value.split("=");
        const refs = sourceLines.filter(({ text }) => text.includes(fraction) && (text.includes("opacity") || text.includes("ISO_BASE"))).map(({ ref }) => ref);
        (refs.length ? derived : unknown).push([value, "opacity (not mix)", refs.slice(0, 6).join(", ") || "no builder match"]);
        continue;
      }
      if (value === "transparent") {
        derived.push([value, "no pigment; mix ratio n/a", "lib/composition.mjs (planned status swatch)"]);
        continue;
      }
      const mixesForValue = mixes.get(value);
      if (mixesForValue?.length && builderPalette.has(value)) {
        const options = mixesForValue.join(" OR ");
        const numbers = [...new Set(mixesForValue.map((s) => s.match(/mix\(\) ([\d.]+)/)?.[1]))];
        const refs = sourceLines.filter(({ text }) => text.includes("mix(") && numbers.some((number) => text.includes(number))).map(({ ref }) => ref);
        derived.push([value, `possible token pairs, not proven: ${options}`, refs.slice(0, 6).join(", ") || builderPalette.get(value)]);
      } else if (builderPalette.has(value)) {
        derived.push([value, "existing rule-builder output; mix ratio n/a (pastelize or literal)", builderPalette.get(value)]);
      } else unknown.push([value, "NOT IN TOKEN OR RULE-BUILDER PALETTE", "FAIL"]);
    }
    failures += unknown.length;
    out.push("", `## ${file}`, "", `Extracted ${values.length} distinct literal values.`, "", "### Direct theme tokens", "", "| Value | Token path |", "| --- | --- |", ...direct.map(([a, b]) => `| ${esc(a)} | ${esc(b)} |`), "", "### Derived values and opacity", "", "| Value | Source token(s) / mix ratio | Rule builder file:line |", "| --- | --- | --- |", ...derived.map(([a, b, c]) => `| ${esc(a)} | ${esc(b)} | ${esc(c)} |`), "", `### FAIL: unmatched values (${unknown.length})`, "", "| Value | Reason |", "| --- | --- |", ...unknown.map(([a, b]) => `| ${esc(a)} | ${esc(b)} |`));
  }
  out.push("", `**TOTAL UNMATCHED: ${failures} ${failures ? "FAIL" : "PASS"}**`);
  return { markdown: out.join("\n") + "\n", failures };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3) { console.error("Usage: node scripts/colour-inventory.mjs file.html [file.html ...]"); process.exitCode = 2; }
  else { const result = inventory(process.argv.slice(2)); console.log(result.markdown); if (result.failures) process.exitCode = 1; }
}
