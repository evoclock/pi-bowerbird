import { TYPE, CARD } from "./layout.mjs";
import { statusSummary } from "./model.mjs";
import { structuralCss, styleCss, styleDefs, MOTION, DEFAULT_STYLE } from "./styles.mjs";
import { themeCss } from "./themes.mjs";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const r1 = (n) => Math.round(n * 10) / 10;

// Geist Sans throughout. GitHub's <img> sandbox blocks external fonts, so a
// README SVG shows Geist only when the font is embedded (see fontFaceCss).
export const FONT = `Geist,"Geist Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif`;

const FONT_MIME = { ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf" };

export function fontFaceCss(font) {
  if (!font) return "";
  const mime = FONT_MIME[font.ext] ?? "font/woff2";
  return `@font-face{font-family:Geist;font-weight:100 900;font-style:normal;src:url(data:${mime};base64,${font.data.toString("base64")})}\n`;
}

// Back-compat exports for callers that predate styles.
export const BASE_CSS = structuralCss("expressive");
export const MOTION_CSS = MOTION.expressive;
export function dotCss() { return ""; }

export function roundedPath(points, radius = 10) {
  if (points.length < 2) return "";
  let d = `M ${r1(points[0][0])} ${r1(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [p, c, n] = [points[i - 1], points[i], points[i + 1]];
    const lin = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const lout = Math.hypot(n[0] - c[0], n[1] - c[1]);
    const r = Math.min(radius, lin / 2, lout / 2);
    const a = [c[0] - ((c[0] - p[0]) / lin) * r, c[1] - ((c[1] - p[1]) / lin) * r];
    const b = [c[0] + ((n[0] - c[0]) / lout) * r, c[1] + ((n[1] - c[1]) / lout) * r];
    d += ` L ${r1(a[0])} ${r1(a[1])} Q ${r1(c[0])} ${r1(c[1])} ${r1(b[0])} ${r1(b[1])}`;
  }
  const last = points.at(-1);
  return d + ` L ${r1(last[0])} ${r1(last[1])}`;
}

export const STATUS_WORD = { implemented: "BUILT", partial: "PARTIAL", planned: "PLANNED" };

function statusDot(cx, cy, status, r = 4.2) {
  if (status === "implemented") return `<circle class="bb-dot bb-dot-fill" cx="${r1(cx)}" cy="${r1(cy)}" r="${r}"/>`;
  if (status === "partial") {
    return `<circle class="bb-dot" cx="${r1(cx)}" cy="${r1(cy)}" r="${r}"/><path class="bb-dot-fill" d="M ${r1(cx)} ${r1(cy - r)} A ${r} ${r} 0 0 0 ${r1(cx)} ${r1(cy + r)} Z"/>`;
  }
  return `<circle class="bb-dot" cx="${r1(cx)}" cy="${r1(cy)}" r="${r}"${r > 3.5 ? ` stroke-dasharray="2 1.6"` : ""}/>`;
}

// Tracked-caps width at 9px/600/1.8px spacing (restrained status text).
const capsW = (s, size = 9.5, spacing = 1.9) => s.length * (size * 0.68 + spacing) - spacing;

// Status: expressive uses pills; restrained uses quiet signage, a dot and tracked caps.
function statusMark(x, y, status, style) {
  const word = STATUS_WORD[status];
  if (style === "expressive") {
    const w = word.length * 6.6 + 26;
    const dash = status === "planned" ? ` stroke-dasharray="3 2.4"` : "";
    return `<g class="bb-status is-${status}" aria-label="status: ${status}"><rect class="bb-badge is-${status}" x="${r1(x - w)}" y="${r1(y)}" width="${r1(w)}" height="18" rx="9"${dash}/>${statusDot(x - w + 11, y + 9, status)}<text class="bb-badge-text" x="${r1(x - w + 19.5)}" y="${r1(y + 12.6)}">${word}</text></g>`;
  }
  const tw = capsW(word);
  return `<g class="bb-status is-${status}" aria-label="status: ${status}">${statusDot(x - tw - 9, y + 10.6, status, 3.4)}<text class="bb-status-text" x="${r1(x)}" y="${r1(y + 14)}" text-anchor="end">${word}</text></g>`;
}

function meter(model, right, top, style) {
  const c = statusSummary(model);
  const total = c.implemented + c.partial + c.planned || 1;
  const pct = Math.round((100 * c.implemented) / total);
  if (style === "expressive") {
    const W = 260, H = 9, x0 = right - W;
    const segs = [];
    let x = x0;
    for (const [key, cls] of [["implemented", "bb-meter-solid"], ["partial", "bb-meter-hatch"]]) {
      const w = (W * c[key]) / total;
      if (w > 0) segs.push(`<rect class="${cls}" x="${r1(x)}" y="${r1(top + 50)}" width="${r1(w)}" height="${H}"/>`);
      x += w;
    }
    return `<g class="bb-meter" aria-label="${pct}% built">` +
      `<text class="bb-meter-big" x="${right}" y="${top + 32}" text-anchor="end">${pct}%</text>` +
      `<text class="bb-summary bb-subtitle" x="${right - `${pct}%`.length * 20.4 - 12}" y="${top + 31}" text-anchor="end">BUILT</text>` +
      `<clipPath id="bb-meter-clip"><rect x="${x0}" y="${top + 50}" width="${W}" height="${H}" rx="${H / 2}"/></clipPath>` +
      `<rect class="bb-meter-track" x="${x0}" y="${top + 50}" width="${W}" height="${H}" rx="${H / 2}"/>` +
      `<g clip-path="url(#bb-meter-clip)">${segs.join("")}</g>` +
      `<text class="bb-summary bb-subtitle" x="${right}" y="${top + 76}" text-anchor="end">${c.implemented} BUILT · ${c.partial} PARTIAL · ${c.planned} PLANNED</text></g>`;
  }
  // Restrained: a large light numeral, a hairline track, plain counts.
  const W = 220, x0 = right - W, ty = top + 58;
  const wb = (W * c.implemented) / total, wp = (W * c.partial) / total;
  return `<g class="bb-meter" aria-label="${pct}% built">` +
    `<text class="bb-kicker-top" x="${right}" y="${top}" text-anchor="end">COMPLETION</text>` +
    `<text x="${right}" y="${top + 44}" text-anchor="end"><tspan class="bb-meter-big">${pct}</tspan><tspan class="bb-meter-unit" dx="3">%</tspan></text>` +
    `<path class="bb-meter-track" d="M ${x0} ${ty} H ${right}"/>` +
    (wb > 0 ? `<path class="bb-meter-solid" d="M ${x0} ${ty} H ${r1(x0 + wb)}"/>` : "") +
    (wp > 0 ? `<path class="bb-meter-part" d="M ${r1(x0 + wb)} ${ty} H ${r1(x0 + wb + wp)}"/>` : "") +
    `<text class="bb-meta" x="${right}" y="${ty + 22}" text-anchor="end">${c.implemented} built · ${c.partial} partial · ${c.planned} planned</text></g>`;
}

// Statechart check findings drawn on the state itself, so a broken flow is
// visible in the README image, not only in terminal output.
const FINDING_WORD = { "dead-end": "DEAD END", unreachable: "UNREACHABLE", ambiguous: "AMBIGUOUS" };
function findingMark(x, y, findings, style) {
  const word = [...new Set(findings.map((f) => FINDING_WORD[f.code] ?? f.code.toUpperCase()))].join(" · ");
  const title = `<title>${esc(findings.map((f) => f.message).join("\n"))}</title>`;
  if (style === "expressive") {
    const w = word.length * 7.4 + 30;
    return `<g class="bb-finding">${title}<rect class="bb-finding-bg" x="${r1(x - w)}" y="${r1(y)}" width="${r1(w)}" height="17" rx="3"/><text class="bb-finding-text" x="${r1(x - w + 9)}" y="${r1(y + 12)}">⚠ ${esc(word)}</text></g>`;
  }
  return `<g class="bb-finding">${title}<text class="bb-finding-text" x="${r1(x)}" y="${r1(y + 12)}" text-anchor="end">▲ ${esc(word)}</text></g>`;
}

const plannedIds = (model) => new Set(model.nodes.filter((n) => n.status === "planned").map((n) => n.id));

export function nodeHref(model, node) {
  if (node.href) return node.href;
  const repo = model.meta.repository;
  const p = node.evidence?.paths?.[0];
  if (!repo?.url || !p) return null;
  return `${repo.url.replace(/\/$/, "")}/blob/${repo.ref ?? "main"}/${p.replace(/^\.?\//, "")}`;
}

export const styleOf = (model, style) => style ?? model.meta.style ?? DEFAULT_STYLE;

export function svgBody(model, lay, { animate = false, interactive = false, links = true, style } = {}) {
  const st = styleOf(model, style);
  const out = [];
  const tracking = model.meta.statusTracking;
  const planned = plannedIds(model);
  const traceAttr = (t) => (t?.length ? ` data-traces="${esc(t.join(" "))}"` : "");

  out.push(background(lay.width, lay.height, st));
  out.push(header(model, lay.width, 40, st));

  for (const z of lay.zones) {
    const { x, y, w, h } = z.rect;
    const cat = z.category ? ` cat-${z.category}` : "";
    out.push(`<g class="bb-zone-group${cat}">`);
    if (st === "expressive") {
      out.push(`<rect class="bb-zone${cat}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="14"/>`);
      out.push(`<path class="bb-zone-accent" d="M ${r1(x + 18)} ${r1(y + 1.2)} H ${r1(x + w - 18)}"/>`);
      let ty = y + 26;
      if (z.kicker) { out.push(`<text class="bb-zone-kicker" x="${r1(x + 20)}" y="${r1(ty)}">${esc(z.kicker.toUpperCase())}</text>`); ty += 22; }
      out.push(`<text class="bb-zone-title" x="${r1(x + 20)}" y="${r1(ty)}">${esc(z.title ?? z.id)}</text>`);
    } else {
      out.push(`<rect class="bb-zone${cat}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="6"/>`);
      let ty = y + 28;
      if (z.kicker) { out.push(`<text class="bb-zone-kicker" x="${r1(x + 22)}" y="${r1(ty)}">${esc(z.kicker.toUpperCase())}</text>`); ty += 24; }
      if (z.category) out.push(`<circle class="bb-mark" cx="${r1(x + 27)}" cy="${r1(ty - 6.5)}" r="5"/>`);
      out.push(`<text class="bb-zone-title" x="${r1(x + (z.category ? 40 : 22))}" y="${r1(ty)}">${esc(z.title ?? z.id)}</text>`);
    }
    out.push(`</g>`);
  }

  out.push(`<g class="bb-edges">`);
  for (const e of model.edges) {
    const d = roundedPath(e._points, st === "expressive" ? 10 : 6);
    const isPlanned = planned.has(e.from) || planned.has(e.to);
    const cls = `bb-edge ${e.kind}${isPlanned ? " is-planned" : ""} map-item`;
    if (st === "expressive") out.push(`<path class="bb-edge-glow ${cls}" d="${d}"${traceAttr(e.traces)} style="stroke-dasharray:none"/>`);
    out.push(`<path class="${cls}" d="${d}" marker-end="url(#bb-arrow-${e.kind})"${traceAttr(e.traces)} data-from="${esc(e.from)}" data-to="${esc(e.to)}"/>`);
    if (animate && !isPlanned && e.kind !== "failure") out.push(`<path class="bb-flow map-item" d="${d}"${traceAttr(e.traces)}/>`);
  }
  for (const e of model.edges) {
    if (!e._label) continue;
    const { rect, cx, cy } = e._label;
    const bg = st === "expressive" ? `<rect class="bb-label-bg" x="${r1(rect.x)}" y="${r1(rect.y)}" width="${r1(rect.w)}" height="${r1(rect.h)}" rx="${r1(rect.h / 2)}"/>` : "";
    out.push(`<g class="bb-edge-label map-item"${traceAttr(e.traces)}>${bg}<text class="bb-label ${e.kind}" x="${r1(cx)}" y="${r1(cy + 3.6)}" text-anchor="middle">${esc(e.label)}</text></g>`);
  }
  out.push(`</g>`);

  for (const n of model.nodes) {
    const { x, y, w, h, pseudo, caption } = lay.rects.get(n.id);
    if (pseudo) { out.push(pseudoGlyph(n, { x, y, w, h, caption }, traceAttr(n.traces), interactive)); continue; }
    const status = tracking ? n.status ?? "planned" : null;
    const cls = ["bb-node", "map-item", n.category && `cat-${n.category}`, status && `status-${status}`, n._findings?.length && "has-finding"].filter(Boolean).join(" ");
    const a11y = interactive ? ` tabindex="0" role="button" aria-label="Open details for ${esc(n.title)}"` : "";
    const href = links && !interactive ? nodeHref(model, n) : null;
    if (href) out.push(`<a href="${esc(href)}" target="_top">`);
    out.push(`<g class="${cls}" data-id="${esc(n.id)}"${traceAttr(n.traces)}${a11y}>`);
    if (st === "expressive") out.push(...expressiveCard(n, { x, y, w, h }, status));
    else out.push(...restrainedCard(n, { x, y, w, h }, status));
    const footY = st === "expressive" ? y + h - 27 : y + h - (status ? 50 : 30);
    if (n._findings?.length) out.push(findingMark(x + w - (st === "expressive" ? 10 : 18), footY, n._findings, st));
    out.push(`</g>`);
    if (href) out.push(`</a>`);
  }

  out.push(legend(lay.legend, lay.width, st));
  return out.join("\n");
}

function expressiveCard(n, { x, y, w, h }, status) {
  const out = [];
  out.push(`<rect class="bb-node-box" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="10"/>`);
  out.push(`<rect class="bb-node-wash" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="10"/>`);
  out.push(`<path class="bb-node-bevel" d="M ${r1(x + 10)} ${r1(y + 1)} H ${r1(x + w - 10)}"/>`);
  if (status === "partial") {
    out.push(`<rect class="bb-band bb-band-rest" x="${r1(x)}" y="${r1(y)}" width="5" height="${r1(h)}" rx="2.5"/>`);
    out.push(`<rect class="bb-band" x="${r1(x)}" y="${r1(y)}" width="5" height="${r1(h / 2)}" rx="2.5"/>`);
  } else {
    out.push(`<rect class="bb-band" x="${r1(x)}" y="${r1(y)}" width="5" height="${r1(h)}" rx="2.5"/>`);
  }
  let ty = y + 24;
  if (n.type) { out.push(`<text class="bb-kicker" x="${r1(x + 18)}" y="${r1(ty)}">${esc(n.type.toUpperCase())}</text>`); ty += 22; }
  if (status) out.push(statusMark(x + w - 10, y + 10, status, "expressive"));
  out.push(`<text class="bb-node-title" x="${r1(x + 18)}" y="${r1(ty)}">${esc(n.title)}</text>`);
  ty += 22;
  for (const line of n.lines) { out.push(`<text class="bb-copy" x="${r1(x + 18)}" y="${r1(ty)}">${esc(line)}</text>`); ty += 17; }
  if (n.hint) out.push(`<text class="bb-hint" x="${r1(x + 18)}" y="${r1(y + h - 14)}">${esc(n.hint)}</text>`);
  return out;
}

// Restrained card: a matte soft-square plane. Category is one solid dot beside a
// tracked label at the top; status is a maker's label at the foot. Geometry
// comes from CARD so the overflow check measures exactly what is drawn.
function restrainedCard(n, { x, y, w, h }, status) {
  const out = [];
  const pad = CARD.padX;
  out.push(`<rect class="bb-node-box" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="7"/>`);
  let ty = y + 34;
  if (n.type || n.category) {
    ty = y + CARD.kicker;
    if (n.category) out.push(`<circle class="bb-mark" cx="${r1(x + pad + 4)}" cy="${r1(ty - 4)}" r="4"/>`);
    if (n.type) out.push(`<text class="bb-kicker" x="${r1(x + pad + (n.category ? 15 : 0))}" y="${r1(ty)}">${esc(n.type.toUpperCase())}</text>`);
    ty += CARD.title;
  }
  if (status) out.push(statusMark(x + w - pad, y + h - CARD.bottom - 15, status, "restrained"));
  out.push(`<text class="bb-node-title" x="${r1(x + pad)}" y="${r1(ty)}">${esc(n.title)}</text>`);
  ty += CARD.firstLine;
  for (const line of n.lines) { out.push(`<text class="bb-copy" x="${r1(x + pad)}" y="${r1(ty)}">${esc(line)}</text>`); ty += CARD.line; }
  if (n.hint) out.push(`<text class="bb-hint" x="${r1(x + pad)}" y="${r1(y + h - CARD.bottom - (status ? CARD.footer : 0))}">${esc(n.hint)}</text>`);
  return out;
}

export function background(width, height, style = DEFAULT_STYLE) {
  const base = `<rect class="bb-canvas" x="0" y="0" width="${width}" height="${height}"/>`;
  if (style !== "expressive") return base;
  return base +
    `<rect class="bb-bg-dots" x="0" y="0" width="${width}" height="${height}"/>` +
    `<rect class="bb-bg-glow-a" x="0" y="0" width="${width}" height="${height}"/>` +
    `<rect class="bb-bg-glow-b" x="0" y="0" width="${width}" height="${height}"/>`;
}

export function header(model, width, left = 40, style = DEFAULT_STYLE) {
  const out = [];
  if (style === "expressive") {
    let y = 46;
    if (model.meta.kicker) {
      out.push(`<rect class="bb-accent" x="${left}" y="${y - 9}" width="20" height="3" rx="1.5"/>`);
      out.push(`<text class="bb-kicker-top bb-subtitle" x="${left + 30}" y="${y - 4}">${esc(model.meta.kicker.toUpperCase())}</text>`);
      y += 34;
    } else {
      y += 18;
    }
    out.push(`<text class="bb-title" x="${left}" y="${y}">${esc(model.meta.title)}</text>`);
    if (model.meta.subtitle) out.push(`<text class="bb-subtitle" x="${left}" y="${y + 26}">${esc(model.meta.subtitle)}</text>`);
    if (model.meta.statusTracking) out.push(meter(model, width - left, 24, "expressive"));
    return out.join("\n");
  }
  // Restrained: Swiss-style stack. A short rule, tracked kicker, light display title.
  const top = 52;
  if (model.meta.kicker) {
    out.push(`<path class="bb-rule" d="M ${left} ${top - 4} H ${left + 22}"/>`);
    out.push(`<text class="bb-kicker-top" x="${left + 34}" y="${top}">${esc(model.meta.kicker.toUpperCase())}</text>`);
  }
  out.push(`<text class="bb-title" x="${left}" y="${top + 48}">${esc(model.meta.title)}</text>`);
  if (model.meta.subtitle) out.push(`<text class="bb-subtitle" x="${left}" y="${top + 78}">${esc(model.meta.subtitle)}</text>`);
  if (model.meta.statusTracking) out.push(meter(model, width - left, top, "restrained"));
  return out.join("\n");
}

function pseudoGlyph(n, { x, y, w, h, caption }, traces, interactive) {
  const [cx, cy] = [x + w / 2, y + h / 2];
  const cat = n.category ? ` cat-${n.category}` : "";
  const a11y = interactive && n.details ? ` tabindex="0" role="button" aria-label="Open details for ${esc(n.title ?? n.shape)}"` : "";
  let glyph;
  if (n.shape === "initial") glyph = `<circle class="bb-pseudo-fill" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(w / 2 - 5)}"/>`;
  else if (n.shape === "final") glyph = `<circle class="bb-pseudo-ring" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(w / 2 - 2)}"/><circle class="bb-pseudo-fill" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(w / 2 - 7)}"/>`;
  else glyph = `<polygon class="bb-pseudo-ring bb-pseudo-choice" points="${r1(cx)},${r1(y)} ${r1(x + w)},${r1(cy)} ${r1(cx)},${r1(y + h)} ${r1(x)},${r1(cy)}"/>`;
  const c = caption;
  const label = n.title && c ? `<text class="bb-copy" x="${r1(c.x + c.w / 2)}" y="${r1(c.y + c.h - 3)}" text-anchor="middle">${esc(n.title)}</text>` : "";
  return `<g class="bb-node bb-pseudo map-item${cat}" data-id="${esc(n.id)}"${traces}${a11y}>${glyph}${label}</g>`;
}

export function legend(legendLay, width, style = DEFAULT_STYLE) {
  const parts = [];
  if (legendLay.items.length && width) {
    if (style === "expressive") {
      const rows = Math.max(...legendLay.items.map((i) => i.row)) + 1;
      parts.push(`<rect class="bb-legend-bg" x="24" y="${legendLay.top - 12}" width="${width - 48}" height="${rows * legendLay.rowHeight + 6}" rx="10"/>`);
    } else {
      parts.push(`<path class="bb-rule" d="M 40 ${legendLay.top - 14} H ${width - 40}"/>`);
    }
  }
  for (const it of legendLay.items) {
    const x = it.x;
    const y = legendLay.top + it.row * legendLay.rowHeight + 8;
    if (it.kind === "cat") {
      parts.push(style === "expressive"
        ? `<rect class="bb-key cat-${it.id}" x="${x}" y="${y - 9}" width="10" height="10" rx="2.5"/>`
        : `<circle class="bb-mark cat-${it.id}" cx="${x + 4}" cy="${y - 4}" r="4"/>`);
    } else if (it.kind === "edge") parts.push(`<path class="bb-edge ${it.id}" d="M ${x} ${y - 4} L ${x + 22} ${y - 4}"/>`);
    else if (it.kind === "status") parts.push(`<g class="bb-status is-${it.id}">${statusDot(x + 4, y - 4, it.id, style === "expressive" ? 4.2 : 3.4)}</g>`);
    parts.push(`<text class="bb-legend-text" x="${x + it.off}" y="${y}">${esc(it.label)}</text>`);
  }
  return `<g class="bb-legend" aria-label="Legend">${parts.join("")}</g>`;
}

export function markerDefs(style = DEFAULT_STYLE) {
  // Expressive: notched arrowheads. Restrained: small plain solid triangles.
  const [size, d] = style === "expressive" ? [8.5, "M 0 0.6 L 10 5 L 0 9.4 L 2.6 5 z"] : [6.5, "M 0 1 L 10 5 L 0 9 z"];
  return `<defs>${["data", "control", "failure"].map((k) => `<marker id="bb-arrow-${k}" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="${size}" markerHeight="${size}" orient="auto-start-reverse"><path class="bb-arrow ${k}" d="${d}"/></marker>`).join("")}</defs>`;
}

// Standalone SVG: README <img>/<picture>, MARP, markdown, and rasterisation.
// darkTheme ships both themes behind prefers-color-scheme.
export function renderSvg(model, lay, { theme, darkTheme, categoryTheme = darkTheme, categoryFillParity = model.meta.categoryFillParity, animate = false, links = true, font, style } = {}) {
  const st = styleOf(model, style);
  const cats = model.categories;
  let css = fontFaceCss(font) + structuralCss(st) + styleCss(theme, cats, { style: st, categoryTheme: categoryFillParity === "dark" && theme.mode === "light" ? categoryTheme : undefined });
  if (darkTheme) css += `\n@media (prefers-color-scheme:dark){\n${styleCss(darkTheme, cats, { style: st })}\n}`;
  if (animate) css += MOTION[st];
  const desc = model.meta.description ?? model.meta.subtitle ?? "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lay.width} ${lay.height}" width="${lay.width}" height="${lay.height}" role="img" aria-labelledby="bb-t bb-d">
<title id="bb-t">${esc(model.meta.title)}</title><desc id="bb-d">${esc(desc)}</desc>
<style>${css}</style>
${markerDefs(st)}${styleDefs(theme, cats, { style: st })}${darkTheme ? styleDefs(darkTheme, cats, { style: st }) : ""}
${svgBody(model, lay, { animate, links, style: st })}
</svg>
`;
}

export { themeCss, TYPE };
