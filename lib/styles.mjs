// Design languages. A style is independent of the colour theme: the theme
// supplies the palette, the style decides how it is used. Style is fixed per
// render, so the light/dark toggle only ever swaps colours within one language.
//
//   restrained  Matte flat planes, one hairline weight, generous space, tracked
//               uppercase signage, light display type, soft pastel colour.
//               The default.
//   expressive  Glows, colour washes, shadows, gradients.
import { categoryColor, mix, pastelize, themeCss } from "./themes.mjs";
import { paintCss, paintDefs } from "./paint.mjs";
import { TYPE } from "./layout.mjs";

export const STYLES = ["restrained", "expressive"];
export const DEFAULT_STYLE = "restrained";

const FONT = `Geist,"Geist Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif`;

const EXPRESSIVE_BASE = `
text{font-family:${FONT}}
.bb-title{font-size:32px;font-weight:700;letter-spacing:-.025em}
.bb-subtitle{font-size:14px}
.bb-kicker-top{font-size:11px;font-weight:800;letter-spacing:2px}
.bb-summary{font-size:11px;font-weight:700;letter-spacing:.08em}
.bb-meter-big{font-size:34px;font-weight:750;letter-spacing:-.03em}
.bb-meter-track{stroke-width:1}
.bb-zone{stroke-width:1.2}
.bb-zone-accent{fill:none;stroke-width:2.5;stroke-linecap:round}
.bb-zone-kicker{font-size:10.5px;font-weight:800;letter-spacing:1.6px}
.bb-zone-title{font-size:20px;font-weight:650;letter-spacing:-.01em}
.bb-zone-sub{font-size:11.5px}
.bb-node-box{stroke-width:1.2}
.bb-node-bevel{fill:none;stroke-width:1}
.bb-node.status-planned .bb-node-wash,.bb-node.status-planned .bb-node-bevel{display:none}
.bb-edge-glow{fill:none;stroke-width:9;stroke-linecap:round;stroke-linejoin:round}
.bb-edge-glow.is-planned{display:none}
.bb-node.status-planned .bb-node-box{stroke-dasharray:6 4}
.bb-node.status-planned .bb-band{fill-opacity:.28;stroke-opacity:0}
.bb-node.status-partial .bb-band-rest{fill-opacity:.28}
.bb-kicker{font-size:${TYPE.kicker.size}px;font-weight:800;letter-spacing:1.1px}
.bb-node-title{font-size:${TYPE.title.size}px;font-weight:${TYPE.title.weight}}
.bb-copy{font-size:${TYPE.copy.size}px}
.bb-hint{font-size:${TYPE.hint.size}px;font-weight:600}
.bb-badge{stroke-width:1}
.bb-badge-text{font-size:9.5px;font-weight:700;letter-spacing:.4px}
.bb-dot{stroke-width:1.3;fill:none}
.bb-edge{fill:none;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}
.bb-edge.control{stroke-dasharray:6 6}
.bb-edge.failure{stroke-dasharray:3 5}
.bb-edge.is-planned{opacity:.45}
.bb-label-bg{stroke-width:1}
.bb-label{font-size:${TYPE.label.size}px;font-weight:${TYPE.label.weight}}
.bb-legend-text{font-size:11px}
`;

