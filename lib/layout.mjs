// Grid layout, orthogonal edge routing, and label placement.
//
// Routing follows the approach archify (MIT, tt-a1i/archify) documents:
// orthogonal routes, deterministic endpoint spreading, and label-to-route
// clearance checks. This is an independent, compact implementation: A* over a
// sparse orthogonal visibility lattice with bend and overlap penalties.

import { runExtensions } from "./extensions.mjs";
import { PSEUDO } from "./model.mjs";

const MARGIN = 40;
// Page header band; restrained sets a taller, airier header than expressive.
const headerHeight = (model) => (model.meta.style === "expressive" ? 104 : 150);
// Header text is ~46px tall; the rest of the band is a routing corridor so
// arrows entering a zone from above (TD, stacked zones) pass under the title.
const ZONE_HEADER = 92;
const ZONE_TITLE_H = 46;
const ZONE_PAD = 18;
const MAX_OBSTACLE_PAD = 14;
const BEND_COST = 60;
const OVERLAP_COST = 45;
const LEGEND_H = 46;

// Type scale for width estimates (renderers set the same sizes in CSS).
export const TYPE = {
  kicker: { size: 10.5, weight: 700, spacing: 2.4 },
  title: { size: 17, weight: 700 },
  copy: { size: 13.5, weight: 400 },
  hint: { size: 11.5, weight: 600 },
  label: { size: 11.5, weight: 700 },
};

// Restrained card geometry, shared by the renderer and the overflow check so they
// cannot disagree: baselines measured from the card's top edge.
export const CARD = { padX: 22, kicker: 30, title: 28, firstLine: 25, line: 20, footer: 26, bottom: 16 };

// Font-free width estimate; deterministic across machines, slightly generous.
export function textWidth(text, { size, weight = 400, spacing = 0, upper = false }) {
  const s = String(text ?? "");
  // Calibrated against Geist Sans (slightly wider than system UI fonts).
  const per = upper ? 0.7 : weight >= 700 ? 0.62 : 0.575;
  return s.length * (size * per + spacing);
}

const DIRS = { right: [1, 0], left: [-1, 0], bottom: [0, 1], top: [0, -1] };
const OPPOSITE = { right: "left", left: "right", top: "bottom", bottom: "top" };

const ZONE_GUTTER = 40;

// meta.grid.gap is a number or [x, y]; statecharts want wide label channels.
export const gaps = (model) => { const g = model.meta.grid.gap; return Array.isArray(g) ? g : [g, g]; };

const LABEL_H = 19;
const LABEL_CLEAR = 30;

// Node size is fixed by the grid (col/row minus the configured gap); the
// channels between nodes grow to fit labels. A horizontal flow needs room for
// the label's width, a vertical flow only for its height. Same rule in LR and
// TD, so a transposed diagram still fits its labels.
export function gridMetrics(model) {
  const { col, row } = model.meta.grid;
  const [bgx, bgy] = gaps(model);
  const nodeW = col - bgx, nodeH = row - bgy;
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  let gx = bgx, gy = bgy;
  for (const e of model.edges) {
    if (!e.label) continue;
    const a = byId.get(e.from), b = byId.get(e.to);
    const colsDisjoint = a.at[0] + a.span[0] <= b.at[0] || b.at[0] + b.span[0] <= a.at[0];
    if (colsDisjoint) gx = Math.max(gx, textWidth(e.label, TYPE.label) + 16 + LABEL_CLEAR);
    else gy = Math.max(gy, LABEL_H + LABEL_CLEAR);
  }
  return { nodeW, nodeH, gx, gy, pitchX: nodeW + gx, pitchY: nodeH + gy };
}

// Zones need room the bare grid does not give them: a header band above the
// first row of each zone, and a gutter where a new zone's columns begin.
function zoneStarts(model, axis) {
  const first = new Map();
  for (const n of model.nodes) {
    if (!n.zone) continue;
    const v = first.get(n.zone);
    first.set(n.zone, v === undefined ? n.at[axis] : Math.min(v, n.at[axis]));
  }
  return [...new Set(first.values())].sort((a, b) => a - b);
}

function offsets(model) {
  const rows = zoneStarts(model, 1);
  const cols = zoneStarts(model, 0).slice(1);
  return {
    x: (c) => cols.filter((v) => v <= c).length * ZONE_GUTTER,
    y: (r) => rows.filter((v) => v <= r).length * ZONE_HEADER,
  };
}

