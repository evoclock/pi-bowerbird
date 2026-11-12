// Supplied evidence annotations. These are labels, not inferred findings or build status.
// Existing evidence.paths/tests/status continue to belong to status sync.
import { esc } from "./render-svg.mjs";

const KINDS = new Set(["breaks", "mayBreak", "bugPath", "repeats", "assumed", "unchecked"]);
const WORD = { breaks: "! BREAKS", mayBreak: "? MAY BREAK", bugPath: "→ BUG PATH", repeats: "↻ REPEATS", assumed: "~ ASSUMED", unchecked: "○ UNCHECKED" };
const safeLink = (url) => typeof url === "string" && (url.startsWith("https://") && !/[\s<>"'\\]/.test(url) || /^(?![\/\.])(?!.*(?:^|\/)\.\.(?:\/|$))[\w.\-/]+(?:#[\w.-]+)?$/.test(url));

function validate(input, fail) {
  for (const [i, node] of (input.nodes ?? []).entries()) {
    const evidence = node.evidence;
    if (evidence === undefined) continue;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) { fail("evidence", `node #${i} evidence must be an object`); continue; }
    if (evidence.marks === undefined) continue;
    if (!Array.isArray(evidence.marks)) { fail("evidence-marks", `node #${i} evidence.marks must be an array`); continue; }
    for (const [j, mark] of evidence.marks.entries()) {
      const where = `node #${i} mark #${j}`;
      if (!mark || typeof mark !== "object" || Array.isArray(mark) || !KINDS.has(mark.kind)) { fail("evidence-kind", `${where} needs a known kind`); continue; }
      if (typeof mark.label !== "string" || !mark.label.trim() || mark.label.length > 120) fail("evidence-label", `${where} needs a label of 1–120 characters`);
      if (mark.trace !== undefined && !safeLink(mark.trace)) fail("evidence-trace", `${where} has an unsafe trace link`);
    }
  }
}

function marks(model) {
  return model.nodes.filter((n) => n.evidence?.marks?.length);
}

function svg(model, lay, { interactive, links } = {}) {
  const out = [];
  for (const node of marks(model)) {
    const slab = lay.slabs?.find((s) => s.n.id === node.id);
    const rect = slab ? { x: slab.centre[0] + 24, y: slab.centre[1] - 23, w: 120 } : lay.rects.get(node.id);
    if (!rect) continue;
    const { x, y, w } = rect;
    out.push(`<g class="bb-evidence" aria-label="Supplied evidence for ${esc(node.title ?? node.id)}">`);
    node.evidence.marks.forEach((mark, i) => {
      const text = `${WORD[mark.kind]}: ${mark.label}`;
      const pos = `x="${Math.round(x + w - 12)}" y="${Math.round(y + 54 + i * 13)}"`;
      const visible = text.length > 29 ? `${text.slice(0, 28)}…` : text;
      const label = `<text ${pos} text-anchor="end" class="bb-copy" font-size="10" font-family="sans-serif" font-weight="600">${esc(visible)}</text>`;
      out.push(mark.trace && links !== false && !interactive
        ? `<a href="${esc(mark.trace)}" aria-label="${esc(text)} (trace)"><title>${esc(text)}: ${esc(mark.trace)}</title>${label}</a>`
        : `<g aria-label="${esc(text)}"><title>${esc(text)}${mark.trace ? `: ${esc(mark.trace)}` : ""}</title>${label}</g>`);
    });
    out.push("</g>");
  }
  return out.join("\n");
}

function html(model, _lay, { rewrite = (s) => s } = {}) {
  const nodes = marks(model);
  if (!nodes.length) return "";
  const sections = nodes.map((node) => `<section><h3>${esc(node.title ?? node.id)}</h3><ul>${node.evidence.marks.map((mark) => {
    const text = `${WORD[mark.kind]}: ${mark.label}`;
    const link = mark.trace ? ` <a href="${esc(rewrite(mark.trace))}">Trace</a>` : "";
    return `<li>${esc(text)}${link}</li>`;
  }).join("")}</ul></section>`).join("");
  return `<section class="details bb-evidence-details" aria-label="Supplied evidence"><h2>Supplied evidence</h2>${sections}</section>`;
}

export const evidenceExtension = Object.freeze({ validate, svg, html });
