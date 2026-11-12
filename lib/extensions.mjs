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

// A field belongs to one extension per scope. Unknown fields continue through
// the model's existing path; only declared fields receive these callbacks.
export function collectFields(extensions) {
  const fields = new Map();
  for (const ext of extensions) {
    for (const [scope, declarations] of Object.entries(ext.fields ?? {})) {
      if (!["node", "zone", "edge", "meta", "top"].includes(scope) || !declarations || typeof declarations !== "object" || Array.isArray(declarations)) {
        throw new TypeError(`invalid bowerbird field scope "${scope}"`);
      }
      for (const [name, handler] of Object.entries(declarations)) {
        const key = `${scope}.${name}`;
        if (fields.has(key)) throw new TypeError(`field ${key} claimed by more than one extension`);
        if (!name || !handler || typeof handler !== "object" || Array.isArray(handler) ||
            !["validate", "normalise"].every((phase) => handler[phase] === undefined || typeof handler[phase] === "function")) {
          throw new TypeError(`invalid bowerbird field ${key}`);
        }
        fields.set(key, { scope, name, ...handler });
      }
    }
  }
  return fields;
}

export function applyFields(fields, input, model, fail, phase) {
  for (const { scope, name, validate, normalise } of fields.values()) {
    const sources = scope === "top" ? [input] : scope === "meta" ? [input?.meta] : input?.[`${scope}s`] ?? [];
    const targets = phase === "validate" ? null : scope === "top" ? [model] : scope === "meta" ? [model.meta] : model[`${scope}s`];
    sources.forEach((source, index) => {
      if (!source || !Object.hasOwn(source, name)) return;
      const path = scope === "top" ? name : scope === "meta" ? `meta.${name}` :
        `${scope} ${JSON.stringify(source.id ?? `#${index}`)}.${name}`;
      const fieldFail = (code, message) => fail(code, `${path}: ${message}`);
      if (phase === "validate") validate?.(source[name], fieldFail, source);
      else if (normalise) targets[index][name] = normalise(source[name], source);
      else if (scope === "top") targets[index][name] = source[name];
    });
  }
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
