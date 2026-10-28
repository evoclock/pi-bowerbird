// Interactive HTML: archify-style canvas and motion, with a detail drawer.
// Details live in real <details> cards (readable with JS off and in print);
// the drawer copies a card's content, so there is one source of truth.
import path from "node:path";
import { esc, markerDefs, svgBody, renderSvg, styleOf, fontFaceCss } from "./render-svg.mjs";
import { structuralCss, styleCss, styleDefs, MOTION } from "./styles.mjs";
import { mix } from "./themes.mjs";
import { markdown } from "./markdown.mjs";
import { statusSummary, PSEUDO } from "./model.mjs";

// Links in details are written relative to the repo root; rewrite them to be
// relative to the HTML file's directory so they resolve when opened locally.
function hrefRewriter({ repoRoot, outDir }) {
  return (href) => {
    if (/^([a-z]+:|#|\/)/i.test(href) || !repoRoot || !outDir) return href;
    return path.relative(outDir, path.join(repoRoot, href)).split(path.sep).join("/") || ".";
  };
}

// Page chrome: quiet and typographic in both styles. Hairlines instead of
// boxes, tracked uppercase labels, no shadows beyond the floating drawer.
const tokens = (t) => {
  const s = t.surfaces;
  const dark = t.mode === "dark";
  return `--bg:${s.canvas};--panel:${dark ? mix(s.canvas, s.panel, 0.42) : s.panel};--line:${mix(s.canvas, s.text, dark ? 0.13 : 0.15)};--ink:${s.text};--muted:${s.muted};--accent:${t.categories.sage}`;
};

const PAGE_CSS = (light, dark) => `
:root{color-scheme:light dark}
*{box-sizing:border-box}
html[data-theme=dark]{${tokens(dark)}}
html[data-theme=light]{${tokens(light)}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
a{color:var(--ink);text-decoration-color:var(--accent);text-decoration-thickness:1px;text-underline-offset:.22em}
a:hover{color:var(--accent)}
code{font:.84em ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.page{width:min(1680px,calc(100% - 48px));margin:0 auto}
.caps{font-size:.68rem;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:space-between;padding:14px 0;background:var(--bg);border-bottom:1px solid var(--line)}
.toolbar .group{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.toolbar label{margin-right:4px}
button,select{min-height:32px;padding:4px 12px;border:1px solid var(--line);border-radius:4px;background:transparent;color:var(--ink);font:inherit;font-size:.68rem;font-weight:500;letter-spacing:.16em;text-transform:uppercase;cursor:pointer}
button:hover,select:hover{border-color:var(--muted)}
button[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:var(--bg)}
select option{background:var(--bg);color:var(--ink);text-transform:none;letter-spacing:0}
:focus-visible{outline:1.5px solid var(--accent);outline-offset:3px}
.stage{position:relative;height:min(82vh,1100px);margin:24px 0;overflow:hidden;overflow:clip;border:1px solid var(--line);border-radius:6px;background:var(--bg);cursor:grab;touch-action:none;user-select:none}
.stage.panning{cursor:grabbing}
.stage:focus-visible{outline-offset:-2px}
.stage:fullscreen{height:100vh;border:0;border-radius:0}
.viewport{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.viewport svg{display:block}
.nav{position:absolute;top:12px;right:12px;z-index:2;display:flex;gap:4px;padding:4px;border:1px solid var(--line);border-radius:6px;background:var(--bg)}
.nav button{min-width:34px;min-height:30px;padding:0 9px;border-color:transparent;letter-spacing:.06em}
.nav button:hover{border-color:var(--line)}
.nav #zoom-level{min-width:58px;font-variant-numeric:tabular-nums}
.minimap{position:absolute;right:12px;bottom:12px;z-index:2;width:clamp(140px,16vw,220px);overflow:hidden;border:1px solid var(--line);border-radius:4px;background:var(--bg);cursor:crosshair;transition:opacity .25s ease}
.minimap img{display:block;width:100%;height:auto;pointer-events:none}
.minimap-frame{position:absolute;border:1.5px solid var(--accent);border-radius:2px;box-shadow:0 0 0 999px rgb(0 0 0 / 22%);pointer-events:none}
.stage.at-fit .minimap{opacity:0;pointer-events:none}
.stage-hint{position:absolute;left:14px;bottom:10px;z-index:2;margin:0;pointer-events:none;opacity:.8}
.stage:not(.at-fit) .stage-hint{opacity:0}
.bb-node[tabindex]{cursor:pointer}
.bb-node:has(.iso-focus):focus{outline:none}
.bb-node:focus .iso-focus,.bb-node.is-selected .iso-focus{stroke:var(--accent);stroke-width:7;stroke-linejoin:round}
.bb-node[tabindex]:hover .bb-node-box,.bb-node[tabindex]:focus .bb-node-box{stroke-width:1.6}
.bb-node.is-selected .bb-node-box{stroke-width:2}
.map-item{transition:opacity .25s ease}
.map-item.is-dimmed{opacity:.12}
html:not(.motion) .bb-flow{display:none}
.motion .bb-node{animation:bb-enter .6s cubic-bezier(.2,.7,.2,1) both}
@keyframes bb-enter{from{opacity:0}}
.drawer[hidden]{display:none}
.drawer{position:fixed;z-index:20;top:80px;right:24px;bottom:24px;display:flex;flex-direction:column;width:min(420px,calc(100vw - 48px));border:1px solid var(--line);border-radius:6px;background:var(--bg);box-shadow:0 24px 60px rgb(0 0 0 / 22%)}
.drawer.from-left{right:auto;left:24px}
.drawer-head{display:flex;gap:12px;justify-content:space-between;align-items:start;padding:20px 22px 16px;border-bottom:1px solid var(--line)}
.drawer-head p{margin:0 0 6px}
.drawer-head h2{margin:0;font-size:1.35rem;font-weight:400;letter-spacing:-.01em}
.drawer-head button{min-height:28px;padding:0 9px;letter-spacing:0;font-size:1rem}
.drawer-body{overflow:auto;padding:14px 22px 22px;font-size:.9rem}
.drawer-body h4,.detail h4{margin:18px 0 6px;color:var(--muted);font-size:.66rem;font-weight:500;letter-spacing:.2em;text-transform:uppercase}
.drawer-body ul,.detail ul{margin:6px 0;padding-left:16px}
.evidence-list{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);font-size:.84rem}
.evidence-list b{display:block;margin-bottom:4px;color:var(--muted);font-size:.66rem;font-weight:500;letter-spacing:.2em;text-transform:uppercase}
.details{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:0 32px;margin:40px 0 56px}
.details>h2{grid-column:1/-1;margin:0 0 12px;font-size:1.5rem;font-weight:300;letter-spacing:-.01em}
details.card{border-top:1px solid var(--line)}
details.card summary{padding:14px 0;cursor:pointer;font-weight:500;list-style:none;display:flex;gap:10px;align-items:baseline}
details.card summary::-webkit-details-marker{display:none}
details.card summary .st{margin-left:auto}
details.card .detail{padding:0 0 18px;font-size:.9rem;color:var(--ink)}
footer{padding:18px 0 32px;border-top:1px solid var(--line)}
@media (max-width:760px){.drawer,.drawer.from-left{top:auto;left:12px;right:12px;bottom:12px;width:auto;max-height:66vh}}
@media (prefers-reduced-motion:reduce){.map-item{transition:none}.motion .bb-node{animation:none}}
@media print{.toolbar,.drawer{display:none}details.card>*:not(summary){display:block!important}}
`;

const CLIENT_JS = `(() => {
  const root = document.documentElement;
  const svg = document.querySelector("#viewport svg");
  const themeHooks = [];
  const drawer = document.getElementById("drawer");
  const dTitle = document.getElementById("drawer-title");
  const dBody = document.getElementById("drawer-body");
  const items = [...svg.querySelectorAll(".map-item")];
  let active = null;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const key = "bowerbird:" + location.pathname;

  function setTheme(t) { root.dataset.theme = t; store.set(key + ":theme", t); document.getElementById("theme").textContent = t === "dark" ? "Light" : "Dark"; themeHooks.forEach((f) => f()); }
  function setLightFlatFill(fill) { root.dataset.lightFlatFill = fill; document.getElementById("light-flat-fill")?.setAttribute("aria-pressed", String(fill === "filled")); store.set(key + ":light-flat-fill", fill); themeHooks.forEach((f) => f()); }
  function setMotion(on) { root.classList.toggle("motion", on); document.getElementById("motion").setAttribute("aria-pressed", String(on)); store.set(key + ":motion", on ? "1" : "0"); }
  setTheme(store.get(key + ":theme") || root.dataset.theme);
  if (document.getElementById("light-flat-fill")) setLightFlatFill(store.get(key + ":light-flat-fill") || root.dataset.lightFlatFill);
  setMotion((store.get(key + ":motion") ?? (root.classList.contains("motion") ? "1" : "0")) === "1" && !matchMedia("(prefers-reduced-motion: reduce)").matches);
  document.getElementById("theme").onclick = () => setTheme(root.dataset.theme === "dark" ? "light" : "dark");
  document.getElementById("motion").onclick = () => setMotion(!root.classList.contains("motion"));
  if (document.getElementById("light-flat-fill")) document.getElementById("light-flat-fill").onclick = () => setLightFlatFill(root.dataset.lightFlatFill === "filled" ? "dots" : "filled");

  const trace = document.getElementById("trace");
  function applyTrace(v) {
    for (const el of items) {
      el.classList.remove("is-dimmed");
      if (v === "all") continue;
      const t = (el.dataset.traces || "").split(/\\s+/);
      if (!t.includes(v)) el.classList.add("is-dimmed");
    }
  }
  if (trace) trace.onchange = () => applyTrace(trace.value);

  function close(focus = true) {
    if (drawer.hidden) return;
    drawer.hidden = true; dBody.replaceChildren();
    if (active) { active.classList.remove("is-selected"); active.setAttribute("aria-expanded", "false"); if (focus) active.focus({ preventScroll: true }); }
    active = null;
  }
  function open(node) {
    if (active === node && !drawer.hidden) return close();
    const card = document.getElementById("detail-" + node.dataset.id);
    if (!card) return;
    if (active) { active.classList.remove("is-selected"); active.setAttribute("aria-expanded", "false"); }
    active = node; node.classList.add("is-selected"); node.setAttribute("aria-expanded", "true");
    dTitle.textContent = card.querySelector("summary .t").textContent;
    document.getElementById("drawer-kicker").textContent = card.dataset.kicker || "Component";
    dBody.innerHTML = card.querySelector(".detail").innerHTML;
    const b = node.getBoundingClientRect();
    drawer.classList.toggle("from-left", b.left + b.width / 2 > innerWidth / 2);
    drawer.hidden = false;
    document.getElementById("drawer-close").focus({ preventScroll: true });
  }
  for (const node of svg.querySelectorAll(".bb-node[data-id]")) {
    node.setAttribute("aria-controls", "drawer"); node.setAttribute("aria-expanded", "false");
    node.addEventListener("click", () => open(node));
    node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(node); } });
  }
  document.getElementById("drawer-close").onclick = () => close();
  document.addEventListener("click", (e) => {
    if (!drawer.hidden && !drawer.contains(e.target) && !e.target.closest(".bb-node[data-id]")) close(false);
  });
  addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input,select,textarea")) return;
    if (e.key === "Escape") close();
    if (e.key === "t" || e.key === "T") document.getElementById("theme").click();
    if (e.key === "m" || e.key === "M") document.getElementById("motion").click();
  });

  // Client-side export: rebuild a standalone SVG with the active theme's
  // resolved CSS (no viewer state), then rasterise through a canvas.
  const styles = JSON.parse(document.getElementById("bb-standalone-css").textContent);
  function standalone() {
    const clone = svg.cloneNode(true);
    clone.querySelectorAll(".is-dimmed,.is-selected").forEach((el) => el.classList.remove("is-dimmed", "is-selected"));
    clone.querySelectorAll(".bb-flow").forEach((el) => el.remove());
    clone.querySelector("style").textContent = styles[root.dataset.theme === "light" && root.dataset.lightFlatFill === "filled" ? "lightFilled" : root.dataset.theme];
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return new XMLSerializer().serializeToString(clone);
  }
  const base = document.body.dataset.basename;
  function save(blob, ext) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = base + "." + root.dataset.theme + "." + ext; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function raster(type, ext) {
    const img = new Image();
    const vb = svg.viewBox.baseVal;
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = vb.width * 2; c.height = vb.height * 2;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => b && save(b, ext), type, 0.92);
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(standalone());
  }
  document.getElementById("export").onchange = (e) => {
    const v = e.target.value; e.target.value = "";
    if (v === "svg") save(new Blob([standalone()], { type: "image/svg+xml" }), "svg");
    if (v === "png") raster("image/png", "png");
    if (v === "webp") raster("image/webp", "webp");
  };

  // ---- Navigation: zoom, pan, fit, fullscreen, minimap ---------------------
  // The SVG keeps its natural size inside a transformed viewport, so text stays
  // crisp at any zoom and node positions map 1:1 to diagram coordinates.
  const stage = document.getElementById("stage");
  const vp = document.getElementById("viewport");
  const level = document.getElementById("zoom-level");
  const vb = svg.viewBox.baseVal;
  const W = vb.width, H = vb.height;
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  const MIN = 0.08, MAX = 4;
  let k = 1, tx = 0, ty = 0, atFit = true;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const box = () => stage.getBoundingClientRect();
  const fitScale = () => { const r = box(); return Math.min((r.width - 40) / W, (r.height - 40) / H); };

  function apply() {
    vp.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + k + ")";
    level.textContent = Math.round(k * 100) + "%";
    stage.classList.toggle("at-fit", atFit);
    drawMiniFrame();
  }
  function fit() {
    const r = box();
    k = clamp(fitScale(), MIN, MAX);
    tx = (r.width - W * k) / 2; ty = (r.height - H * k) / 2;
    atFit = true; apply();
  }
  function zoomAt(factor, cx, cy) {
    const nk = clamp(k * factor, MIN, MAX);
    tx = cx - (cx - tx) * (nk / k); ty = cy - (cy - ty) * (nk / k);
    k = nk; atFit = false; apply();
  }
  const zoomCenter = (f) => { const r = box(); zoomAt(f, r.width / 2, r.height / 2); };
  function actual() { const r = box(); zoomAt(1 / k, r.width / 2, r.height / 2); }
  function panBy(dx, dy) { tx += dx; ty += dy; atFit = false; apply(); }

  document.getElementById("zoom-in").onclick = () => zoomCenter(1.25);
  document.getElementById("zoom-out").onclick = () => zoomCenter(0.8);
  document.getElementById("zoom-fit").onclick = fit;
  level.onclick = actual;
  document.getElementById("fullscreen").onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen();
  };
  document.addEventListener("fullscreenchange", () => requestAnimationFrame(fit));

  // Ctrl/Cmd + wheel (and trackpad pinch, which reports ctrlKey) zooms at the
  // cursor. A plain wheel pans only once zoomed in, so the page still scrolls.
  stage.addEventListener("wheel", (e) => {
    const r = box();
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top); }
    else if (!atFit) { e.preventDefault(); panBy(-e.deltaX, -e.deltaY); }
  }, { passive: false });

  // Drag to pan anywhere; two pointers pinch-zoom. A drag never opens a node.
  const pointers = new Map();
  let moved = 0, pinch = null;
  stage.addEventListener("pointerdown", (e) => {
    // Every press starts fresh: a finished drag must never swallow the next
    // click (that broke the zoom buttons after panning).
    moved = 0;
    if (e.target.closest(".nav,.minimap")) return;
    // A new primary pointer means any earlier gesture is over; stale entries
    // would otherwise turn the next drag into a phantom pinch.
    if (e.isPrimary) { pointers.clear(); pinch = null; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  });
  stage.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), r = box();
      zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinch.d = d; moved += 10; return;
    }
    moved += Math.abs(dx) + Math.abs(dy);
    // Capture only once this is really a drag: capturing on pointerdown would
    // retarget the click away from the node and break the detail drawer.
    if (moved > 4) {
      if (!stage.hasPointerCapture(e.pointerId)) stage.setPointerCapture(e.pointerId);
      stage.classList.add("panning"); panBy(dx, dy);
    }
  });
  const release = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) stage.classList.remove("panning"); };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener("click", (e) => {
    if (moved > 4 && !e.target.closest(".nav,.minimap")) { e.stopPropagation(); e.preventDefault(); }
    moved = 0;
  }, true);

  // The stage must never scroll: focusing a node would scroll it to "reveal"
  // the node and shift every coordinate the transform relies on. CSS uses
  // overflow:clip; this guard covers browsers without it.
  stage.addEventListener("scroll", () => { stage.scrollLeft = 0; stage.scrollTop = 0; });
  // Keyboard focus on an off-screen node pans the view to it instead.
  stage.addEventListener("focusin", (e) => {
    const node = e.target.closest && e.target.closest(".bb-node");
    if (!node) return;
    const r = box(), b = node.getBoundingClientRect(), m = 40;
    let dx = 0, dy = 0;
    if (b.left < r.left + m) dx = r.left + m - b.left; else if (b.right > r.right - m) dx = r.right - m - b.right;
    if (b.top < r.top + m) dy = r.top + m - b.top; else if (b.bottom > r.bottom - m) dy = r.bottom - m - b.bottom;
    if (dx || dy) panBy(dx, dy);
  });
  stage.addEventListener("dblclick", (e) => {
    if (e.target.closest(".bb-node,.nav,.minimap")) return;
    const r = box(); zoomAt(e.shiftKey ? 0.6 : 1.6, e.clientX - r.left, e.clientY - r.top);
  });

  addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input,select,textarea")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "+" || e.key === "=") zoomCenter(1.25);
    else if (e.key === "-" || e.key === "_") zoomCenter(0.8);
    else if (e.key === "0" || e.key === "f" || e.key === "F") fit();
    else if (e.key === "1") actual();
    else if (document.activeElement === stage && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const s = e.shiftKey ? 200 : 60;
      panBy(e.key === "ArrowLeft" ? s : e.key === "ArrowRight" ? -s : 0, e.key === "ArrowUp" ? s : e.key === "ArrowDown" ? -s : 0);
    }
  });

  // Minimap: the standalone render as an image, with the current view framed.
  const mini = document.getElementById("minimap");
  const miniImg = document.getElementById("minimap-img");
  const frame = document.getElementById("minimap-frame");
  function paintMini() { miniImg.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(standalone()); }
  function drawMiniFrame() {
    const r = box(), m = mini.clientWidth / W;
    frame.style.left = (-tx / k) * m + "px"; frame.style.top = (-ty / k) * m + "px";
    frame.style.width = (r.width / k) * m + "px"; frame.style.height = (r.height / k) * m + "px";
  }
  function jump(e) {
    const mr = mini.getBoundingClientRect(), m = mini.clientWidth / W, r = box();
    const px = (e.clientX - mr.left) / m, py = (e.clientY - mr.top) / m;
    tx = r.width / 2 - px * k; ty = r.height / 2 - py * k; atFit = false; apply();
  }
  let miniDrag = false;
  mini.addEventListener("pointerdown", (e) => { miniDrag = true; mini.setPointerCapture(e.pointerId); jump(e); });
  mini.addEventListener("pointermove", (e) => { if (miniDrag) jump(e); });
  mini.addEventListener("pointerup", () => { miniDrag = false; });
  themeHooks.push(paintMini);
  paintMini();

  new ResizeObserver(() => { if (atFit) fit(); else drawMiniFrame(); }).observe(stage);
  fit();
})();`;

export function renderHtml(model, lay, {
  light, dark, defaultTheme = "dark", repoRoot, outDir, basename = "diagram", sourceBasename = basename, svgOverride, style, view = "flat",
  standaloneFor, font,
} = {}) {
  const st = styleOf(model, style);
  standaloneFor ??= (theme, fill) => renderSvg(model, lay, { theme, style: st, lightFlatFill: fill });
  const rewrite = hrefRewriter({ repoRoot, outDir });
  const cats = model.categories;
  const svgCss = structuralCss(st) +
    styleCss(dark, cats, { style: st, scope: "html[data-theme=dark]" }) +
    styleCss(light, cats, { style: st, scope: "html[data-theme=light][data-light-flat-fill=dots]", lightFlatFill: "dots" }) +
    styleCss(light, cats, { style: st, scope: "html[data-theme=light][data-light-flat-fill=filled]", lightFlatFill: "filled" }) + MOTION[st];
  const standaloneCss = { dark: extractStyle(standaloneFor(dark, "dots")), light: extractStyle(standaloneFor(light, "dots")), lightFilled: extractStyle(standaloneFor(light, "filled")) };
  const counts = statusSummary(model);
  const tracking = model.meta.statusTracking;
  const cards = model.nodes
    .filter((n) => !PSEUDO.has(n.shape) || n.details)
    .map((n) => {
      const evidence = n.evidence?.paths?.length
        ? `<div class="evidence-list"><b>Evidence</b><ul>${n.evidence.paths.map((p) => `<li><a href="${esc(rewrite(p))}"><code>${esc(p)}</code></a></li>`).join("")}${(n.evidence.tests ?? []).map((p) => `<li>test: <a href="${esc(rewrite(p))}"><code>${esc(p)}</code></a></li>`).join("")}</ul></div>`
        : "";
      const body = n.details ? markdown(n.details, rewrite) : `<p>${esc(n.lines.join(" · "))}</p>`;
      const stEl = tracking ? `<span class="st caps">${esc(n.status ?? "planned")}</span>` : "";
      return `<details class="card" id="detail-${esc(n.id)}" data-kicker="${esc(n.type ?? "Component")}"><summary><span class="t">${esc(n.title)}</span>${stEl}</summary><div class="detail">${body}${evidence}</div></details>`;
    })
    .join("\n");
  const traceSelect = model.traces.length
    ? `<label class="caps" for="trace">Trace</label><select id="trace"><option value="all">Show everything</option>${model.traces.map((t) => `<option value="${esc(t.id)}">${esc(t.label ?? t.id)}</option>`).join("")}</select>`
    : "";
  const summary = tracking ? `<span class="caps">${counts.implemented} built · ${counts.partial} partial · ${counts.planned} planned</span>` : "";
  const svg = svgOverride ?? `<svg viewBox="0 0 ${lay.width} ${lay.height}" role="group" aria-labelledby="bb-t" xmlns="http://www.w3.org/2000/svg"><title id="bb-t">${esc(model.meta.title)}</title><style>${svgCss}</style>${markerDefs(st)}${styleDefs(dark, cats, { style: st })}${styleDefs(light, cats, { style: st })}${svgBody(model, lay, { animate: true, interactive: true, style: st })}</svg>`;

  return `<!doctype html>
<html lang="en" data-theme="${defaultTheme}" data-light-flat-fill="${model.meta.lightFlatFill}"${model.meta.animation === "static" ? "" : ` class="motion"`}>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(model.meta.title)}</title>
<meta name="description" content="${esc(model.meta.description ?? model.meta.subtitle ?? "")}">
<meta name="generator" content="bowerbird">
${font ? `<style>${fontFaceCss(font)}</style>` : `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..800&display=swap">`}
<style>${PAGE_CSS(light, dark)}</style>
</head>
<body data-basename="${esc(basename)}">
<div class="page">
<div class="toolbar"><div class="group">${traceSelect}${summary}</div>
<div class="group"><button id="motion" type="button" aria-pressed="true" title="Toggle flow animation (M)">Motion</button><button id="theme" type="button" title="Toggle theme (T)">Light</button>${st === "restrained" && view === "flat" ? `<button id="light-flat-fill" type="button" aria-pressed="${model.meta.lightFlatFill === "filled"}" title="Fill light flat nodes with category colours">Filled nodes</button>` : ""}
<select id="export" aria-label="Export diagram"><option value="">Export…</option><option value="svg">SVG</option><option value="png">PNG (2×)</option><option value="webp">WebP (2×)</option></select></div></div>
<div class="stage at-fit" id="stage" tabindex="0" aria-label="Diagram canvas. Drag to pan, Ctrl or Cmd plus scroll to zoom, F to fit.">
<div class="viewport" id="viewport">${svg}</div>
<div class="nav" role="toolbar" aria-label="Zoom and navigation"><button id="zoom-out" type="button" aria-label="Zoom out (−)">−</button><button id="zoom-level" type="button" aria-label="Actual size (1)">100%</button><button id="zoom-in" type="button" aria-label="Zoom in (+)">+</button><button id="zoom-fit" type="button" aria-label="Fit to screen (F)">Fit</button><button id="fullscreen" type="button" aria-label="Fullscreen">⤢</button></div>
<div class="minimap" id="minimap" aria-hidden="true"><img id="minimap-img" alt=""><div class="minimap-frame" id="minimap-frame"></div></div>
<p class="stage-hint caps">Drag to pan · ⌘/Ctrl + scroll to zoom · F to fit</p>
</div>
<aside class="drawer" id="drawer" role="region" aria-labelledby="drawer-title" aria-live="polite" hidden><div class="drawer-head"><div><p class="caps" id="drawer-kicker">Component</p><h2 id="drawer-title"></h2></div><button id="drawer-close" type="button" aria-label="Close details">×</button></div><div class="drawer-body" id="drawer-body"></div></aside>
<section class="details" aria-labelledby="details-h"><h2 id="details-h">Components</h2>${cards}</section>
<footer class="caps">${esc(model.meta.title)}${model.meta.author ? ` · ${esc(model.meta.author)}` : ""} · generated by bowerbird from <code>${esc(sourceBasename)}.bower.json</code> · standalone HTML</footer>
</div>
<script type="application/json" id="bb-standalone-css">${JSON.stringify(standaloneCss).replace(/</g, "\\u003c")}</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}

function extractStyle(svg) {
  return svg.match(/<style>([\s\S]*?)<\/style>/)[1];
}
