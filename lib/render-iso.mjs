// Isometric view: the flat plan layout (rects + A* routes) projected through a
// true isometric transform. Nodes become extruded slabs; status reads as
// construction: built = solid, partial = hatched roof, planned = wireframe.
import { esc, markerDefs, roundedPath, fontFaceCss, legend, background, header, styleOf } from "./render-svg.mjs";
import { categoryColor, mix } from "./themes.mjs";
import { structuralCss, styleCss, styleDefs, MOTION } from "./styles.mjs";
import { legendLayout, textWidth, TYPE } from "./layout.mjs";
import { PSEUDO } from "./model.mjs";

const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const SLAB = 38;
const MARGIN = 48;
// Header band height: restrained sets a taller, airier header.
const headerFor = (model) => (styleOf(model) === "expressive" ? 150 : 190);
const TILE = 44;
const r1 = (n) => Math.round(n * 10) / 10;
const STATUS_WORD = { implemented: "BUILT", partial: "PARTIAL", planned: "PLANNED" };

const proj = ([x, y], z = 0) => [(x - y) * COS, (x + y) * SIN - z];

export function isoLayout(model, lay) {
  const footprint = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  const raw = { zones: [], slabs: [], edges: [], labels: [] };
  for (const z of lay.zones) {
    // Floor tiles: plan-space grid lines inside the zone, projected like
    // everything else, so they read as an isometric floor.
    const { x, y, w, h } = z.rect;
    const grid = [];
    for (let gx = x + TILE; gx < x + w - 4; gx += TILE) grid.push([proj([gx, y]), proj([gx, y + h])]);
    for (let gy = y + TILE; gy < y + h - 4; gy += TILE) grid.push([proj([x, gy]), proj([x + w, gy])]);
    raw.zones.push({ z, ground: footprint(z.rect).map((p) => proj(p)), grid });
  }
  for (const n of model.nodes) {
    const r = lay.rects.get(n.id);
    const fp = footprint(r);
    raw.slabs.push({
      n,
      depth: r.x + r.w + r.y + r.h,
      ground: fp.map((p) => proj(p)),
      roof: fp.map((p) => proj(p, SLAB)),
      centre: proj([r.x + r.w / 2, r.y + r.h / 2], SLAB),
    });
  }
  raw.slabs.sort((a, b) => a.depth - b.depth);
  for (const e of model.edges) {
    raw.edges.push({ e, points: e._points.map((p) => proj(p, SLAB)) });
    if (e._label) raw.labels.push({ e, at: proj([e._label.cx, e._label.cy], SLAB), w: e._label.rect.w, h: e._label.rect.h });
  }
  // Translate so everything sits below the page header with a margin.
  const zoneLabelRoom = (g) => [[g[0][0] - 110, g[0][1] - 56], [g[0][0] + 110, g[0][1] - 56]];
  const pts = [...raw.zones.flatMap((z) => [...z.ground, ...zoneLabelRoom(z.ground)]), ...raw.slabs.flatMap((s) => [...s.ground, ...s.roof, [s.centre[0], s.centre[1] - 46]])];
  const minX = Math.min(...pts.map((p) => p[0])), minY = Math.min(...pts.map((p) => p[1]));
  const maxX = Math.max(...pts.map((p) => p[0])), maxY = Math.max(...pts.map((p) => p[1]));
  const HEADER = headerFor(model);
  const dx = MARGIN - minX, dy = HEADER - minY;
  const t = ([x, y]) => [x + dx, y + dy];
  for (const z of raw.zones) { z.ground = z.ground.map(t); z.grid = z.grid.map(([a, b]) => [t(a), t(b)]); }
  for (const s of raw.slabs) { s.ground = s.ground.map(t); s.roof = s.roof.map(t); s.centre = t(s.centre); }
  for (const e of raw.edges) e.points = e.points.map(t);
  for (const l of raw.labels) l.at = t(l.at);
  const warnings = [...lay.warnings, ...placeIsoLabels(model, raw)];
  const width = Math.ceil(maxX - minX + 2 * MARGIN);
  const legendLay = legendLayout(model, width, Math.ceil(maxY - minY + HEADER + MARGIN), "iso", MARGIN);
  return { ...raw, width, height: legendLay.bottom, legend: legendLay, warnings, view: "iso" };
}

