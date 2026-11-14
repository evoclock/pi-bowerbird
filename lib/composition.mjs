// Opt-in composition maps: project the authored graph into the existing iso renderer.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { normalise } from "./model.mjs";
import { layout } from "./layout.mjs";
import { isoLayout, renderIsoSvg } from "./render-iso.mjs";
import { categoryColor, loadTheme } from "./themes.mjs";
import { esc } from "./render-svg.mjs";

const TYPES = ["skill", "recipe", "playbook", "workflow"];
const STATUSES = ["built", "partial", "planned"];
// Theme category hues identify groups only; readiness uses neutral construction cues.
export const GROUP_TOKENS = Object.freeze(["teal", "rust", "slate", "peach", "olive", "sage", "mustard", "mauve"]);
const own = (v) => v && typeof v === "object" && !Array.isArray(v);

export function validateComposition(c, fail) {
  if (!own(c) || !Array.isArray(c.groups) || !Array.isArray(c.components) || !Array.isArray(c.edges)) {
    fail("composition-shape", "composition needs groups, components and edges arrays");
    return;
  }
  if (c.groups.length > GROUP_TOKENS.length) fail("composition-group-palette", `composition supports at most ${GROUP_TOKENS.length} distinct group colours`);
  const groupColours = c.groups.map((g, i) => g?.category ?? GROUP_TOKENS[i]);
  if (new Set(groupColours).size !== groupColours.length) fail("composition-group-palette", "each group needs a different theme category");
  const ids = new Set();
  const groups = new Set();
  for (const [kind, entries] of [["group", c.groups], ["component", c.components]]) {
    for (const item of entries) {
      if (!own(item) || typeof item.id !== "string" || !item.id || ids.has(item.id)) {
        fail("composition-id", `${kind} needs a unique, nonempty id`); continue;
      }
      ids.add(item.id);
      if (kind === "group") groups.add(item.id);
      if (typeof item.title !== "string" || !item.title) fail("composition-title", `${kind} "${item.id}" needs a title`);
      if (!STATUSES.includes(item.status)) fail("composition-status", `${kind} "${item.id}" status must be built, partial or planned`);
      if (item.category !== undefined && !GROUP_TOKENS.includes(item.category)) fail("composition-category", `${kind} "${item.id}" category must name a theme category`);
    }
  }
  const components = new Map();
  for (const item of c.components) {
    if (!own(item) || typeof item.id !== "string" || !item.id) continue;
    components.set(item.id, item);
    if (!groups.has(item.group)) fail("composition-group", `component "${item.id}" references unknown group "${item.group}"`);
    if (!TYPES.includes(item.type)) fail("composition-type", `component "${item.id}" type must be ${TYPES.join(", ")}`);
    if (typeof item.purpose !== "string" || !item.purpose.trim() || /[\r\n]/.test(item.purpose)) fail("composition-purpose", `component "${item.id}" needs a one-line purpose`);
  }
  const steps = new Set();
  for (const [i, edge] of c.edges.entries()) {
    if (!own(edge)) { fail("composition-edge", `edge #${i} must be an object`); continue; }
    const from = components.get(edge.from), to = components.get(edge.to);
    if (!from || !to) { fail("composition-endpoint", `edge #${i} references unknown component`); continue; }
    if (!(["workflow", "playbook", "recipe"].includes(from.type) && to.type === (from.type === "workflow" ? "playbook" : "skill"))) {
      fail("composition-type", `edge #${i} must run a skill from a playbook/recipe or chain a playbook from a workflow`);
    }
    if (!Number.isSafeInteger(edge.step) || edge.step < 1 || steps.has(`${edge.from}:${edge.step}`)) fail("composition-step", `edge #${i} needs a positive unique step for "${edge.from}"`);
    steps.add(`${edge.from}:${edge.step}`);
  }
}

const nodeStatus = (status) => status === "built" ? "implemented" : status;
const diagram = (title, nodes, edges, groupPalette) => normalise({
  schema: "bowerbird/v1",
  meta: { title, view: "iso", style: "expressive", statusTracking: !groupPalette, compositionMap: true, animation: "static", grid: { col: 300, row: 190, gap: 60 } },
  categories: Object.fromEntries([...new Set(nodes.map((n) => n.category))].map((id) => [id, { label: id }])),
  nodes: nodes.map((n, i) => ({ id: n.id, title: n.title, lines: n.lines, type: n.type, status: nodeStatus(n.status),
    category: n.category, at: [i, 0] })),
  edges: edges.map((e) => ({ from: e.from, to: e.to, label: e.label, kind: "control" })),
});

