// Static, named sibling regions. This is signage, not a concurrency model.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const round = (n) => Math.round(n * 10) / 10;

function crossConditions(model, siblings) {
  const zones = new Map(model.nodes.map((n) => [n.id, n.zone]));
  const ids = new Set(siblings.map((z) => z.id));
  return model.edges.filter((e) => ids.has(zones.get(e.from)) && ids.has(zones.get(e.to)) && zones.get(e.from) !== zones.get(e.to))
    .map((e) => `${e.id ?? `${e.from} → ${e.to}`}: ${e.label ?? "condition not supplied"}`);
}

export const regions = {
  validate(input, fail) {
    const zones = input.zones ?? [];
    const children = new Map();
    for (const z of zones) {
      if (z.parallel === undefined) continue;
      if (z.parallel !== true) fail("region-parallel", `zone "${z.id}" parallel must be true`);
      if (!z.parent || !zones.some((p) => p.id === z.parent && p.parent === undefined)) {
        fail("region-parent", `region "${z.id}" needs a top-level parent zone`);
      }
      if (typeof z.title !== "string" || !z.title.trim()) fail("region-name", `region "${z.id}" needs a name`);
      if (!(input.nodes ?? []).some((n) => n.zone === z.id)) fail("region-empty", `region "${z.id}" needs a state to draw its boundary`);
    }
    for (const z of zones) {
      if (!z.parent) continue;
      if (!children.has(z.parent)) children.set(z.parent, []);
      children.get(z.parent).push(z);
    }
    for (const [parent, siblings] of children) {
      if (!siblings.some((z) => z.parallel !== undefined)) continue;
      if (siblings.length < 2 || siblings.some((z) => z.parallel !== true)) {
        fail("region-siblings", `parent "${parent}" needs at least two named parallel sibling regions and no unmarked children`);
      }
    }
  },
  layout(model, lay) {
    lay.regions = [];
    for (const group of lay.groups ?? []) {
      const siblings = model.zones.filter((z) => z.parent === group.id && z.parallel === true);
      if (!siblings.length) continue;
      const conditions = crossConditions(model, siblings);
      // Reserve a footer inside the T19 boundary, clear of the child zone rectangles.
      const extra = 32 + conditions.length * 22;
      group.rect.h += extra;
      lay.legend.top += extra;
      lay.legend.bottom += extra;
      lay.height += extra;
      lay.regions.push({ group, siblings, conditions });
    }
  },
  svg(model, lay) {
    return (lay.regions ?? []).map(({ group, siblings, conditions }) => {
      const { x, y, h } = group.rect;
      const start = y + h - 12 - conditions.length * 22;
      const lines = [`<text x="${round(x + 18)}" y="${round(start)}" fill="#82909a" font-size="13" font-weight="600">Parallel regions: ${esc(siblings.map((z) => z.title).join(" | "))}. No execution order implied.</text>`];
      conditions.forEach((condition, i) => lines.push(`<text x="${round(x + 18)}" y="${round(start + (i + 1) * 22)}" fill="#82909a" font-size="12">Cross-region condition: ${esc(condition)}</text>`));
      return `<g class="bb-parallel-regions" data-group="${esc(group.id)}" aria-label="Parallel regions; no execution order implied">${lines.join("")}</g>`;
    }).join("\n");
  },
  html(model, lay, { view }) {
    if (view !== "flat") return '<section aria-label="Parallel regions limitation"><p>Parallel region labels are available in the flat view only. No execution order is implied.</p></section>';
    return (lay.regions ?? []).map(({ group, siblings, conditions }) => `<section aria-label="Parallel regions in ${esc(group.title)}"><h2>${esc(group.title)}: parallel regions</h2><p>${siblings.map((z) => esc(z.title)).join(" | ")}. No execution order implied.</p>${conditions.length ? `<ul>${conditions.map((c) => `<li>Cross-region condition: ${esc(c)}</li>`).join("")}</ul>` : ""}</section>`).join("");
  },
};
