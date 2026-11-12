// One static parent boundary for existing zones. No second grouping namespace.
// The model/layout/SVG hooks keep ungrouped diagrams byte-identical.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const round = (n) => Math.round(n * 10) / 10;

export const groups = {
  validate(input, fail) {
    const zones = input.zones ?? [];
    const byId = new Map(zones.map((z) => [z.id, z]));
    const parents = new Set(zones.filter((z) => z.parent !== undefined).map((z) => z.parent));
    for (const z of zones) {
      if (z.parent === undefined) continue;
      if (typeof z.parent !== "string" || !z.parent.trim() || !byId.has(z.parent)) {
        fail("group-parent", `zone "${z.id}" references unknown parent zone "${z.parent}"`);
      } else if (z.parent === z.id || byId.get(z.parent).parent !== undefined) {
        fail("group-depth", `zone "${z.id}" exceeds one level of parent zones`);
      }
    }
    for (const id of parents) {
      if ((input.nodes ?? []).some((n) => n.zone === id)) fail("group-members", `parent zone "${id}" must contain child zones, not nodes directly`);
    }
  },
  layout(model, lay) {
    const children = new Map();
    for (const z of lay.zones) {
      if (!z.parent) continue;
      if (!children.has(z.parent)) children.set(z.parent, []);
      children.get(z.parent).push(z.rect);
    }
    lay.groups = [];
    for (const parent of model.zones) {
      const rects = children.get(parent.id);
      if (!rects?.length) continue;
      const x = Math.min(...rects.map((r) => r.x)) - 20;
      const y = Math.min(...rects.map((r) => r.y)) - 52;
      const right = Math.max(...rects.map((r) => r.x + r.w)) + 20;
      const bottom = Math.max(...rects.map((r) => r.y + r.h)) + 20;
      const title = parent.title ?? parent.id;
      lay.groups.push({ id: parent.id, title, rect: { x, y, w: right - x, h: bottom - y } });
      lay.width = Math.max(lay.width, Math.ceil(right + 40));
      const extra = Math.max(0, Math.ceil(bottom + 40 - lay.legend.top));
      lay.legend.top += extra;
      lay.legend.bottom += extra;
      lay.height += extra;
    }
  },
  svg(model, lay) {
    if (!lay.groups?.length) return "";
    // Stroke and title only: edges and child zones remain visible and retain IDs.
    return lay.groups.map(({ id, title, rect: { x, y, w, h } }) =>
      `<g class="bb-parent-group" data-group="${esc(id)}" aria-label="Group: ${esc(title)}"><rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="9" fill="none" stroke="#82909a" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.55"/><text x="${round(x + 18)}" y="${round(y + 30)}" fill="#82909a" font-size="17" font-weight="600">${esc(title)}</text></g>`
    ).join("\n");
  },
};
