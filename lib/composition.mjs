// Opt-in composition maps: project the authored graph into the existing iso renderer.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { normalise } from "./model.mjs";
import { layout } from "./layout.mjs";
import { isoLayout, renderIsoSvg } from "./render-iso.mjs";
import { loadTheme } from "./themes.mjs";
import { esc } from "./render-svg.mjs";

const TYPES = ["skill", "recipe", "playbook", "workflow"];
const STATUSES = ["built", "partial", "planned"];
// Fixed, ordered palette: status uses blue, orange and purple; groups use separate hues.
export const STATUS_COLOURS = Object.freeze({ built: "#0072B2", partial: "#E69F00", planned: "#CC79A7" });
export const GROUP_COLOURS = Object.freeze(["#009E73", "#D55E00", "#56B4E9", "#F0E442", "#CC79A7", "#0072B2", "#E69F00", "#6B55A1"]);
const own = (v) => v && typeof v === "object" && !Array.isArray(v);

export function validateComposition(c, fail) {
  if (!own(c) || !Array.isArray(c.groups) || !Array.isArray(c.components) || !Array.isArray(c.edges)) {
    fail("composition-shape", "composition needs groups, components and edges arrays");
    return;
  }
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
const diagram = (title, nodes, edges) => normalise({
  schema: "bowerbird/v1",
  meta: { title, view: "iso", statusTracking: true, compositionMap: true, animation: "static", grid: { col: 300, row: 190, gap: 60 } },
  nodes: nodes.map((n, i) => ({ id: n.id, title: n.title, lines: n.lines, type: n.type, status: nodeStatus(n.status), at: [i, 0] })),
  edges: edges.map((e) => ({ from: e.from, to: e.to, label: e.label, kind: "control" })),
});

function svg(title, nodes, edges, groupPalette = false) {
  const model = diagram(title, nodes, edges);
  const base = renderIsoSvg(model, isoLayout(model, layout(model)), { theme: loadTheme("light"), interactive: true, animate: false });
  // Scoped to composition SVGs: legacy diagrams retain their own paint rules.
  const rules = Object.entries(STATUS_COLOURS).map(([status, colour]) =>
    `.bb-node.status-${nodeStatus(status)} .iso-roof{fill:${colour};fill-opacity:1}` +
    `.bb-node.status-${nodeStatus(status)} .iso-left,.bb-node.status-${nodeStatus(status)} .iso-right{fill:${colour};fill-opacity:1}`
  );
  if (groupPalette) nodes.forEach((n, i) => {
    // A JSON-quoted attribute value is also a valid CSS string, with escaped control characters.
    const selector = `.bb-node[data-id=${JSON.stringify(n.id)}]`;
    rules.push(`${selector} .iso-roof{fill:${GROUP_COLOURS[i % GROUP_COLOURS.length]} !important;fill-opacity:1}`);
  });
  rules.push(`.bb-node.status-planned .iso-face{stroke-dasharray:5 4;stroke-width:2}`,
    `.bb-node.status-partial .iso-hatch line{stroke:#17212b;opacity:.9;stroke-width:2}`,
    `.iso-tag-bg,.iso-label-bg{fill:#ffffff;fill-opacity:1}`,
    `.bb-node-title,.bb-kicker,.bb-label{fill:#17212b}`,
    `.workflow-active .bb-node:not(.is-dimmed) .iso-roof{stroke:#17212b;stroke-width:4}`);
  return base.replace("</style>", `${rules.join("\n")}\n</style>`);
}

const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export function renderComposition(c, title, sha) {
  const byId = new Map(c.components.map((item) => [item.id, item]));
  const groupOf = (id) => byId.get(id).group;
  const groupEdges = [...new Map(c.edges.filter((e) => groupOf(e.from) !== groupOf(e.to))
    .map((e) => [`${groupOf(e.from)}:${groupOf(e.to)}`, { from: groupOf(e.from), to: groupOf(e.to) }])).values()];
  const overview = svg(title, c.groups.map((g) => {
    const members = c.components.filter((n) => n.group === g.id);
    const counts = STATUSES.map((status) => members.filter((n) => n.status === status).length);
    return { ...g, type: `${members.length} · B${counts[0]} P${counts[1]} L${counts[2]}`, lines: [g.status] };
  }), groupEdges, true);
  const panels = c.groups.map((g) => {
    const members = c.components.filter((n) => n.group === g.id);
    const memberIds = new Set(members.map((n) => n.id));
    const edges = c.edges.filter((e) => memberIds.has(e.from) && memberIds.has(e.to));
    const map = svg(g.title, members.map((n) => ({ ...n, lines: [n.purpose] })), edges.map((e) => ({ ...e, label: `${e.step}` })));
    const cross = c.edges.filter((e) => memberIds.has(e.from) && !memberIds.has(e.to));
    return `<section class="panel" data-group="${esc(g.id)}" hidden><button type="button" class="back">← Overview</button><h2>${esc(g.title)} · ${esc(g.status)} · ${members.length} components</h2><div class="map">${map}</div><ul class="purposes">${members.map((n) => `<li><strong>${esc(n.title)}</strong> · ${esc(n.purpose)} · ${esc(n.status)}</li>`).join("")}</ul><ol class="connections">${[...edges, ...cross].map((e) => `<li data-from="${esc(e.from)}" data-to="${esc(e.to)}">${esc(e.from)} → ${esc(e.to)} · step ${e.step}${memberIds.has(e.to) ? "" : " · other group"}</li>`).join("")}</ol></section>`;
  }).join("\n");
  const chains = Object.fromEntries(c.components.filter((n) => n.type === "workflow").map((w) => {
    const steps = c.edges.filter((e) => e.from === w.id).sort((a, b) => a.step - b.step);
    return [w.id, steps.flatMap((e) => [e.to, ...c.edges.filter((child) => child.from === e.to).sort((a, b) => a.step - b.step).map((child) => child.to)])];
  }));
  const legend = `<aside class="composition-legend" aria-label="Map colour legend"><h2>Legend</h2><div><strong>Status</strong>${STATUSES.map((status) => `<span class="legend-item"><span class="swatch status-${status}" style="background:${STATUS_COLOURS[status]}"></span>${status}</span>`).join("")}</div><div><strong>Groups</strong>${c.groups.map((g, i) => `<span class="legend-item"><span class="swatch" style="background:${GROUP_COLOURS[i % GROUP_COLOURS.length]}"></span>${esc(g.title)}</span>`).join("")}</div></aside>`;
  const workflowButtons = c.components.filter((n) => n.type === "workflow").map((n) => `<button type="button" class="workflow" data-workflow="${esc(n.id)}" data-chain="${esc(chains[n.id].join(" "))}">${esc(n.title)}</button>`).join("");
  return `<!doctype html>\n<html lang="en" data-bowerbird-version="${version}" data-bowerbird-input-sha="${sha}">\n<head>\n<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="generator" content="bowerbird ${version}">\n<meta name="bowerbird-input-sha" content="${sha}">\n<title>${esc(title)}</title>\n<style>\n:root{color-scheme:light}body{margin:2rem auto;max-width:1500px;padding:0 2rem;background:#fff;color:#17212b;font:16px/1.5 system-ui,sans-serif}button{cursor:pointer;background:white;border:1px solid #bbb;border-radius:5px;padding:.6rem;margin:.3rem}button:focus-visible,.bb-node:focus-visible{outline:3px solid #3569a0}svg{display:block;max-width:100%;height:auto}.map{overflow:auto}.panel[hidden]{display:none}.is-dimmed{opacity:.12}.bb-node,.bb-edge{transition:opacity .2s}.connections{display:flex;gap:2rem;flex-wrap:wrap}.connections li{min-width:140px}.composition-legend{border:1px solid #68737d;border-radius:6px;padding:.5rem 1rem;margin:1rem 0}.composition-legend>div{display:flex;flex-wrap:wrap;gap:.8rem;align-items:center;margin:.5rem 0}.legend-item{display:inline-flex;align-items:center;gap:.4rem}.swatch{display:inline-block;width:1.2rem;height:1.2rem;border:2px solid #17212b;border-radius:2px}.swatch.status-planned{border-style:dashed}.swatch.status-partial{background-image:repeating-linear-gradient(45deg,transparent 0 4px,#17212b 4px 6px)!important}\n</style></head>\n<body><h1>${esc(title)}</h1><p>Choose a group to open its isometric map. Select a workflow to follow its playbooks and skills in step order.</p><nav aria-label="Workflows">${workflowButtons}</nav>${legend}<ol id="chain-order" aria-label="Workflow step order" hidden></ol><section id="overview"><h2>Overview</h2><p>Each group shows its component count and badges: B built, P partial, L planned.</p><div class="map">${overview}</div></section>${panels}\n<script>\nconst chains = ${safeJson(chains)};\nconst panels = document.querySelectorAll(".panel");\nfunction openGroup(id) {\n  document.getElementById("overview").hidden = true;\n  for (const panel of panels) { panel.hidden = panel.dataset.group !== id; if (panel.dataset.group === id) panel.hidden = false; }\n}\nfunction highlightWorkflow(id) {\n  const chain = [id, ...chains[id]];
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
