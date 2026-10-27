// Real-browser check of the HTML viewer's navigation: drags with real mouse
// input, then exercises zoom, fit, 100%, wheel zoom, and node clicks. Unit
// tests could not catch "controls stop working after panning"; this does.
// Skips when Chrome is not installed (e.g. Linux CI without a browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../lib/export.mjs";

const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withBrowser(fn) {
  const scratch = path.join(repo, "deprecated");
  mkdirSync(scratch, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(path.join(scratch, "chrome-prof-"));
  const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let wsUrl;
    for (let i = 0; i < 150 && !wsUrl; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === "page")?.webSocketDebuggerUrl; } catch {}
      if (!wsUrl) await sleep(200);
    }
    assert.ok(wsUrl, "chrome did not start");
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const waiting = new Map();
    ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
    try { await fn(send); } finally { ws.close(); }
  } finally {
    chrome.kill();
  }
}

test("viewer controls keep working after panning (flat and iso)", { skip: !existsSync(CHROME) && "Chrome not installed" }, async () => {
  const scratch = path.join(repo, "deprecated");
  mkdirSync(scratch, { recursive: true });
  const out = mkdtempSync(path.join(scratch, "test-out-"));
  const file = path.join(repo, "examples", "bowerbird.bower.json");
  const pages = [];
  for (const view of ["flat", "iso"]) {
    const dir = path.join(out, view);
    await build(file, { outDir: dir, formats: ["html"], view, repoRoot: repo });
    pages.push(path.join(dir, "bowerbird.html"));
  }
  await withBrowser(async (send) => {
    const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.result.value;
    const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
    const state = () => evalJs(`({ level: document.getElementById("zoom-level").textContent, t: document.getElementById("viewport").style.transform, scroll: document.getElementById("stage").scrollLeft + "," + document.getElementById("stage").scrollTop, drawer: !document.getElementById("drawer").hidden })`);
    const centre = (sel) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const click = async (sel) => { const p = await centre(sel); await mouse("mousePressed", p.x, p.y); await mouse("mouseReleased", p.x, p.y); await sleep(100); };
    const drag = async (x, y, dx, dy) => {
      await mouse("mousePressed", x, y);
      for (let i = 1; i <= 8; i++) await mouse("mouseMoved", x + (dx * i) / 8, y + (dy * i) / 8, { buttons: 1 });
      await mouse("mouseReleased", x + dx, y + dy);
      await sleep(100);
    };

    for (const page of pages) {
      await send("Page.navigate", { url: `file://${page}` });
      await sleep(1200);
      const fitted = await state();
      const stage = await centre("#stage");
      await click("#zoom-in");
      await drag(stage.x - 100, stage.y, 260, 140);
      const panned = await state();
      assert.notEqual(panned.t, fitted.t, `${page}: drag should pan`);
      await click("#zoom-in");
      assert.notEqual((await state()).level, panned.level, `${page}: zoom in after drag`);
      await click("#zoom-fit");
      const refit = await state();
      assert.equal(refit.t, fitted.t, `${page}: fit after drag restores the fitted view`);
      await drag(stage.x, stage.y + 50, -180, -90);
      await click("#zoom-level");
      assert.equal((await state()).level, "100%", `${page}: 100% after drag`);
      await click("#zoom-fit");
      await click(".bb-node[tabindex]");
      const opened = await state();
      assert.equal(opened.drawer, true, `${page}: node click opens details`);
      assert.equal(opened.scroll, "0,0", `${page}: stage never scrolls`);
      // Why: outside clicks must dismiss details without breaking X or node reopening.
      await click("#details-h");
      assert.equal((await state()).drawer, false, `${page}: outside click dismisses details`);
      await click(".bb-node[tabindex]");
      assert.equal((await state()).drawer, true, `${page}: node reopens after outside click`);
      await click("#drawer-close");
      assert.equal((await state()).drawer, false, `${page}: X dismisses details`);
      await click("#theme");
      await click(".bb-node[tabindex]");
      assert.equal((await state()).drawer, true, `${page}: light node opens details`);
      await click("#details-h");
      assert.equal((await state()).drawer, false, `${page}: light outside click dismisses details`);
      await click(".bb-node[tabindex]");
      await click("#drawer-close");
      assert.equal((await state()).drawer, false, `${page}: light X dismisses details`);
      if (page.includes("/flat/")) {
        // Why: the real toolbar toggles only the flat light node plane, not the category indicator or dark plane.
        const fill = () => evalJs(`getComputedStyle(document.querySelector(".bb-node.cat-sage .bb-node-box")).fill`);
        const dot = () => evalJs(`getComputedStyle(document.querySelector(".bb-node.cat-sage .bb-mark")).fill`);
        const dotsFill = await fill(), dotsMark = await dot();
        await click("#light-flat-fill");
        assert.notEqual(await fill(), dotsFill, `${page}: filled changes light node plane`);
        assert.equal(await dot(), dotsMark, `${page}: indicator is unchanged`);
        await click("#light-flat-fill");
        assert.equal(await fill(), dotsFill, `${page}: dots-only restores the neutral plane`);
      } else assert.equal(await evalJs(`document.getElementById("light-flat-fill") === null`), true);
      assert.equal(await evalJs(`document.documentElement.dataset.theme`), "light");
    }
  });
});