// --- Screen-space label placement -------------------------------------------
// Plan-space label positions are not enough in iso: name tags and zone labels
// only exist after projection. Tags and zone labels are fixed; each edge label
// slides along its own projected route to the clearest spot.

const overlaps = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const KICKER = { size: 10, weight: 800, spacing: 1.1, upper: true };

const FINDING_WORD = { "dead-end": "DEAD END", unreachable: "UNREACHABLE", ambiguous: "AMBIGUOUS" };
const findingWord = (n) => (n._findings?.length ? [...new Set(n._findings.map((f) => FINDING_WORD[f.code] ?? f.code.toUpperCase()))].join(" · ") : "");

// Pseudo-states as flat discs at roof height: a plan circle of radius r
// projects to an axis-aligned ellipse with rx = r*sqrt2*cos30, ry = r*sqrt2*sin30.
function isoPseudo(n, s, traces) {
  const [cx, cy] = s.centre;
  const r = 13, rx = r * Math.SQRT2 * COS, ry = r * Math.SQRT2 * SIN;
  const ell = (cls, k) => `<ellipse class="${cls}" cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(rx * k)}" ry="${r1(ry * k)}"/>`;
  let glyph;
  if (n.shape === "initial") glyph = ell("bb-pseudo-fill", 0.75);
  else if (n.shape === "final") glyph = ell("bb-pseudo-ring", 1) + ell("bb-pseudo-fill", 0.55);
  else glyph = poly("bb-pseudo-ring bb-pseudo-choice", s.roof);
  return `<g class="bb-node bb-pseudo map-item" data-id="${esc(n.id)}"${traces}>${glyph}</g>`;
}

export function tagBox(s, tracking) {
  const n = s.n;
  const [cx, cy] = s.centre;
  const status = tracking ? STATUS_WORD[n.status ?? "planned"] : "";
  // Pseudo-states keep their disc visible: the name is a caption just below.
  if (PSEUDO.has(n.shape)) {
    const w = textWidth(n.title, TYPE.copy) + 12;
    return { x: cx - w / 2, y: cy + 12, w, h: 18 };
  }
  const finding = findingWord(n);
  const kicker = n.type ? `${n.type}${status ? ` · ${status}` : ""}${finding ? ` · ▲ ${finding}` : ""}` : "";
  const w = Math.max(textWidth(kicker, KICKER), textWidth(n.title, TYPE.title)) + 26;
  return kicker ? { x: cx - w / 2, y: cy - 26, w, h: 42 } : { x: cx - w / 2, y: cy - 13, w, h: 26 };
}

export function zoneLabelBox(zone) {
  const [tx, ty] = zone.ground[0];
  const z = zone.z;
  const w = Math.max(textWidth(z.kicker ?? "", { size: 10.5, weight: 800, spacing: 1.4, upper: true }), textWidth(z.title ?? z.id, { size: 19, weight: 600 })) + 12;
  return { x: tx - w / 2, y: ty - (z.kicker ? 46 : 32), w, h: z.kicker ? 40 : 26 };
}

