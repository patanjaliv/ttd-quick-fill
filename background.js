// TTD Quick Fill — background script (Firefox event page / Chrome service worker).
//
// Its only job: hand the on-page "Fill pilgrims" button the saved details. The
// content script cannot read storage.session, where the vault key is kept after
// an unlock, so it asks here instead and never sees the key itself. Replies go
// only to this extension's own content script on the two TTD hosts.
if (typeof importScripts === "function") importScripts("shared/vault.js"); // Chrome; Firefox lists it in background.scripts
const ext = globalThis.browser ?? globalThis.chrome;
// The same origins the content script is allowed on (manifest host_permissions, e.g. "https://host/*").
const ORIGINS = (ext.runtime.getManifest().host_permissions || []).map((p) => p.replace(/\*$/, ""));
const fromTTD = (url) => ORIGINS.some((prefix) => (url || "").startsWith(prefix));

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "READ" || sender.id !== ext.runtime.id || !fromTTD(sender.url)) return undefined;
  globalThis.TTDQF.vault.read(ext)
    .then(({ locked, pilgrims, contact }) => sendResponse({ locked, pilgrims, contact }))
    .catch((err) => sendResponse({ locked: true, error: err?.message || String(err) }));
  return true;
});