function nodeRects(model) {
  const { gx, gy, pitchX: col, pitchY: row } = gridMetrics(model);
  const off = offsets(model);
  const rects = new Map();
  for (const n of model.nodes) {
    const [c, r] = n.at;
    const [lastC, lastR] = [c + n.span[0] - 1, r + n.span[1] - 1];
    const x = MARGIN + ZONE_PAD + off.x(c) + c * col + gx / 2;
    const y = headerHeight(model) + off.y(r) + r * row + gy / 2;
    const x2 = MARGIN + ZONE_PAD + off.x(lastC) + (lastC + 1) * col - gx / 2;
    const y2 = headerHeight(model) + off.y(lastR) + (lastR + 1) * row - gy / 2;
    const rect = { x, y, w: x2 - x, h: y2 - y };
    if (PSEUDO.has(n.shape)) {
      // Pseudo-states are small glyphs centred in their cell; routing and
      // port spreading treat them as ordinary (tiny) obstacles.
      const s = n.shape === "choice" ? 34 : 28;
      rects.set(n.id, { x: x + rect.w / 2 - s / 2, y: y + rect.h / 2 - s / 2, w: s, h: s, pseudo: true });
    } else {
      rects.set(n.id, rect);
    }
  }
  return rects;
}

function contentWarnings(model, rects) {
  const warnings = [];
  for (const n of model.nodes) {
    const r = rects.get(n.id);
    if (r.pseudo) continue;
    const expressive = model.meta.style === "expressive";
    // Restrained cards carry status in a footer line, so they need one more row of height.
    const footer = model.meta.statusTracking && !expressive ? CARD.footer : 0;
    const needH = expressive
      ? 22 + (n.type ? 16 : 0) + 22 + n.lines.length * 17 + (n.hint ? 18 : 0) + 10
      : (n.type ? CARD.kicker + CARD.title : 34) + (n.lines.length ? CARD.firstLine + (n.lines.length - 1) * CARD.line : 0) + 5 + (n.hint ? 22 : 0) + footer + CARD.bottom;
    if (needH > r.h) warnings.push({ code: "node-overflow-y", message: `node "${n.id}" content needs ~${Math.ceil(needH)}px height, has ${Math.round(r.h)}; raise meta.grid.row or span` });
    const widest = Math.max(
      textWidth(n.title, TYPE.title),
      textWidth(n.type, { ...TYPE.kicker, upper: true }) + (expressive ? (model.meta.statusTracking ? 86 : 0) : 14),
      ...n.lines.map((l) => textWidth(l, TYPE.copy)),
      textWidth(n.hint, TYPE.hint),
    );
    const pad = expressive ? 34 : CARD.padX * 2;
    if (widest + pad > r.w) warnings.push({ code: "node-overflow-x", message: `node "${n.id}" text ~${Math.ceil(widest)}px exceeds width ${Math.round(r.w - pad)}; shorten text or widen span` });
  }
  return warnings;
}

function zoneRects(model, rects) {
  const zones = [];
  for (const z of model.zones) {
    const members = model.nodes.filter((n) => n.zone === z.id).map((n) => rects.get(n.id));
    if (!members.length) continue;
    const x1 = Math.min(...members.map((r) => r.x)) - ZONE_PAD;
    const y1 = Math.min(...members.map((r) => r.y)) - ZONE_HEADER + 6;
    const x2 = Math.max(...members.map((r) => r.x + r.w)) + ZONE_PAD;
    const y2 = Math.max(...members.map((r) => r.y + r.h)) + ZONE_PAD;
    const headerW = Math.max(textWidth(z.title, { size: 19, weight: 600 }), textWidth(z.kicker, { size: 10.5, weight: 800, spacing: 1.4, upper: true }), textWidth(z.subtitle, { size: 11.5 }));
    zones.push({ ...z, rect: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, header: { x: x1 + 16, y: y1 + 10, w: headerW + 8, h: ZONE_TITLE_H } });
  }
  return zones;
}

function chooseSides(a, b) {
  if (a.x + a.w <= b.x) return ["right", "left"];
  if (b.x + b.w <= a.x) return ["left", "right"];
  return b.y >= a.y ? ["bottom", "top"] : ["top", "bottom"];
}

