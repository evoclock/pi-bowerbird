import path from "node:path";
import { basenameOf, loadDiagram } from "./export.mjs";

// Embeds that work where Mermaid does not: GitHub renders <img> SVGs with
// their CSS animation intact, and <picture> follows the viewer's theme.
export function embedSnippets(file, { outDir, repoRoot = process.cwd(), view } = {}) {
  const base = basenameOf(file);
  const chosen = view ?? loadDiagram(file).meta.view;
  const flat = chosen ? base : `${base}.flat`;
  const iso = `${base}.iso`;
  const dir = path.relative(repoRoot, path.resolve(outDir ?? path.dirname(file))).split(path.sep).join("/") || ".";
  const p = (name) => `${dir}/${name}`;
  return `<!-- GitHub README: theme-aware, animated -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${p(`${flat}.dark.svg`)}">
  <img alt="${base} architecture" src="${p(`${flat}.light.svg`)}">
</picture>

<!-- Link the image to the interactive page (GitHub Pages / local) -->
[![${base}](${p(`${flat}.dark.svg`)})](${p(`${flat}.html`)})

<!-- Markdown / MARP slide (raster for PDF/PPTX export) -->
![${base} w:1100](${p(`${flat}.dark.webp`)})

<!-- MARP, theme-matched SVG -->
![bg contain](${p(`${flat}.light.svg`)})
${chosen ? "" : `
<!-- Isometric view -->
[Isometric diagram](${p(`${iso}.html`)})
![${base} isometric](${p(`${iso}.light.svg`)})
`}`;
}
