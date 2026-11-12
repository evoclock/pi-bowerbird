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

// Why: registered fields should be checked and carried into the model without feature-specific imports.
test("registered fields validate and normalise at each supported scope", () => {
  const fields = {
    node: { badge: { validate: (value, fail) => { if (typeof value !== "string") fail("badge", "must be text"); }, normalise: (value) => value.toUpperCase() } },
    zone: { tag: { normalise: (value) => value.toUpperCase() } },
    edge: { weight: { normalise: (value) => value * 2 } },
    meta: { edition: { normalise: (value) => value.toUpperCase() } },
    top: { source: { normalise: (value) => value.toUpperCase() } },
  };
  const diagram = { ...input, meta: { ...input.meta, edition: "first" }, source: "local",
    zones: [{ id: "z", tag: "area" }], nodes: [{ ...input.nodes[0], badge: "ready" }],
    edges: [{ from: "n", to: "m", weight: 3 }],
  };
  // Use a valid second node so only the field behavior is under test.
  diagram.nodes.push({ id: "m", title: "Other", at: [1, 0] });
  const model = normalise(diagram, { extensions: [{ fields }] });
  assert.equal(model.nodes[0].badge, "READY");
  assert.equal(model.zones[0].tag, "AREA");
  assert.equal(model.edges[0].weight, 6);
  assert.equal(model.meta.edition, "FIRST");
  assert.equal(model.source, "LOCAL");
  assert.throws(() => normalise({ ...diagram, nodes: [{ ...diagram.nodes[0], badge: 42 }, diagram.nodes[1]] }, { extensions: [{ fields }] }),
    (error) => error instanceof BowerError && error.problems.some((p) => p.code === "badge" && p.message.includes("node \"n\".badge")));
});

// Why: ambiguous ownership must fail before any extension can silently overwrite another.
test("duplicate field claims fail with the scope and name", () => {
  const extensions = [{ fields: { node: { badge: {} } } }, { fields: { node: { badge: {} } } }];
  assert.throws(() => normalise(input, { extensions }), /node.badge.*claimed by more than one extension/);
});

// Why: diagrams without selected extensions must retain their previous unknown-field behavior.
test("unregistered fields keep the existing behavior", () => {
  const diagram = { ...input, source: "ignored", meta: { ...input.meta, edition: "kept" }, nodes: [{ ...input.nodes[0], badge: "kept" }] };
  const model = normalise(diagram);
  assert.equal(model.source, undefined);
  assert.equal(model.meta.edition, "kept");
  assert.equal(model.nodes[0].badge, "kept");
});

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