function sidePoint(rect, side, t) {
  switch (side) {
    case "top": return [rect.x + rect.w * t, rect.y];
    case "bottom": return [rect.x + rect.w * t, rect.y + rect.h];
    case "left": return [rect.x, rect.y + rect.h * t];
    default: return [rect.x + rect.w, rect.y + rect.h * t];
  }
}

function assignPorts(model, rects, zones) {
  const ends = [];
  for (const e of model.edges) {
    const [autoFrom, autoTo] = chooseSides(rects.get(e.from), rects.get(e.to));
    e._fromSide = e.fromSide ?? autoFrom;
    e._toSide = e.toSide ?? autoTo;
    ends.push({ e, node: e.from, side: e._fromSide, other: e.to, key: "_fromT" });
    ends.push({ e, node: e.to, side: e._toSide, other: e.from, key: "_toT" });
  }
  const groups = new Map();
  for (const end of ends) {
    const k = `${end.node}:${end.side}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(end);
  }
  for (const group of groups.values()) {
    const horizontal = group[0].side === "top" || group[0].side === "bottom";
    const centre = (id) => { const r = rects.get(id); return horizontal ? r.x + r.w / 2 : r.y + r.h / 2; };
    group.sort((a, b) => centre(a.other) - centre(b.other) || a.e.index - b.e.index);
    const n = group.length;
    const [t0, t1] = allowedSpan(rects.get(group[0].node), group[0].side, zones);
    group.forEach((end, i) => { end.e[end.key] = t0 + ((t1 - t0) * (i + 0.5)) / n; });
    for (const end of group) end.alone = n === 1;
  }
  // Facing-port alignment: lone endpoints whose rects overlap in projection
  // snap to the shared midpoint, so the edge is one straight segment.
  for (const e of model.edges) {
    const fromAlone = groups.get(`${e.from}:${e._fromSide}`).length === 1;
    const toAlone = groups.get(`${e.to}:${e._toSide}`).length === 1;
    if (!fromAlone || !toAlone || OPPOSITE[e._fromSide] !== e._toSide) continue;
    const a = rects.get(e.from), b = rects.get(e.to);
    const vertical = e._fromSide === "top" || e._fromSide === "bottom";
    const [a1, a2, b1, b2] = vertical ? [a.x, a.x + a.w, b.x, b.x + b.w] : [a.y, a.y + a.h, b.y, b.y + b.h];
    const lo = Math.max(a1, b1) + 12, hi = Math.min(a2, b2) - 12;
    if (lo > hi) continue;
    const mid = (lo + hi) / 2;
    const ft = (mid - a1) / (a2 - a1), tt = (mid - b1) / (b2 - b1);
    const [f0, f1] = allowedSpan(a, e._fromSide, zones), [g0, g1] = allowedSpan(b, e._toSide, zones);
    if (ft < f0 || ft > f1 || tt < g0 || tt > g1) continue;
    e._fromT = ft;
    e._toT = tt;
  }
}

// Ports spread over the middle of a side, except where a zone's header text
// sits just above a top side: arrows entering from above (common in TD) must
// come in beside the title, not through it.
function allowedSpan(rect, side, zones) {
  let lo = 0.2, hi = 0.8;
  if (side !== "top" || rect.pseudo) return [lo, hi];
  for (const z of zones) {
    const h = z.header;
    const gapAbove = rect.y - (h.y + h.h);
    if (gapAbove < 0 || gapAbove > ZONE_HEADER) continue;
    const b0 = (h.x - 14 - rect.x) / rect.w, b1 = (h.x + h.w + 14 - rect.x) / rect.w;
    if (b1 <= lo || b0 >= hi) continue;
    // Keep the larger free piece on either side of the header text.
    if (b0 - lo >= hi - b1) hi = Math.min(hi, b0); else lo = Math.max(lo, b1);
  }
  return hi - lo >= 0.08 ? [lo, hi] : [0.2, 0.8];
}

const inflate = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const strictlyInside = (x, y, r) => x > r.x + 0.01 && x < r.x + r.w - 0.01 && y > r.y + 0.01 && y < r.y + r.h - 0.01;

class Heap {
  constructor() { this.a = []; }
  push(item) { const a = this.a; a.push(item); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

function lattice(obstacles, extraPoints) {
  const xs = new Set(), ys = new Set();
  for (const o of obstacles) { xs.add(o.x); xs.add(o.x + o.w); ys.add(o.y); ys.add(o.y + o.h); }
  for (const [x, y] of extraPoints) { xs.add(x); ys.add(y); }
  const midpoints = (set) => { const s = [...set].sort((a, b) => a - b); for (let i = 0; i + 1 < s.length; i++) set.add((s[i] + s[i + 1]) / 2); };
  midpoints(xs); midpoints(ys);
  return { xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b) };
}

function segKey(x1, y1, x2, y2) {
  return x1 < x2 || (x1 === x2 && y1 < y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
}

function routeOne(start, startDir, goal, goalDir, obstacles, grid, used) {
  const { xs, ys } = grid;
  const ix = new Map(xs.map((v, i) => [v, i]));
  const iy = new Map(ys.map((v, i) => [v, i]));
  const blocked = (x, y) => obstacles.some((o) => strictlyInside(x, y, o));
  const [sx, sy] = [ix.get(start[0]), iy.get(start[1])];
  const [gx, gy] = [ix.get(goal[0]), iy.get(goal[1])];
  const arrive = OPPOSITE[goalDir];
  const dirNames = Object.keys(DIRS);
  const key = (x, y, d) => `${x},${y},${d}`;
  const h = (x, y) => Math.abs(xs[x] - xs[gx]) + Math.abs(ys[y] - ys[gy]);
  const open = new Heap();
  const best = new Map();
  const prev = new Map();
  const k0 = key(sx, sy, startDir);
  best.set(k0, 0);
  open.push({ f: h(sx, sy), g: 0, x: sx, y: sy, d: startDir });
  let found = null;
  let guard = 0;
  while (open.size && guard++ < 200000) {
    const cur = open.pop();
    const ck = key(cur.x, cur.y, cur.d);
    if (cur.g > (best.get(ck) ?? Infinity)) continue;
    if (cur.x === gx && cur.y === gy) {
      const finalCost = cur.g + (cur.d === arrive ? 0 : BEND_COST);
      if (!found || finalCost < found.cost) found = { cost: finalCost, k: ck };
      continue;
    }
    if (found && cur.f >= found.cost) break;
    for (const d of dirNames) {
      if (d === OPPOSITE[cur.d]) continue;
      const [dx, dy] = DIRS[d];
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= xs.length || ny >= ys.length) continue;
      const x1 = xs[cur.x], y1 = ys[cur.y], x2 = xs[nx], y2 = ys[ny];
      if (!(nx === gx && ny === gy) && blocked(x2, y2)) continue;
      if (blocked((x1 + x2) / 2, (y1 + y2) / 2)) continue;
      const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
      const reuse = used.has(segKey(x1, y1, x2, y2)) ? OVERLAP_COST + len * 1.5 : 0;
      const g = cur.g + len + (d === cur.d ? 0 : BEND_COST) + reuse;
      const nk = key(nx, ny, d);
      if (g < (best.get(nk) ?? Infinity)) {
        best.set(nk, g);
        prev.set(nk, ck);
        open.push({ f: g + h(nx, ny), g, x: nx, y: ny, d });
      }
    }
  }
  if (!found) return null;
  const pts = [];
  for (let k = found.k; k; k = prev.get(k)) {
    const [x, y] = k.split(",").map(Number);
    pts.push([xs[x], ys[y]]);
  }
  return pts.reverse();
}

export function simplify(points) {
  const out = [];
  for (const p of points) {
    if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) continue;
    if (out.length >= 2) {
      const [a, b] = [out.at(-2), out.at(-1)];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

function fallbackRoute(a, b, fromSide) {
  const horizontal = fromSide === "left" || fromSide === "right";
  if (horizontal) { const mx = (a[0] + b[0]) / 2; return [a, [mx, a[1]], [mx, b[1]], b]; }
  const my = (a[1] + b[1]) / 2;
  return [a, [a[0], my], [b[0], my], b];
}

function routeEdges(model, rects, zones) {
  // Padding must leave an open channel between grid neighbours, or stacked
  // nodes have no route between them.
  const { gx, gy } = gridMetrics(model);
  const pad = Math.min(MAX_OBSTACLE_PAD, Math.min(gx, gy) / 2 - 5);
  const obstacles = [
    ...[...rects.values()].map((r) => inflate(r, pad)),
    ...zones.map((z) => inflate(z.header, 4)),
    ...[...rects.values()].filter((r) => r.caption).map((r) => inflate(r.caption, 3)),
  ];
  const stubs = [];
  for (const e of model.edges) {
    const from = rects.get(e.from), to = rects.get(e.to);
    const p0 = sidePoint(from, e._fromSide, e._fromT);
    const p1 = sidePoint(to, e._toSide, e._toT);
    const [fx, fy] = DIRS[e._fromSide], [tx, ty] = DIRS[e._toSide];
    const stub = pad + 2;
    e._ends = { p0, p1, s0: [p0[0] + fx * stub, p0[1] + fy * stub], s1: [p1[0] + tx * stub, p1[1] + ty * stub] };
    stubs.push(e._ends.s0, e._ends.s1);
  }
  const grid = lattice(obstacles, stubs);
  const used = new Set();
  const warnings = [];
  for (const e of model.edges) {
    const { p0, p1, s0, s1 } = e._ends;
    const mid = routeOne(s0, e._fromSide, s1, e._toSide, obstacles, grid, used);
    if (!mid) warnings.push({ code: "route-fallback", message: `edge ${e.from} -> ${e.to} found no clean route; drew a fallback` });
    const pts = simplify(mid ? [p0, ...mid, p1] : fallbackRoute(p0, p1, e._fromSide));
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      // Mark every lattice segment this route covers, for the overlap penalty.
      const isH = a[1] === b[1];
      const axis = isH ? grid.xs : grid.ys;
      const lo = Math.min(isH ? a[0] : a[1], isH ? b[0] : b[1]);
      const hi = Math.max(isH ? a[0] : a[1], isH ? b[0] : b[1]);
      const inRange = axis.filter((v) => v >= lo && v <= hi);
      for (let j = 0; j + 1 < inRange.length; j++) {
        used.add(isH ? segKey(inRange[j], a[1], inRange[j + 1], a[1]) : segKey(a[0], inRange[j], a[0], inRange[j + 1]));
      }
    }
    e._points = pts;
  }
  return warnings;
}

const rectsOverlap = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

function segmentHitsRect([a, b], r) {
  if (a[1] === b[1]) return a[1] > r.y && a[1] < r.y + r.h && Math.max(a[0], b[0]) > r.x && Math.min(a[0], b[0]) < r.x + r.w;
  return a[0] > r.x && a[0] < r.x + r.w && Math.max(a[1], b[1]) > r.y && Math.min(a[1], b[1]) < r.y + r.h;
}

function placeLabels(model, rects, zones) {
  const placed = [];
  const warnings = [];
  const blockers = [...[...rects.values()].map((r) => inflate(r, 4)), ...zones.map((z) => z.header), ...[...rects.values()].filter((r) => r.caption).map((r) => r.caption)];
  for (const e of model.edges) {
    if (!e.label) continue;
    const w = textWidth(e.label, TYPE.label) + 16, h = 19;
    const segs = [];
    for (let i = 0; i + 1 < e._points.length; i++) segs.push([e._points[i], e._points[i + 1]]);
    const ranked = segs
      .map((s, i) => ({ s, i, len: Math.abs(s[1][0] - s[0][0]) + Math.abs(s[1][1] - s[0][1]) }))
      .sort((a, b) => b.len - a.len || a.i - b.i);
    let bestCand = null;
    for (const { s, len } of ranked) {
      const horizontal = s[0][1] === s[1][1];
      if (len < (horizontal ? w + 12 : h + 12)) continue;
      for (const t of [0.5, 0.32, 0.68, 0.2, 0.8]) {
        const cx = s[0][0] + (s[1][0] - s[0][0]) * t;
        const cy = s[0][1] + (s[1][1] - s[0][1]) * t;
        const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
        let score = 0;
        for (const b of blockers) if (rectsOverlap(rect, b)) score += 100;
        for (const p of placed) if (rectsOverlap(rect, p, 6)) score += 100;
        for (const other of model.edges) {
          if (other === e) continue;
          for (let i = 0; i + 1 < other._points.length; i++) if (segmentHitsRect([other._points[i], other._points[i + 1]], rect)) score += 10;
        }
        if (!bestCand || score < bestCand.score) bestCand = { score, rect, cx, cy };
        if (score === 0) break;
      }
      if (bestCand?.score === 0) break;
    }
    if (!bestCand) {
      const [a, b] = ranked[0].s;
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      bestCand = { score: 999, rect: { x: cx - w / 2, y: cy - h / 2, w, h }, cx, cy };
    }
    if (bestCand.score >= 100) warnings.push({ code: "label-clearance", message: `label "${e.label}" on ${e.from} -> ${e.to} overlaps a node or label; shorten it or add grid space` });
    e._label = bestCand;
    placed.push(bestCand.rect);
  }
  return warnings;
}

// Pseudo-state captions ("Done", "Cancelled") go on a side of the glyph that no
// edge uses, and become obstacles so routes and labels steer around them.
function placeCaptions(model, rects) {
  for (const n of model.nodes) {
    const r = rects.get(n.id);
    if (!r.pseudo || !n.title) continue;
    const used = new Set();
    for (const e of model.edges) {
      if (e.from === n.id) used.add(e._fromSide);
      if (e.to === n.id) used.add(e._toSide);
    }
    const w = textWidth(n.title, TYPE.copy) + 4, h = 15;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const side = ["bottom", "top", "right", "left"].find((s) => !used.has(s)) ?? "bottom";
    const box = {
      bottom: { x: cx - w / 2, y: r.y + r.h + 4 },
      top: { x: cx - w / 2, y: r.y - 4 - h },
      right: { x: r.x + r.w + 6, y: cy - h / 2 },
      left: { x: r.x - 6 - w, y: cy - h / 2 },
    }[side];
    r.caption = { ...box, w, h, side };
  }
}

export function layout(model) {
  const rects = nodeRects(model);
  const zones = zoneRects(model, rects);
  assignPorts(model, rects, zones);
  placeCaptions(model, rects);
  const warnings = [...contentWarnings(model, rects), ...routeEdges(model, rects, zones), ...placeLabels(model, rects, zones)];
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      if (rectsOverlap(zones[i].rect, zones[j].rect, -1)) warnings.push({ code: "zone-overlap", message: `zones "${zones[i].id}" and "${zones[j].id}" overlap; leave a grid column or row between them` });
    }
  }
  const all = [...rects.values(), ...zones.map((z) => z.rect)];
  const width = Math.ceil(Math.max(...all.map((r) => r.x + r.w)) + MARGIN);
  const contentBottom = Math.ceil(Math.max(...all.map((r) => r.y + r.h)) + MARGIN);
  const legend = legendLayout(model, width, contentBottom, "flat");
  const result = { rects, zones, width, height: legend.bottom, legend, warnings };
  runExtensions(model, "layout", result);
  return result;
}

// Legend items differ per view (iso explains status by construction, not by
// dot), but wrapping is shared so neither view can overflow the canvas.
export function legendItems(model, view) {
  const items = [];
  const used = new Set([...model.nodes.map((n) => n.category), ...model.zones.map((z) => z.category)].filter(Boolean));
  for (const [id, cat] of Object.entries(model.categories)) if (used.has(id)) items.push({ kind: "cat", id, label: cat.label ?? id });
  if (view === "flat") {
    for (const k of ["data", "control", "failure"]) if (model.edges.some((e) => e.kind === k)) items.push({ kind: "edge", id: k, label: `${k[0].toUpperCase()}${k.slice(1)} flow` });
  }
  if (model.meta.statusTracking) {
    const words = view === "iso"
      ? [["implemented", "Built = solid"], ["partial", "Partial = hatched roof"], ["planned", "Planned = wireframe"]]
      : [["implemented", "Built"], ["partial", "Partial"], ["planned", "Planned"]];
    for (const [id, label] of words) items.push({ kind: view === "iso" ? "text" : "status", id, label });
  }
  return items;
}

export function legendLayout(model, width, top, view, left = MARGIN) {
  const ROW = 26;
  const placed = [];
  let x = left, row = 0;
  for (const it of legendItems(model, view)) {
    const off = it.kind === "edge" ? 30 : it.kind === "text" ? 0 : 16;
    const gap = model.meta.style === "expressive" ? 22 : 18;
    const w = off + textWidth(it.label, { size: 11 }) + gap;
    if (x + w > width - MARGIN && x > left) { x = left; row += 1; }
    placed.push({ ...it, x, off, row });
    x += w;
  }
  const rows = placed.length ? row + 1 : 0;
  return { items: placed, top, rowHeight: ROW, bottom: top + rows * ROW + 12 };
}