function svg(title, nodes, edges, themes, groupPalette = false) {
  const model = diagram(title, nodes, edges, groupPalette);
  // The existing expressive iso path calls isoCss, styleCss/paintCss and
  // paintDefs. It owns category faces, gradients and status opacity rules.
  return renderIsoSvg(model, isoLayout(model, layout(model)), { themes, interactive: true, animate: false });
}

const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export function renderComposition(c, title, sha) {
  const themes = { light: loadTheme("light"), dark: loadTheme("dark") };
  const groupCategory = new Map(c.groups.map((g, i) => [g.id, g.category ?? GROUP_TOKENS[i]]));
  const themeVars = Object.entries(themes).map(([name, theme]) => `html[data-theme=${name}]{--bg:${theme.surfaces.canvas};--panel:${theme.surfaces.panel};--ink:${theme.surfaces.text};--line:${theme.surfaces.border}}${c.groups.map((g, i) => `html[data-theme=${name}] .swatch.group-${i}{background:${categoryColor(theme, groupCategory.get(g.id))}}`).join("")}`).join("\n");
  const byId = new Map(c.components.map((item) => [item.id, item]));
  const groupOf = (id) => byId.get(id).group;
  const groupEdges = [...new Map(c.edges.filter((e) => groupOf(e.from) !== groupOf(e.to))
    .map((e) => [`${groupOf(e.from)}:${groupOf(e.to)}`, { from: groupOf(e.from), to: groupOf(e.to) }])).values()];
  const overview = svg(title, c.groups.map((g) => {
    const members = c.components.filter((n) => n.group === g.id);
    const counts = STATUSES.map((status) => members.filter((n) => n.status === status).length);
    return { ...g, category: groupCategory.get(g.id), type: `${members.length} · B${counts[0]} P${counts[1]} L${counts[2]} · ${g.status}`, lines: [g.status] };
  }), groupEdges, themes, true);
  const panels = c.groups.map((g) => {
    const members = c.components.filter((n) => n.group === g.id);
    const memberIds = new Set(members.map((n) => n.id));
    const edges = c.edges.filter((e) => memberIds.has(e.from) && memberIds.has(e.to));
    const map = svg(g.title, members.map((n) => ({ ...n, category: n.category ?? groupCategory.get(n.group), lines: [n.purpose] })), edges.map((e) => ({ ...e, label: `${e.step}` })), themes);
    const cross = c.edges.filter((e) => memberIds.has(e.from) && !memberIds.has(e.to));
    return `<section class="panel" data-group="${esc(g.id)}" hidden><button type="button" class="back">← Overview</button><h2>${esc(g.title)} · ${esc(g.status)} · ${members.length} components</h2><div class="map">${map}</div><ul class="purposes">${members.map((n) => `<li><strong>${esc(n.title)}</strong> · ${esc(n.purpose)} · ${esc(n.status)}</li>`).join("")}</ul><ol class="connections">${[...edges, ...cross].map((e) => `<li data-from="${esc(e.from)}" data-to="${esc(e.to)}">${esc(e.from)} → ${esc(e.to)} · step ${e.step}${memberIds.has(e.to) ? "" : " · other group"}</li>`).join("")}</ol></section>`;
  }).join("\n");
  const chains = Object.fromEntries(c.components.filter((n) => n.type === "workflow").map((w) => {
    const steps = c.edges.filter((e) => e.from === w.id).sort((a, b) => a.step - b.step);
    return [w.id, steps.flatMap((e) => [e.to, ...c.edges.filter((child) => child.from === e.to).sort((a, b) => a.step - b.step).map((child) => child.to)])];
  }));
  const legend = `<aside class="composition-legend" aria-label="Map colour legend"><h2>Legend</h2><div><strong>Groups</strong>${c.groups.map((g, i) => `<span class="legend-item"><span class="swatch group-${i}"></span>${esc(g.title)}</span>`).join("")}</div><div><strong>Status</strong>${STATUSES.map((status) => `<span class="legend-item"><span class="swatch status-${status}"></span>${status}</span>`).join("")}</div></aside>`;
  const workflowButtons = c.components.filter((n) => n.type === "workflow").map((n) => `<button type="button" class="workflow" data-workflow="${esc(n.id)}" data-chain="${esc(chains[n.id].join(" "))}">${esc(n.title)}</button>`).join("");
  return `<!doctype html>\n<html lang="en" data-theme="light" data-bowerbird-version="${version}" data-bowerbird-input-sha="${sha}">\n<head>\n<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="generator" content="bowerbird ${version}">\n<meta name="bowerbird-input-sha" content="${sha}">\n<title>${esc(title)}</title>\n<style>\n:root{color-scheme:light dark}${themeVars}body{margin:2rem auto;max-width:1500px;padding:0 2rem;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}button{cursor:pointer;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:5px;padding:.6rem;margin:.3rem}button:focus-visible,.bb-node:focus-visible{outline:3px solid var(--ink)}svg{display:block;max-width:100%;height:auto}.map{overflow:auto}.panel[hidden]{display:none}.is-dimmed{opacity:.12}.bb-node,.bb-edge{transition:opacity .2s}.connections{display:flex;gap:2rem;flex-wrap:wrap}.connections li{min-width:140px}.composition-legend{border:1px solid var(--line);border-radius:6px;padding:.5rem 1rem;margin:1rem 0}.composition-legend>div{display:flex;flex-wrap:wrap;gap:.8rem;align-items:center;margin:.5rem 0}.legend-item{display:inline-flex;align-items:center;gap:.4rem}.swatch{display:inline-block;width:1.2rem;height:1.2rem;border:2px solid var(--ink);border-radius:2px}.swatch.status-built,.swatch.status-partial{background:var(--panel)}.swatch.status-planned{border-style:dashed;background:transparent}.swatch.status-partial{background-image:repeating-linear-gradient(45deg,transparent 0 4px,var(--ink) 4px 6px)}\n</style></head>\n<body><h1>${esc(title)}</h1><p>Choose a group to open its isometric map. Select a workflow to follow its playbooks and skills in step order.</p><nav aria-label="Workflows">${workflowButtons}</nav><button id="theme-toggle" type="button">Dark theme</button>${legend}<ol id="chain-order" aria-label="Workflow step order" hidden></ol><section id="overview"><h2>Overview</h2><p>Each group shows its component count and badges: B built, P partial, L planned.</p><div class="map">${overview}</div></section>${panels}\n<script>\nconst chains = ${safeJson(chains)};\ndocument.getElementById('theme-toggle').addEventListener('click', (e) => { const root = document.documentElement; root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light'; e.currentTarget.textContent = root.dataset.theme === 'light' ? 'Dark theme' : 'Light theme'; });\nconst panels = document.querySelectorAll(".panel");\nfunction openGroup(id) {\n  document.getElementById("overview").hidden = true;\n  for (const panel of panels) { panel.hidden = panel.dataset.group !== id; if (panel.dataset.group === id) panel.hidden = false; }\n}\nfunction highlightWorkflow(id) {\n  const chain = [id, ...chains[id]];
  document.body.classList.add('workflow-active');\n  for (const node of document.querySelectorAll(".panel .bb-node")) node.classList.toggle("is-dimmed", !chain.includes(node.dataset.id));\n  for (const edge of document.querySelectorAll(".panel .bb-edge")) edge.classList.toggle("is-dimmed", !chain.includes(edge.dataset.from) || !chain.includes(edge.dataset.to));\n  document.querySelectorAll(".workflow").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.workflow === id)));\n  document.getElementById('overview').hidden = true;
  for (const panel of panels) panel.hidden = ![...panel.querySelectorAll('.bb-node[data-id]')].some((node) => chain.includes(node.dataset.id));
  const order = document.getElementById('chain-order'); order.replaceChildren(); order.hidden = false;
  for (const component of chain) { const li = document.createElement('li'); li.textContent = component; order.append(li); }\n}\ndocument.querySelectorAll('#overview .bb-node[data-id]').forEach((node) => { node.setAttribute('role','button'); node.setAttribute('tabindex','0'); const action = () => openGroup(node.dataset.id); node.addEventListener('click',action); node.addEventListener('keydown',(e) => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); } }); });\ndocument.querySelectorAll('.back').forEach((button) => button.addEventListener('click',() => { panels.forEach((panel) => { panel.hidden = true; }); document.getElementById('overview').hidden = false; document.getElementById('chain-order').hidden = true; document.querySelectorAll('.is-dimmed').forEach((el) => el.classList.remove('is-dimmed')); document.body.classList.remove('workflow-active'); }));\ndocument.querySelectorAll('.workflow').forEach((button) => button.addEventListener('click',() => highlightWorkflow(button.dataset.workflow)));\ndocument.querySelectorAll('.panel .bb-node[data-id]').forEach((node) => { const id = node.dataset.id; if(chains[id]) node.addEventListener('click', () => highlightWorkflow(id)); });\n</script></body></html>\n`;
}

export function writeComposition(file, out, inputSha) {
  const source = JSON.parse(readFileSync(file, "utf8"));
  normalise(source);
  if (!source.composition) throw new Error("composition: input needs a composition object");
  const sha = inputSha ?? execFileSync("git", ["-C", path.dirname(path.resolve(file)), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("composition: input SHA must be a full 40-character lowercase hex commit");
  const html = renderComposition(source.composition, source.meta?.title ?? "Composition map", sha);
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, html);
  return out;
}