const RESTRAINED_BASE = `
text{font-family:${FONT};font-variant-numeric:tabular-nums}
.bb-title{font-size:36px;font-weight:300;letter-spacing:-.015em}
.bb-subtitle{font-size:14px;font-weight:400}
.bb-kicker-top{font-size:10.5px;font-weight:500;letter-spacing:2.6px}
.bb-meta{font-size:11px;font-weight:400;letter-spacing:.03em}
.bb-meter-big{font-size:42px;font-weight:300;letter-spacing:-.02em}
.bb-meter-unit{font-size:17px;font-weight:300}
.bb-meter-track{stroke-width:1;fill:none}
.bb-meter-solid,.bb-meter-part{stroke-width:3;fill:none}
.bb-meter-part{stroke-dasharray:2 3}
.bb-rule{stroke-width:1;fill:none}
.bb-zone{stroke-width:1}
.bb-zone-kicker{font-size:10.5px;font-weight:500;letter-spacing:2.6px}
.bb-zone-title{font-size:21px;font-weight:400;letter-spacing:-.005em}
.bb-zone-sub{font-size:11.5px}
.bb-node-box{stroke-width:1}
.bb-node.status-planned .bb-node-box{stroke-dasharray:4 4}
.bb-kicker{font-size:10.5px;font-weight:500;letter-spacing:2.4px}
.bb-node-title{font-size:17px;font-weight:500;letter-spacing:-.005em}
.bb-copy{font-size:13.5px;font-weight:400}
.bb-hint{font-size:11.5px;font-weight:400;letter-spacing:.02em}
.bb-status-text{font-size:9.5px;font-weight:600;letter-spacing:1.9px}
.bb-dot{stroke-width:1.1;fill:none}
.bb-edge{fill:none;stroke-width:1.25;stroke-linejoin:round;stroke-linecap:round}
.bb-edge.control{stroke-dasharray:3 4}
.bb-edge.failure{stroke-dasharray:.1 4.5;stroke-width:1.8}
.bb-edge.is-planned{opacity:.4}
.bb-label{font-size:11.5px;font-weight:500;letter-spacing:.02em;paint-order:stroke;stroke-width:6px;stroke-linejoin:round}
.bb-legend-text{font-size:12px;font-weight:400}
.bb-finding-text{font-size:9px;font-weight:600;letter-spacing:1.6px}
.iso-face{stroke-width:.8;stroke-linejoin:round}
.bb-node.status-planned .iso-face{fill:none;stroke-dasharray:4 4;stroke-width:1}
.iso-hatch line{stroke-width:.8;opacity:.45}
.iso-label-knockout{paint-order:stroke;stroke-width:6px;stroke-linejoin:round}
`;

export const MOTION = {
  expressive: `
.bb-flow{fill:none;stroke-width:3.4;stroke-linecap:round;stroke-dasharray:.1 22;opacity:.95;animation:bb-flow 1.6s linear infinite}
@keyframes bb-flow{to{stroke-dashoffset:-22.1}}
@media (prefers-reduced-motion:reduce){.bb-flow{animation:none;opacity:0}}
`,
  // Calm: small, slow, sparse dots. Motion as a hint, not a light show.
  restrained: `
.bb-flow{fill:none;stroke-width:2.4;stroke-linecap:round;stroke-dasharray:.1 28;animation:bb-flow 2.6s linear infinite}
@keyframes bb-flow{to{stroke-dashoffset:-28.1}}
@media (prefers-reduced-motion:reduce){.bb-flow{animation:none;opacity:0}}
`,
};

export function structuralCss(style) {
  return style === "expressive" ? EXPRESSIVE_BASE : RESTRAINED_BASE;
}

// Expressive keeps its original split: theme colours, status/pseudo colours, paint.
function expressiveCss(theme, categories, scope, { iso }) {
  return themeCss(theme, categories, scope) + expressiveDotCss(theme, scope) + paintCss(theme, categories, scope, { iso });
}

function expressiveDotCss(theme, scope = "") {
  const p = scope ? `${scope} ` : "";
  const s = theme.surfaces;
  return `${p}.bb-dot{stroke:${s.text}}${p}.bb-dot-fill{fill:${s.text}}` +
    `${p}.bb-pseudo-fill{fill:${s.text}}${p}.bb-pseudo-ring{fill:${s.canvas};stroke:${s.text};stroke-width:1.6}${p}.bb-pseudo-choice{fill:${s.panel}}` +
    `${p}.bb-finding-bg{fill:${s.canvas};stroke:${theme.edges.failure};stroke-width:1.2}${p}.bb-finding-text{fill:${theme.edges.failure};font-size:9.5px;font-weight:800;letter-spacing:.4px}` +
    `${p}.bb-node.has-finding .bb-node-box{stroke:${theme.edges.failure};stroke-width:2}${p}.bb-finding-inline{fill:${theme.edges.failure}}`;
}

