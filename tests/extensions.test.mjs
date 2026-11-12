import test from "node:test";
import assert from "node:assert/strict";
import { createExtensions } from "../lib/extensions.mjs";
import { normalise, BowerError } from "../lib/model.mjs";
import { layout } from "../lib/layout.mjs";
import { renderSvg } from "../lib/render-svg.mjs";
import { renderHtml } from "../lib/render-html.mjs";
import { loadTheme } from "../lib/themes.mjs";
const light = loadTheme("light"), dark = loadTheme("dark");

const input = { schema: "bowerbird/v1", meta: { title: "Hook" }, nodes: [{ id: "n", title: "Node", at: [0, 0] }], edges: [] };

test("extensions run in registration order for one diagram only", () => {
  const events = [];
  const extension = (name) => ({
    validate: (_input, fail) => { events.push(`validate:${name}`); if (_input.reject) fail("extension", name); },
    normalise: (model) => { events.push(`normalise:${name}`); model.extra ??= []; model.extra.push(name); },
    layout: (_model, lay) => { events.push(`layout:${name}`); lay.extra ??= []; lay.extra.push(name); },
    svg: () => { events.push(`svg:${name}`); return `<g data-extension="${name}"/>`; },
    html: () => { events.push(`html:${name}`); return `<aside data-extension="${name}"></aside>`; },
  });
  const extensions = createExtensions(extension("a"), extension("b"));
  const model = normalise(input, { extensions });
  const lay = layout(model);
  assert.deepEqual(model.extra, ["a", "b"]);
  assert.deepEqual(lay.extra, ["a", "b"]);
  assert.match(renderSvg(model, lay, { theme: light }), /data-extension="a"\/>\n<g data-extension="b"/);
  assert.match(renderHtml(model, lay, { light, dark }), /data-extension="a"><\/aside><aside data-extension="b"/);
  assert.deepEqual(events.slice(0, 6), ["validate:a", "validate:b", "normalise:a", "normalise:b", "layout:a", "layout:b"]);
  const plain = normalise(input);
  assert.equal(plain.extra, undefined);
  assert.doesNotMatch(renderSvg(plain, layout(plain), { theme: light }), /data-extension/);
  assert.throws(() => normalise({ ...input, reject: true }, { extensions }), (error) => error instanceof BowerError && error.problems[0].code === "extension");
});
