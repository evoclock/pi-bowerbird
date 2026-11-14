// Composition projects authored diagrams into ordinary bowerbird/v1 renders.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalise } from "./model.mjs";
import { build } from "./export.mjs";

const TYPES = ["skill", "recipe", "playbook", "workflow"];
const STATUSES = ["built", "partial", "planned"];
const own = (v) => v && typeof v === "object" && !Array.isArray(v);
const nodeStatus = (status) => status === "built" ? "implemented" : status;

export function validateComposition(c, fail, source) {
  if (!own(c) || !Array.isArray(c.groups) || !Array.isArray(c.components) || !Array.isArray(c.edges)) {
    fail("composition-shape", "composition needs groups, components and edges arrays");
    return;
  }
  const ids = new Set(), groups = new Set();
  for (const [kind, entries] of [["group", c.groups], ["component", c.components]]) {
    for (const item of entries) {
      if (!own(item) || typeof item.id !== "string" || !item.id || ids.has(item.id)) {
        fail("composition-id", `${kind} needs a unique, nonempty id`); continue;
      }
      ids.add(item.id);
      if (kind === "group") groups.add(item.id);
      if (typeof item.title !== "string" || !item.title) fail("composition-title", `${kind} "${item.id}" needs a title`);
      if (!STATUSES.includes(item.status)) fail("composition-status", `${kind} "${item.id}" status must be built, partial or planned`);
      if (item.category !== undefined && !source?.categories?.[item.category]) fail("composition-category", `${kind} "${item.id}" category must name an authored category`);
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

// Links are ordinary detail Markdown, handled by render-html's hrefRewriter.
export function projectComposition(source, overviewHref, groupHref) {
  normalise(source);
  if (!source.composition) throw new Error("composition: input needs a composition object");
  const { groups, components, edges } = source.composition;
  const authored = new Map(source.nodes.map((node) => [node.id, node]));
  const groupFor = new Map(components.map((item) => [item.id, item.group]));
  const zoneFor = new Map(source.zones.map((zone) => [zone.id, zone]));
  for (const group of groups) {
    if (!zoneFor.has(group.id)) throw new Error(`composition: group "${group.id}" needs an authored zone`);
    if (!components.some((item) => item.group === group.id)) throw new Error(`composition: group "${group.id}" needs an authored node for placement`);
  }
  for (const item of components) {
    const node = authored.get(item.id);
    if (!node || node.zone !== item.group || !node.category) throw new Error(`composition: component "${item.id}" needs an authored node, zone and category`);
    if (item.category && item.category !== node.category) throw new Error(`composition: category for "${item.id}" differs from the authored node`);
    if (node.status !== nodeStatus(item.status)) throw new Error(`composition: status for "${item.id}" differs from the authored node`);
  }
  const base = { schema: source.schema, categories: source.categories, traces: source.traces ?? [] };
  const meta = { ...source.meta, lightFlatFill: "filled" };
  delete meta.view; // Composition provides both ordinary views regardless of input preference.
  const overviewNodes = groups.map((group) => {
    const members = components.filter((item) => item.group === group.id);
    const zone = zoneFor.get(group.id);
    const category = group.category ?? zone.category;
    if (!category || !source.categories?.[category]) throw new Error(`composition: group "${group.id}" needs an authored category`);
    return { id: group.id, title: group.title, at: [...authored.get(members[0].id).at],
      category, status: nodeStatus(group.status), type: zone.title,
      traces: [...new Set(members.flatMap((item) => authored.get(item.id).traces ?? []))],
      details: `[Open ${group.title}](${groupHref(group)})` };
  });
  const overviewEdges = [...new Set(edges.filter((edge) => groupFor.get(edge.from) !== groupFor.get(edge.to))
    .map((edge) => `${groupFor.get(edge.from)}:${groupFor.get(edge.to)}`))]
    .map((pair) => { const [from, to] = pair.split(":"); return { from, to }; });
  const overview = { ...base, meta: { ...meta }, nodes: overviewNodes, edges: overviewEdges };
  const pages = groups.map((group) => {
    const members = components.filter((item) => item.group === group.id);
    const memberIds = new Set(members.map((item) => item.id));
    const nodes = members.map((item) => {
      const node = authored.get(item.id);
      const cross = [...new Set(edges.filter((edge) => edge.from === item.id && !memberIds.has(edge.to))
        .map((edge) => groupFor.get(edge.to)))].map((id) => groups.find((candidate) => candidate.id === id));
      const links = [`[Back to overview](${overviewHref})`, ...cross.map((next) => `[Open ${next.title}](${groupHref(next)})`)];
      return { ...node, details: [node.details ?? item.purpose, links.join(" · ")].join("\n\n") };
    });
    const pageEdges = (source.edges ?? []).filter((edge) => memberIds.has(edge.from) && memberIds.has(edge.to));
    for (const edge of edges.filter((entry) => memberIds.has(entry.from) && memberIds.has(entry.to))) {
      if (!pageEdges.some((entry) => entry.from === edge.from && entry.to === edge.to)) pageEdges.push({ from: edge.from, to: edge.to });
    }
    return { id: group.id, model: { ...base, meta: { ...meta, title: group.title },
      zones: [zoneFor.get(group.id)], nodes, edges: pageEdges } };
  });
  normalise(overview);
  for (const page of pages) normalise(page.model);
  return { overview, groups: pages };
}

// Keep each viewer intact; the host swaps complete package-rendered group pages.
function standalonePage(overview, groups, view) {
  const destinations = new Map([["overview.flat.html", "overview"], ["overview.iso.html", "overview"],
    ...groups.flatMap(({ id }) => [[`group-${id}.flat.html`, id], [`group-${id}.iso.html`, id]])]);
  const localLinks = (html) => html.replace(/href="([^"]+)"/g, (match, href) => {
    const id = destinations.get(href);
    return id === undefined ? match : `href="#${encodeURIComponent(id)}" data-composition-target="${encodeURIComponent(id)}"`;
  });
  const groupPages = Object.fromEntries(groups.map(({ id, html }) => [id, localLinks(html).replace("</body>", `<script>(() => {
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[data-composition-target]");
      if (!link) return;
      event.preventDefault();
      parent.postMessage({ type: "composition-target", id: decodeURIComponent(link.dataset.compositionTarget) }, "*");
    });
  })();</script>\n</body>`)]));
  const payload = JSON.stringify(groupPages).replace(/</g, "\\u003c");
  const controls = `<div class="page" id="composition-nav" hidden><div class="toolbar"><div class="group"><button id="composition-back" type="button">Back to overview</button></div></div></div>
<iframe class="page stage" id="composition-frame" title="Group diagram" hidden></iframe>`;
  const script = `<script type="application/json" id="composition-pages">${payload}</script>
<script>(() => {
  const pages = JSON.parse(document.getElementById("composition-pages").textContent);
  const overview = document.querySelector(".page");
  const nav = document.getElementById("composition-nav");
  const frame = document.getElementById("composition-frame");
  function show(id) {
    if (!Object.hasOwn(pages, id)) return;
    overview.hidden = true; nav.hidden = false; frame.hidden = false;
    frame.srcdoc = pages[id];
  }
  document.getElementById("composition-back").onclick = () => {
    frame.hidden = true; frame.srcdoc = ""; nav.hidden = true; overview.hidden = false;
  };
  const stage = document.getElementById("stage");
  stage.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const node = event.target.closest(".bb-node[data-id]");
    if (!node || !Object.hasOwn(pages, node.dataset.id)) return;
    event.preventDefault(); event.stopPropagation(); show(node.dataset.id);
  }, true);
  stage.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const node = event.target.closest(".bb-node[data-id]");
    if (!node || !Object.hasOwn(pages, node.dataset.id)) return;
    event.preventDefault(); event.stopPropagation(); show(node.dataset.id);
  }, true);
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-composition-target]");
    if (!link) return;
    event.preventDefault(); show(decodeURIComponent(link.dataset.compositionTarget));
  }, true);
  addEventListener("message", (event) => {
    if (event.source === frame.contentWindow && event.data?.type === "composition-target") {
      if (event.data.id === "overview") document.getElementById("composition-back").click();
      else show(event.data.id);
    }
  });
})();</script>`;
  return localLinks(overview).replace("</body>", `${controls}\n${script}\n</body>`);
}

