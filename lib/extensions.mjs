// Extensions are selected for each diagram, never installed process-wide.
// Order is registration order. Hooks may mutate the fresh model/layout, but
// validation reports errors through fail(code, message) before normalisation.
const registry = Symbol("bowerbird extensions");

export function createExtensions(...entries) {
  const extensions = entries.flat();
  for (const ext of extensions) {
    if (!ext || typeof ext !== "object" || !["validate", "normalise", "layout", "svg", "html"].every((phase) => ext[phase] === undefined || typeof ext[phase] === "function")) {
      throw new TypeError("invalid bowerbird extension");
    }
  }
  return Object.freeze([...extensions]);
}

export function bindExtensions(model, extensions) {
  Object.defineProperty(model, registry, { value: extensions });
  return model;
}

export function runExtensions(model, phase, ...args) {
  const results = [];
  for (const ext of model[registry] ?? []) {
    if (ext[phase]) results.push(ext[phase](model, ...args));
  }
  return results;
}
