import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// shared/vault.js is a plain script (it must run as a content script), so load it the way a browser would.
vm.runInThisContext(readFileSync(new URL("../shared/vault.js", import.meta.url), "utf8"));
const vault = globalThis.TTDQF.vault;
const fast = { iterations: 1000 }; // keep the KDF cheap in tests; production uses vault.ITERATIONS

// In-memory stand-in for browser.storage.{local,session}.
function fakeExt({ withSession = true } = {}) {
  const area = () => {
    const store = new Map();
    return {
      store,
      async get(defaults) {
        const out = {};
        for (const [k, d] of Object.entries(defaults)) out[k] = store.has(k) ? structuredClone(store.get(k)) : d;
        return out;
      },
      async set(items) { for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v)); },
      async remove(keys) { for (const k of [].concat(keys)) store.delete(k); },
    };
  };
  const ext = { storage: { local: area() } };
  if (withSession) ext.storage.session = area();
  return ext;
}

const pilgrims = [{ id: "p1", name: "Rama", age: "34", gender: "Male", idType: "Aadhaar Card", idNumber: "999912345676", selected: true }];
const contact = { city: "Tirupati", pincode: "517501" };

test("default KDF cost is OWASP's PBKDF2-SHA256 figure", () => {
  assert.equal(vault.ITERATIONS, 600000);
});

test("seal/open round-trips and a wrong passphrase or tampering fails", async () => {
  const { box, key } = await vault.create("correct horse", { pilgrims, contact }, fast);
  assert.ok(vault.isBox(box));
  assert.equal(box.kdf.iterations, 1000);
  assert.deepEqual(await vault.open(key, box), { pilgrims, contact });
  assert.equal(await vault.unlock("wrong horse", box), null);
  assert.ok(await vault.unlock("correct horse", box));

  const tampered = { ...box, data: box.data.slice(0, -4) + (box.data.endsWith("AAAA") ? "BBBB" : "AAAA") };
  await assert.rejects(vault.open(key, tampered));
  assert.equal(await vault.unlock("correct horse", tampered), null);

  // Two seals of the same value differ (fresh IV) and both open.
  const again = await vault.reseal(key, { pilgrims, contact }, box);
  assert.notEqual(again.iv, box.iv);
  assert.deepEqual(await vault.open(key, again), { pilgrims, contact });
});

test("box contents are not readable without the key", async () => {
  const { box } = await vault.create("pw-pw-pw-pw", { pilgrims, contact }, fast);
  const raw = JSON.stringify(box);
  assert.ok(!raw.includes("999912345676"));
  assert.ok(!raw.includes("Rama"));
});

test("exported raw key re-imports and opens the box", async () => {
  const { box, key } = await vault.create("pw-pw-pw-pw", { pilgrims }, fast);
  const key2 = await vault.importKey(await vault.exportKey(key));
  assert.deepEqual(await vault.open(key2, box), { pilgrims });
});

test("storage layer: enable, lock, unlock, write, change, disable", async () => {
  const ext = fakeExt();
  await ext.storage.local.set({ pilgrims, contact });
  assert.deepEqual(await vault.read(ext), { protected: false, locked: false, pilgrims, contact });

  // enable() uses production iterations; one derivation is affordable in a test.
  await vault.enable(ext, "correct horse");
  assert.ok(vault.isBox(ext.storage.local.store.get("vault")));
  assert.equal(ext.storage.local.store.has("pilgrims"), false, "plain copy removed");
  assert.equal(ext.storage.local.store.has("contact"), false);
  await assert.rejects(vault.enable(ext, "x"), /already/);

  let state = await vault.read(ext);
  assert.deepEqual(state, { protected: true, locked: false, pilgrims, contact });

  await vault.lock(ext);
  state = await vault.read(ext);
  assert.deepEqual(state, { protected: true, locked: true, pilgrims: [], contact: {} });
  await assert.rejects(vault.write(ext, { contact: { city: "x" } }), /locked/);

  assert.equal(await vault.unlockWith(ext, "wrong"), false);
  assert.equal(await vault.unlockWith(ext, "correct horse"), true);
  await vault.write(ext, { contact: { city: "Chennai" } });
  state = await vault.read(ext);
  assert.deepEqual(state.contact, { city: "Chennai" });
  assert.deepEqual(state.pilgrims, pilgrims);

  assert.equal(await vault.changePassphrase(ext, "wrong", "new-pass-123"), false);
  assert.equal(await vault.changePassphrase(ext, "correct horse", "new-pass-123"), true);
  await vault.lock(ext);
  assert.equal(await vault.unlockWith(ext, "correct horse"), false);
  assert.equal(await vault.unlockWith(ext, "new-pass-123"), true);

  assert.equal(await vault.disable(ext, "nope"), false);
  assert.equal(await vault.disable(ext, "new-pass-123"), true);
  assert.equal(ext.storage.local.store.has("vault"), false);
  assert.deepEqual(await vault.read(ext), { protected: false, locked: false, pilgrims, contact: { city: "Chennai" } });
});

test("a leftover plain copy next to a box is discarded, and a stale session key locks", async () => {
  const ext = fakeExt();
  const { box, key } = await vault.create("pw-pw-pw-pw", { pilgrims, contact }, fast);
  await ext.storage.local.set({ vault: box, pilgrims: [{ name: "old plain" }] });
  await ext.storage.session.set({ vaultKey: await vault.exportKey(key) });
  const state = await vault.read(ext);
  assert.deepEqual(state.pilgrims, pilgrims);
  assert.equal(ext.storage.local.store.has("pilgrims"), false);

  const other = await vault.create("other", { pilgrims: [] }, fast);
  await ext.storage.session.set({ vaultKey: await vault.exportKey(other.key) });
  assert.equal((await vault.read(ext)).locked, true);
  assert.equal(ext.storage.session.store.has("vaultKey"), false, "stale key forgotten");
});

test("without storage.session the box stays locked between reads", async () => {
  const ext = fakeExt({ withSession: false });
  const { box } = await vault.create("pw-pw-pw-pw", { pilgrims }, fast);
  await ext.storage.local.set({ vault: box });
  assert.equal(await vault.unlockWith(ext, "pw-pw-pw-pw"), true);
  assert.equal((await vault.read(ext)).locked, true);
});