// Pastel: same hue, softer. Dark canvas: soft and chalky (L 0.58-0.64).
// Light paper: deep but quiet (L 0.34-0.46). Saturation lives in a band so
// vivid hues calm down and dull ones (slate, mauve) keep their identity.
export function pastel(theme, c) {
  return theme.mode === "dark"
    ? pastelize(c, { l: [0.58, 0.64], s: [0.24, 0.42] })
    : pastelize(c, { l: [0.34, 0.46], s: [0.22, 0.42] });
}

// Restrained: one complete sheet. Tone separates planes; a single hairline weight
// draws structure; category hue returns as matte pastel tints, graded by role
// (solid marks > kicker text > outlines > card fill > zone plate), never glow.
function restrainedCss(theme, categories, scope, { iso, categoryTheme = theme }) {
  const s = theme.surfaces;
  const cs = categoryTheme.surfaces;
  const cdark = categoryTheme.mode === "dark";
  const categoryCard = cdark ? mix(cs.canvas, cs.panel, 0.42) : cs.panel;
  const dark = theme.mode === "dark";
  const p = (sel) => sel.split(",").map((x) => `${scope}${scope ? " " : ""}${x.trim()}`).join(",");
  const hair = mix(s.canvas, s.text, dark ? 0.13 : 0.15);
  const hairStrong = mix(s.canvas, s.text, dark ? 0.24 : 0.28);
  const card = dark ? mix(s.canvas, s.panel, 0.42) : s.panel;
  const plate = mix(s.canvas, s.text, dark ? 0.022 : 0.028);
  const quiet = (c) => mix(s.canvas, c, dark ? 0.7 : 0.82);
  const e = theme.edges;
  const rules = [
    [".bb-canvas", `fill:${s.canvas}`],
    [".bb-title,.bb-zone-title,.bb-node-title,.bb-meter-big,.bb-meter-unit", `fill:${s.text}`],
    [".bb-subtitle,.bb-copy,.bb-hint,.bb-legend-text,.bb-meta,.bb-kicker,.bb-zone-kicker,.bb-kicker-top,.bb-zone-sub", `fill:${s.muted}`],
    [".bb-rule,.bb-meter-track", `stroke:${hair}`],
    [".bb-meter-solid", `stroke:${s.text}`],
    [".bb-meter-part", `stroke:${s.muted}`],
    [".bb-zone", `fill:${plate};stroke:${hair}`],
    [".bb-node-box", `fill:${card};stroke:${hair}`],
    [".bb-node.status-planned .bb-node-box", `fill:none;stroke:${hairStrong}`],
    [".bb-node.status-planned .bb-node-title", `fill:${s.muted}`],
    [".bb-status-text", `fill:${s.muted}`],
    [".bb-status.is-implemented .bb-status-text", `fill:${s.muted}`],
    [".bb-dot", `stroke:${s.muted}`],
    [".bb-dot-fill", `fill:${s.muted}`],
    [".bb-status.is-implemented .bb-dot", `stroke:${s.text}`],
    [".bb-status.is-implemented .bb-dot-fill", `fill:${s.text}`],
    [".bb-edge.data", `stroke:${quiet(e.data)}`],
    [".bb-edge.control", `stroke:${quiet(e.control)}`],
    [".bb-edge.failure", `stroke:${e.failure}`],
    [".bb-arrow.data", `fill:${quiet(e.data)}`],
    [".bb-arrow.control", `fill:${quiet(e.control)}`],
    [".bb-arrow.failure", `fill:${e.failure}`],
    [".bb-label,.iso-label-knockout", `stroke:${s.canvas}`],
    [".bb-label.data", `fill:${s.muted}`],
    [".bb-label.control", `fill:${mix(e.control, s.text, 0.25)}`],
    [".bb-label.failure", `fill:${e.failure}`],
    [".bb-flow", `stroke:${s.text};stroke-opacity:.55`],
    [".bb-finding-text,.bb-finding-inline", `fill:${e.failure}`],
    [".bb-node.has-finding .bb-node-box", `stroke:${e.failure}`],
    [".bb-pseudo-fill", `fill:${s.text}`],
    [".bb-pseudo-ring", `fill:${s.canvas};stroke:${s.text};stroke-width:1.3`],
    [".bb-pseudo-choice", `fill:${card}`],
    [".bb-node.is-selected .bb-node-box,.bb-node[tabindex]:focus .bb-node-box", `stroke:${s.text}`],
  ];
  for (const [id, cat] of Object.entries(categories)) {
    const c = categoryColor(categoryTheme, cat.color ?? id);
    const pc = pastel(categoryTheme, c);
    const textPc = categoryTheme === theme ? pc : pastel(theme, categoryColor(theme, cat.color ?? id));
    rules.push(
      [`.cat-${id} .bb-mark,.bb-mark.cat-${id}`, `fill:${pc}`],
      [`.cat-${id} .bb-kicker,.cat-${id} .bb-zone-kicker`, `fill:${mix(textPc, s.muted, dark ? 0.2 : 0.1)}`],
      [`.cat-${id} .bb-node-box`, `fill:${mix(categoryCard, pc, cdark ? 0.16 : 0.11)};stroke:${mix(categoryCard, pc, cdark ? 0.36 : 0.38)}`],
      [`.cat-${id}.status-planned .bb-node-box`, `fill:none;stroke:${mix(cs.canvas, pc, cdark ? 0.45 : 0.5)}`],
      [`.bb-zone.cat-${id}`, `fill:${mix(cs.canvas, pc, cdark ? 0.07 : 0.06)};stroke:${mix(cs.canvas, pc, cdark ? 0.26 : 0.32)}`],
    );
    if (iso) {
      // Painted-model blocks: roof lightest, faces stepped down, set directly in
      // HSL in both modes so the hue never shifts (mixing toward the canvas made
      // dark faces muddy and light faces chalk-white). Both modes target the same
      // chroma: chroma ~ S * (1 - |2L - 1|), so the lighter light-mode faces need
      // about 1.5x the saturation band to show as much colour as the dark ones.
      const [lights, band] = cdark
        ? [[0.64, 0.54, 0.45, 0.36], [0.14, 0.22]]
        : [[0.76, 0.66, 0.57, 0.48], [0.21, 0.33]];
      const face = (l) => pastelize(c, { l: [l, l], s: band });
      const [roof, left, right, edge] = lights.map(face);
      rules.push(
        [`.cat-${id} .iso-roof`, `fill:${roof};stroke:${edge}`],
        [`.cat-${id} .iso-left`, `fill:${left};stroke:${edge}`],
        [`.cat-${id} .iso-right`, `fill:${right};stroke:${edge}`],
        [`.cat-${id}.status-planned .iso-face`, `stroke:${c}`],
      );
    }
  }
  if (iso) {
    rules.push(
      [".iso-shadow", `fill:${dark ? "#000000" : "#3b2f26"};fill-opacity:${dark ? 0.32 : 0.08}`],
      [".iso-hatch line", `stroke:${s.canvas}`],
      [".iso-tag-bg,.iso-label-bg", `fill:${s.canvas};fill-opacity:.9`],
      [".bb-label.plain", `stroke:none`],
      [".bb-node:not([class*=cat-]) .iso-face", `fill:${card};stroke:${hair}`],
    );
  }
  return rules.map(([sel, decl]) => `${p(sel)}{${decl}}`).join("\n");
}

export function styleCss(theme, categories, { style, scope = "", iso = false, categoryTheme } = {}) {
  return style === "expressive" ? expressiveCss(theme, categories, scope, { iso }) : restrainedCss(theme, categories, scope, { iso, categoryTheme });
}

// Restrained needs no paint servers; expressive keeps its gradients and filters.
export function styleDefs(theme, categories, { style, iso = false } = {}) {
  return style === "expressive" ? paintDefs(theme, categories, { iso }) : "";
}