function placeIsoLabels(model, iso) {
  const warnings = [];
  const tracking = model.meta.statusTracking;
  const fixed = [
    ...iso.slabs.filter((s) => s.n.title).map((s) => ({ box: tagBox(s, tracking), what: `tag "${s.n.title}"` })),
    ...iso.zones.map((z) => ({ box: zoneLabelBox(z), what: `zone "${z.z.title ?? z.z.id}"` })),
  ];
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      if (overlaps(fixed[i].box, fixed[j].box, 2)) warnings.push({ code: "iso-label-overlap", message: `${fixed[i].what} overlaps ${fixed[j].what} in iso view; add grid space` });
    }
  }
  const hulls = iso.slabs.map((s) => [s.roof[0], s.roof[1], s.ground[1], s.ground[2], s.ground[3], s.roof[3]]);
  const routes = new Map(iso.edges.map((r) => [r.e, r.points]));
  const placed = [];
  for (const label of iso.labels) {
    const pts = routes.get(label.e);
    const segs = [];
    for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1], Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])]);
    segs.sort((a, b) => b[2] - a[2]);
    let best = null;
    for (const [a, b] of segs) {
      for (const tt of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
        const at = [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt];
        const box = { x: at[0] - label.w / 2, y: at[1] - label.h / 2, w: label.w, h: label.h };
        let score = 0;
        for (const f of fixed) if (overlaps(box, f.box, 3)) score += 100;
        for (const p of placed) if (overlaps(box, p, 4)) score += 100;
        if (hulls.some((h) => pointInPoly(at, h))) score += 3;
        for (const [other, opts] of routes) {
          if (other === label.e) continue;
          for (let i = 0; i + 1 < opts.length; i++) {
            for (let k = 0; k <= 8; k++) {
              const q = [opts[i][0] + ((opts[i + 1][0] - opts[i][0]) * k) / 8, opts[i][1] + ((opts[i + 1][1] - opts[i][1]) * k) / 8];
              if (q[0] > box.x && q[0] < box.x + box.w && q[1] > box.y && q[1] < box.y + box.h) { score += 1; break; }
            }
          }
        }
        if (!best || score < best.score) best = { score, at, box };
        if (score === 0) break;
      }
      if (best?.score === 0) break;
    }
    label.at = best.at;
    label.box = best.box;
    placed.push(best.box);
    if (best.score >= 100) warnings.push({ code: "iso-label-overlap", message: `edge label "${label.e.label}" cannot clear tags or labels in iso view; shorten it or add grid space` });
  }
  return warnings;
}

function isoCss(theme, categories, scope = "") {
  const s = theme.surfaces;
  const p = (sel) => sel.split(",").map((x) => `${scope}${scope ? " " : ""}${x.trim()}`).join(",");
  const dark = theme.mode === "dark";
  const rules = [
    [".iso-edge-line", `stroke:${s.border}`],
    [".iso-tag-halo", `stroke:${s.canvas}`],
    [".iso-hatch line", `stroke:${s.text}`],
  ];
  for (const [id, cat] of Object.entries(categories)) {
    const c = categoryColor(theme, cat.color ?? id);
    rules.push(
      [`.cat-${id} .iso-roof`, `fill:${mix(s.panel, c, dark ? 0.32 : 0.22)};stroke:${mix(s.panel, c, 0.75)}`],
      [`.cat-${id} .iso-left`, `fill:${mix(s.canvas, c, dark ? 0.55 : 0.5)};stroke:${mix(s.panel, c, 0.75)}`],
      [`.cat-${id} .iso-right`, `fill:${mix(s.canvas, c, dark ? 0.36 : 0.32)};stroke:${mix(s.panel, c, 0.75)}`],
      [`.cat-${id}.status-planned .iso-face`, `stroke:${c}`],
    );
  }
  rules.push([".bb-node:not([class*=cat-]) .iso-roof", `fill:${s.raised};stroke:${s.border}`], [".bb-node:not([class*=cat-]) .iso-left,.bb-node:not([class*=cat-]) .iso-right", `fill:${s.panel};stroke:${s.border}`]);
  return rules.map(([sel, decl]) => `${p(sel)}{${decl}}`).join("\n");
}

const ISO_BASE = `
.iso-face{stroke-width:1.1;stroke-linejoin:round}
.iso-bevel{fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;opacity:.85}
.iso-bevel-soft{stroke-width:1;opacity:.35}
.bb-zone-floor-grid{fill:none;stroke-width:.8}
.bb-node.status-planned .iso-face{fill-opacity:.06;stroke-dasharray:5 4;stroke-width:1.3}
.iso-tag-halo{paint-order:stroke;stroke-width:5px;stroke-linejoin:round}
.iso-hatch line{stroke-width:1;opacity:.35}
.bb-node[tabindex]:hover .iso-roof,.bb-node[tabindex]:focus .iso-roof,.bb-node.is-selected .iso-roof{stroke-width:2.6}
`;

