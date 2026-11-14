export const state = ({ count }) => `Count ${count.value}`;
export const regions = ({ count }) => ({ Order: { phase: Number(count.value) < 2 ? "idle" : "done" }, Audit: { check: Number(count.value) % 2 ? "yes" : "no" } });