export async function writeComposition(file, out, inputSha) {
  const source = JSON.parse(readFileSync(file, "utf8"));
  const sha = inputSha ?? execFileSync("git", ["-C", path.dirname(path.resolve(file)), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("composition: input SHA must be a full 40-character lowercase hex commit");
  // An input in a temporary worktree still links to the durable checkout.
  normalise(source);
  let repoRoot;
  try {
    const common = execFileSync("git", ["-C", path.dirname(path.resolve(file)), "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
    repoRoot = path.basename(common) === ".git" ? path.dirname(common) : process.cwd();
  } catch {
    repoRoot = process.cwd(); // External input: retain the ordinary render default.
  }
  const dir = path.resolve(out);
  const suffix = ".iso.html";
  const overviewName = `overview${suffix}`;
  const groupName = (group) => `group-${group.id}${suffix}`;
  const link = (name) => path.relative(repoRoot, path.join(dir, name)).split(path.sep).join("/");
  const { overview, groups } = projectComposition(source, link(overviewName), (group) => link(groupName(group)));
  mkdirSync(dir, { recursive: true });
  const pages = [{ name: "overview", model: overview }, ...groups.map(({ id, model }) => ({ name: `group-${id}`, model }))];
  for (const { name, model } of pages) {
    const input = path.join(dir, `${name}.bower.json`);
    writeFileSync(input, JSON.stringify({ ...model, meta: { ...model.meta, inputSha: sha } }, null, 2) + "\n");
    await build(input, { outDir: dir, formats: ["html", "svg"], repoRoot, defaultTheme: "light" });
  }
  for (const view of ["flat", "iso"]) {
    const pages = groups.map(({ id }) => ({ id, html: readFileSync(path.join(dir, `group-${id}.${view}.html`), "utf8") }));
    const overviewHtml = readFileSync(path.join(dir, `overview.${view}.html`), "utf8");
    writeFileSync(path.join(dir, `composition.${view}.html`), standalonePage(overviewHtml, pages, view));
  }
  return path.join(dir, overviewName);
}