const poly = (cls, pts, extra = "") => `<polygon class="${cls}" points="${pts.map((p) => `${r1(p[0])},${r1(p[1])}`).join(" ")}"${extra}/>`;

function hatch(id, roof) {
  // Diagonal hatch clipped to the roof: "under construction".
  const xs = roof.map((p) => p[0]), ys = roof.map((p) => p[1]);
  const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const lines = [];
  for (let x = x1 - (y2 - y1); x < x2; x += 9) lines.push(`<line x1="${r1(x)}" y1="${r1(y2)}" x2="${r1(x + (y2 - y1))}" y2="${r1(y1)}"/>`);
  return `<clipPath id="clip-${id}">${poly("", roof)}</clipPath><g class="iso-hatch" clip-path="url(#clip-${id})">${lines.join("")}</g>`;
}

function isoBody(model, iso, { animate, interactive, style }) {
  const st = styleOf(model, style);
  const expressive = st === "expressive";
  const out = [];
  const tracking = model.meta.statusTracking;
  const planned = new Set(model.nodes.filter((n) => tracking && (n.status ?? "planned") === "planned").map((n) => n.id));
  const traceAttr = (t) => (t?.length ? ` data-traces="${esc(t.join(" "))}"` : "");
  out.push(background(iso.width, iso.height, st));
  out.push(header(model, iso.width, MARGIN, st));
  // Zone floors: expressive tiles them; restrained leaves a plain plate.
  for (const { z, ground, grid } of iso.zones) {
    const cat = z.category ? ` cat-${z.category}` : "";
    out.push(`<g class="bb-zone-group${cat}">${poly(`bb-zone${cat}`, ground)}`);
    if (expressive) out.push(`<path class="bb-zone-floor-grid" d="${grid.map(([a, b]) => `M ${r1(a[0])} ${r1(a[1])} L ${r1(b[0])} ${r1(b[1])}`).join(" ")}"/>`);
    out.push(`</g>`);
  }
  // Cast shadows first. Expressive blurs them; restrained keeps a crisp paper-cut offset.
  for (const s of iso.slabs) {
    if (PSEUDO.has(s.n.shape)) continue;
    if (tracking && (s.n.status ?? "planned") === "planned") continue;
    const [ox, oy] = expressive ? [16, 10] : [12, 7];
    out.push(poly("iso-shadow", s.ground.map(([x, y]) => [x + ox, y + oy])));
  }
  for (const s of iso.slabs) {
    const n = s.n;
    if (PSEUDO.has(n.shape)) { out.push(isoPseudo(n, s, traceAttr(n.traces))); continue; }
    const status = tracking ? n.status ?? "planned" : null;
    const cls = ["bb-node", "map-item", n.category && `cat-${n.category}`, status && `status-${status}`].filter(Boolean).join(" ");
    const a11y = interactive ? ` tabindex="0" role="button" aria-label="Open details for ${esc(n.title)}"` : "";
    // Visible faces for this projection: south (left on screen) and east (right).
    const [, g1, g2, g3] = s.ground;
    const [ro0, ro1, ro2, ro3] = s.roof;
    out.push(`<g class="${cls}" data-id="${esc(n.id)}"${traceAttr(n.traces)}${a11y}>`);
    // Focus ring that traces the slab's silhouette (an outline on <g> is its bounding box).
    if (interactive) out.push(poly("iso-focus", [ro3, ro0, ro1, g1, g2, g3], ` fill="none" stroke="none"`));
    out.push(poly("iso-face iso-left", [ro3, ro2, g2, g3]));
    out.push(poly("iso-face iso-right", [ro1, ro2, g2, g1]));
    out.push(poly("iso-face iso-roof", s.roof));
    if (status === "partial") out.push(hatch(n.id.replace(/[^a-z0-9_-]/gi, "_"), s.roof));
    if (expressive && status !== "planned") {
      // Bevel: light catches the back roof edges and the front corner.
      out.push(`<path class="iso-bevel" d="M ${r1(ro3[0])} ${r1(ro3[1])} L ${r1(ro0[0])} ${r1(ro0[1])} L ${r1(ro1[0])} ${r1(ro1[1])}"/>`);
      out.push(`<path class="iso-bevel iso-bevel-soft" d="M ${r1(ro3[0])} ${r1(ro3[1])} L ${r1(ro2[0])} ${r1(ro2[1])} L ${r1(ro1[0])} ${r1(ro1[1])} M ${r1(ro2[0])} ${r1(ro2[1])} L ${r1(g2[0])} ${r1(g2[1])}"/>`);
    }
    out.push(`</g>`);
  }
  out.push(`<g class="bb-edges">`);
  for (const { e, points } of iso.edges) {
    const d = roundedPath(points, expressive ? 8 : 5);
    const isPlanned = planned.has(e.from) || planned.has(e.to);
    if (expressive) out.push(`<path class="bb-edge-glow bb-edge ${e.kind}${isPlanned ? " is-planned" : ""} map-item" d="${d}"${traceAttr(e.traces)} style="stroke-dasharray:none"/>`);
    out.push(`<path class="bb-edge ${e.kind}${isPlanned ? " is-planned" : ""} map-item" d="${d}" marker-end="url(#bb-arrow-${e.kind})"${traceAttr(e.traces)}/>`);
    if (animate && !isPlanned && e.kind !== "failure") out.push(`<path class="bb-flow map-item" d="${d}"${traceAttr(e.traces)}/>`);
  }
  for (const { e, at, w, h } of iso.labels) {
    // Over coloured roofs a knockout reads as a blob; iso labels get the same
    // flat placard as the name tags instead.
    const bg = expressive
      ? `<rect class="bb-label-bg" x="${r1(at[0] - w / 2)}" y="${r1(at[1] - h / 2)}" width="${r1(w)}" height="${h}" rx="${h / 2}"/>`
      : `<rect class="iso-label-bg" x="${r1(at[0] - w / 2 + 2)}" y="${r1(at[1] - h / 2 + 1)}" width="${r1(w - 4)}" height="${h - 2}" rx="3"/>`;
    out.push(`<g class="bb-edge-label map-item"${traceAttr(e.traces)}>${bg}<text class="bb-label ${e.kind}${expressive ? "" : " plain"}" x="${r1(at[0])}" y="${r1(at[1] + 3.6)}" text-anchor="middle">${esc(e.label)}</text></g>`);
  }
  out.push(`</g>`);
  // Upright name tags float above each roof; drawn last so nothing covers them.
  for (const s of iso.slabs) {
    const n = s.n;
    if (!n.title) continue;
    const [cx, cy] = s.centre;
    const cat = n.category ? ` cat-${n.category}` : "";
    const status = tracking ? n.status ?? "planned" : null;
    // A floating label reads cleanly on any roof colour (a text halo did not).
    // Expressive: a rimmed pill. Restrained: a flat placard with one category dot.
    const b = tagBox(s, tracking);
    if (PSEUDO.has(n.shape)) {
      out.push(`<g class="iso-tag map-item" data-for="${esc(n.id)}"${traceAttr(n.traces)} pointer-events="none"><text class="bb-copy iso-label-knockout" x="${r1(cx)}" y="${r1(b.y + 13)}" text-anchor="middle">${esc(n.title)}</text></g>`);
      continue;
    }
    const kicker = n.type ? `${n.type.toUpperCase()}${status ? ` · ${STATUS_WORD[status]}` : ""}` : "";
    const finding = findingWord(n);
    out.push(`<g class="iso-tag map-item${cat}" data-for="${esc(n.id)}"${traceAttr(n.traces)} pointer-events="none">`);
    out.push(`<rect class="iso-tag-bg" x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="${expressive ? (n.type ? 10 : b.h / 2) : 3}"/>`);
    const fullKicker = kicker + (finding ? ` · ▲ ${finding}` : "");
    if (!expressive && n.category && kicker) out.push(`<circle class="bb-mark" cx="${r1(cx - textWidth(fullKicker, KICKER) / 2 - 8)}" cy="${r1(cy - 13.5)}" r="3"/>`);
    // Statechart findings ride on the tag in the failure colour, as on flat cards.
    if (n.type) out.push(`<text class="bb-kicker" x="${r1(cx)}" y="${r1(cy - 10)}" text-anchor="middle">${esc(kicker)}${finding ? `<tspan class="bb-finding-inline"> · ▲ ${esc(finding)}</tspan>` : ""}</text>`);
    out.push(`<text class="bb-node-title" x="${r1(cx)}" y="${r1(n.type ? cy + 9 : cy + 5)}" text-anchor="middle">${esc(n.title)}</text>`);
    out.push(`</g>`);
  }
  // Zone labels sit above each zone's top corner: that point is the back of
  // the zone, so no slab of its own can cover it. Drawn last, with a halo.
  for (const { z, ground } of iso.zones) {
    const cat = z.category ? ` cat-${z.category}` : "";
    const [tx, ty] = ground[0];
    const halo = expressive ? "iso-tag-halo" : "iso-label-knockout";
    out.push(`<g class="bb-zone-group${cat}">`);
    if (z.kicker) out.push(`<text class="bb-zone-kicker ${halo}" x="${r1(tx)}" y="${r1(ty - 34)}" text-anchor="middle">${esc(z.kicker.toUpperCase())}</text>`);
    out.push(`<text class="bb-zone-title ${halo}" x="${r1(tx)}" y="${r1(ty - 12)}" text-anchor="middle">${esc(z.title ?? z.id)}</text></g>`);
  }
  out.push(legend(iso.legend, iso.width, st));
  return out.join("\n");
}

