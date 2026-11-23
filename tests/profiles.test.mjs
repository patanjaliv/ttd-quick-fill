import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

vm.runInThisContext(readFileSync(new URL("../shared/profiles.js", import.meta.url), "utf8"));
const profiles = globalThis.TTDQF.profiles;

const P = [{ id: "a", name: "Rama", selected: true }, { id: "b", name: "Sita", selected: false }, { id: "c", name: "Lava", selected: true }];
const fakeExt = (init = {}) => { const store = { ...init }; return { storage: { local: {
  get: async (defaults) => Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, k in store ? store[k] : v])),
  set: async (obj) => { Object.assign(store, obj); } } }, store }; };

test("choose: no active profile → the ticked pilgrims, as before", () => {
  const r = profiles.choose(P, [{ id: "f", name: "Family", pilgrimIds: ["b"] }], "");
  assert.deepEqual(r.pilgrims.map((p) => p.id), ["a", "c"]);
  assert.equal(r.profile, null);
});

test("choose: active profile → exactly its group, in its order, ignoring ticks", () => {
  const r = profiles.choose(P, [{ id: "f", name: "Family", pilgrimIds: ["c", "b"] }], "f");
  assert.deepEqual(r.pilgrims.map((p) => p.id), ["c", "b"]);
  assert.equal(r.profile.name, "Family");
});

test("choose: a deleted pilgrim is skipped; a missing profile falls back to ticks", () => {
  assert.deepEqual(profiles.choose(P, [{ id: "f", name: "F", pilgrimIds: ["zz", "a"] }], "f").pilgrims.map((p) => p.id), ["a"]);
  assert.deepEqual(profiles.choose(P, [], "gone").pilgrims.map((p) => p.id), ["a", "c"]);
});

test("list/save/setActive round-trip and ignore malformed entries", async () => {
  const ext = fakeExt({ profiles: [{ id: "f", name: "Family", pilgrimIds: ["a", 7] }, { bad: true }, null], activeProfile: 5 });
  const got = await profiles.list(ext);
  assert.deepEqual(got, { profiles: [{ id: "f", name: "Family", pilgrimIds: ["a"] }], active: "" });
  await profiles.save(ext, [{ id: "g", name: "Parents", pilgrimIds: ["b"] }]);
  await profiles.setActive(ext, "g");
  assert.deepEqual(await profiles.list(ext), { profiles: [{ id: "g", name: "Parents", pilgrimIds: ["b"] }], active: "g" });
});
