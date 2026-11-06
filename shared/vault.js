// TTD Quick Fill — optional passphrase protection for the saved details.
//
// Off by default: pilgrims and contact details live as plain JSON in
// storage.local. When the user sets a passphrase, both are replaced by one
// sealed box:
//
//   { v: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt }, iv, data }
//
// The key is AES-256-GCM, derived from the passphrase with PBKDF2-HMAC-SHA256
// (600,000 iterations, OWASP's 2023 figure) and a random 16-byte salt. Every
// write uses a fresh 12-byte IV, and the box's purpose is bound in as
// associated data so a ciphertext cannot be replayed into another slot.
// GCM authenticates the data, so a wrong passphrase or a tampered box fails
// outright rather than yielding garbage: the data itself is the verifier.
//
// Once unlocked, the derived key is kept in storage.session (memory only,
// gone when the browser closes, never written to disk) so the passphrase is
// asked once per browser session. The passphrase itself is never stored, and
// there is no recovery: a forgotten passphrase means re-entering the details.
//
// Only trusted extension contexts (popup, background) can reach storage.session,
// so the content script never loads this file: it asks the background script
// for the details instead. Plain script (no modules) so it runs in the popup,
// in a service worker via importScripts, and in unit tests; it installs itself
// as globalThis.TTDQF.vault.
(() => {
  "use strict";
  const ITERATIONS = 600000;
  const VERSION = 1;
  const PURPOSE = "ttd-quick-fill vault v1";
  const BOX_KEY = "vault";           // storage.local slot for the sealed box
  const SESSION_KEY = "vaultKey";    // storage.session slot for the raw AES key
  const PLAIN_KEYS = ["pilgrims", "contact"];

  const subtle = globalThis.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
  const b64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x4000) s += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
    return btoa(s);
  };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // ----------------------------------------------------------------- crypto --
  async function deriveKey(passphrase, salt, iterations) {
    const material = await subtle.importKey("raw", te.encode(String(passphrase).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
    return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material,
      { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  }

  async function seal(key, value, kdf) {
    const iv = random(12);
    const data = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(PURPOSE) }, key, te.encode(JSON.stringify(value)));
    return { v: VERSION, kdf: { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: kdf.salt }, iv: b64(iv), data: b64(new Uint8Array(data)) };
  }

  async function open(key, box) {
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv), additionalData: te.encode(PURPOSE) }, key, unb64(box.data));
    return JSON.parse(td.decode(plain));
  }

  const isBox = (x) => !!x && x.v === VERSION && typeof x.iv === "string" && typeof x.data === "string"
    && x.kdf?.name === "PBKDF2" && typeof x.kdf.salt === "string" && Number.isInteger(x.kdf.iterations);

  /** New box under a new salt. `iterations` is overridable for tests only. */
  async function create(passphrase, value, { iterations = ITERATIONS } = {}) {
    const kdf = { iterations, salt: b64(random(16)) };
    const key = await deriveKey(passphrase, unb64(kdf.salt), iterations);
    return { box: await seal(key, value, kdf), key };
  }

  /** Re-seal new contents with the same key and KDF parameters (fresh IV). */
  const reseal = (key, value, box) => seal(key, value, box.kdf);

  /** The derived key when the passphrase opens the box, otherwise null. */
  async function unlock(passphrase, box) {
    if (!isBox(box)) return null;
    const key = await deriveKey(passphrase, unb64(box.kdf.salt), box.kdf.iterations);
    try { await open(key, box); return key; } catch { return null; }
  }

  const exportKey = async (key) => b64(new Uint8Array(await subtle.exportKey("raw", key)));
  const importKey = (raw) => subtle.importKey("raw", unb64(raw), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);

  // --------------------------------------------------------------- storage --
  // `ext` is the browser/chrome namespace (promise-returning APIs).
  const session = (ext) => ext.storage.session;

  async function sessionKey(ext) {
    if (!session(ext)) return null;
    try {
      const got = await session(ext).get({ [SESSION_KEY]: null });
      return got[SESSION_KEY] ? await importKey(got[SESSION_KEY]) : null;
    } catch { return null; } // no access from this context, or no session storage
  }
  async function remember(ext, key) {
    if (!session(ext)) return false;
    try { await session(ext).set({ [SESSION_KEY]: await exportKey(key) }); return true; } catch { return false; }
  }
  async function lock(ext) {
    try { await session(ext)?.remove(SESSION_KEY); } catch { /* nothing to forget */ }
  }

  /** { protected, locked, pilgrims, contact } — pilgrims/contact are empty while locked. */
  async function read(ext) {
    const got = await ext.storage.local.get({ [BOX_KEY]: null, pilgrims: [], contact: {} });
    const box = got[BOX_KEY];
    if (!isBox(box)) return { protected: false, locked: false, pilgrims: got.pilgrims, contact: got.contact };
    // A crash between writing the box and removing the plain copies leaves both; the box wins.
    if (got.pilgrims.length || Object.keys(got.contact).length) await ext.storage.local.remove(PLAIN_KEYS).catch(() => {});
    const key = await sessionKey(ext);
    if (key) {
      try {
        const value = await open(key, box);
        return { protected: true, locked: false, pilgrims: value.pilgrims ?? [], contact: value.contact ?? {} };
      } catch { await lock(ext); } // key from a previous passphrase
    }
    return { protected: true, locked: true, pilgrims: [], contact: {} };
  }

  /** Save a partial { pilgrims?, contact? }. Throws "locked" when protected and not unlocked. */
  async function write(ext, patch) {
    const got = await ext.storage.local.get({ [BOX_KEY]: null });
    if (!isBox(got[BOX_KEY])) return ext.storage.local.set(patch);
    const key = await sessionKey(ext);
    if (!key) throw new Error("locked");
    const current = await open(key, got[BOX_KEY]);
    await ext.storage.local.set({ [BOX_KEY]: await reseal(key, { ...current, ...patch }, got[BOX_KEY]) });
  }

  async function enable(ext, passphrase) {
    const state = await read(ext);
    if (state.protected) throw new Error("already protected");
    const { box, key } = await create(passphrase, { pilgrims: state.pilgrims, contact: state.contact });
    await ext.storage.local.set({ [BOX_KEY]: box });   // box first, plain copies second (see read)
    await ext.storage.local.remove(PLAIN_KEYS);
    await remember(ext, key);
  }

  /** True when the passphrase was right; the key is then kept for this browser session. */
  async function unlockWith(ext, passphrase) {
    const got = await ext.storage.local.get({ [BOX_KEY]: null });
    const key = await unlock(passphrase, got[BOX_KEY]);
    if (!key) return false;
    await remember(ext, key);
    return true;
  }

  /** Needs the passphrase again, not just an unlocked session. */
  async function disable(ext, passphrase) {
    const got = await ext.storage.local.get({ [BOX_KEY]: null });
    const key = await unlock(passphrase, got[BOX_KEY]);
    if (!key) return false;
    const value = await open(key, got[BOX_KEY]);
    await ext.storage.local.set({ pilgrims: value.pilgrims ?? [], contact: value.contact ?? {} });
    await ext.storage.local.remove(BOX_KEY);
    await lock(ext);
    return true;
  }

  async function changePassphrase(ext, current, next) {
    const got = await ext.storage.local.get({ [BOX_KEY]: null });
    const oldKey = await unlock(current, got[BOX_KEY]);
    if (!oldKey) return false;
    const value = await open(oldKey, got[BOX_KEY]);
    const { box, key } = await create(next, value);
    await ext.storage.local.set({ [BOX_KEY]: box });
    await remember(ext, key);
    return true;
  }

  const api = { ITERATIONS, create, reseal, open, unlock, isBox, exportKey, importKey,
    read, write, enable, disable, changePassphrase, unlockWith, lock, sessionKey };
  (globalThis.TTDQF ||= {}).vault = api;
})();