export function renderIsoSvg(model, iso, { theme, darkTheme, themes, categoryTheme = darkTheme ?? themes?.dark, categoryFillParity = model.meta.categoryFillParity, animate = false, interactive = false, font, style } = {}) {
  const st = styleOf(model, style);
  const expressive = st === "expressive";
  const cats = model.categories;
  let css = fontFaceCss(font) + structuralCss(st) + (expressive ? ISO_BASE : "");
  // Expressive order matters: isoCss flat fills first, then paint gradients over them.
  const all = (th, scope = "", parity = categoryFillParity) => (expressive ? isoCss(th, cats, scope) : "") + styleCss(th, cats, { style: st, scope, iso: true, categoryTheme: parity === "dark" && th.mode === "light" ? categoryTheme : undefined });
  const used = themes ? Object.values(themes) : [theme, darkTheme].filter(Boolean);
  if (themes) {
    for (const [name, th] of Object.entries(themes)) {
      if (name === "light" && !expressive) {
        css += all(th, `html[data-theme=light][data-category-fill-parity=mode]`, "mode");
        css += all(th, `html[data-theme=light][data-category-fill-parity=dark]`, "dark");
      } else css += all(th, `html[data-theme=${name}]`);
    }
  } else {
    css += all(theme);
    if (darkTheme) css += `\n@media (prefers-color-scheme:dark){\n${all(darkTheme)}\n}`;
  }
  if (animate) css += MOTION[st];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${iso.width} ${iso.height}" width="${iso.width}" height="${iso.height}" role="${interactive ? "group" : "img"}" aria-labelledby="bb-t">
<title id="bb-t">${esc(model.meta.title)}</title>
<style>${css}</style>
${markerDefs(st)}${used.map((th) => styleDefs(th, cats, { style: st, iso: true })).join("")}
${isoBody(model, iso, { animate, interactive, style: st })}
</svg>
`;
}
