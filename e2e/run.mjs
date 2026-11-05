import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { Marionette, sleep } from "./marionette.mjs";
// End-to-end test: loads the extension into a throwaway headless Firefox profile via Marionette,
// serves a mock of the TTD pilgrim-details page at the real hostname (plain HTTP through a local
// proxy, so the production host check and content-script matches are exercised unchanged),
// then fills it from the on-page button and from the popup's message path.
//   FIREFOX_BIN=/path/to/firefox node e2e/run.mjs
const E2E = new URL(".", import.meta.url).pathname;
const S = E2E + "work/";
const FIREFOX = process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox";
const profile = S + "profile";
fs.rmSync(S, { recursive: true, force: true });
fs.mkdirSync(S + "out", { recursive: true });
// Test copy of the extension with an http:// match for the proxied hostname.
execFileSync("rsync", ["-a", "--exclude", "e2e", "--exclude", "dist", "--exclude", "node_modules", "--exclude", ".git", path.resolve(E2E, "..") + "/", S + "ext/"]);
const manifest = JSON.parse(fs.readFileSync(S + "ext/manifest.json", "utf8"));
manifest.host_permissions.push("http://ttdevasthanams.ap.gov.in/*");
manifest.content_scripts[0].matches.push("http://ttdevasthanams.ap.gov.in/*");
fs.writeFileSync(S + "ext/manifest.json", JSON.stringify(manifest, null, 2));
// Mock page + React UMD (downloaded once).
fs.cpSync(E2E + "mock", S + "mock", { recursive: true });
for (const [file, url] of [["react.js", "https://unpkg.com/react@18.3.1/umd/react.production.min.js"], ["react-dom.js", "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"]]) {
  const cached = E2E + "mock/" + file;
  if (!fs.existsSync(cached)) execFileSync("curl", ["-sfL", "-o", cached, url]);
  fs.copyFileSync(cached, S + "mock/" + file);
}
const server = spawn("python3", [E2E + "serve.py", S + "mock"], { stdio: "ignore" });
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(profile + "/user.js", `
user_pref("marionette.port", 2828);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("extensions.webextensions.remote", true);
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.webextOptionalPermissionPrompts", false);
user_pref("network.proxy.type", 1);
user_pref("network.proxy.http", "127.0.0.1");
user_pref("network.proxy.http_port", 8765);
user_pref("network.proxy.no_proxies_on", "");
user_pref("network.proxy.allow_hijacking_localhost", true);
user_pref("dom.security.https_first", false);
user_pref("dom.security.https_only_mode", false);
user_pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
`);
const ff = spawn(FIREFOX, ["-marionette", "-headless", "-no-remote", "-profile", profile], { stdio: "ignore", env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } });
const m = new Marionette();
const out = {};
try {
  await m.connect();
  const session = await m.newSession();
  out.firefox = session.capabilities.browserVersion;
  // Install the test build and discover its internal UUID (needed for the moz-extension:// popup URL).
  const addon = await m.installAddon(S + "ext");
  out.pass = false;
  out.addonId = addon.value;
  await m.setContext("chrome");
  const uuids = JSON.parse(await m.exec(`return Services.prefs.getStringPref("extensions.webextensions.uuids");`));
  await m.setContext("content");
  const uuid = uuids[out.addonId];
  const popupUrl = `moz-extension://${uuid}/popup/index.html`;

  // Seed storage via the popup page's extension context; also exercise the popup UI (add one pilgrim through the form).
  await m.navigate(popupUrl);
  await sleep(500);
  out.bannerShownBefore = await m.exec(`return !document.getElementById('perm-banner').hidden`);
  if (out.bannerShownBefore) { await m.click(await m.find("#grant-access")); await sleep(1000);
    out.bannerShownAfter = await m.exec(`return !document.getElementById('perm-banner').hidden`); }
  await m.execAsync(`const done = arguments[0]; browser.storage.local.set({
    pilgrims: [{ id: "p1", name: "Rama Krishna", age: "34", gender: "Male", idType: "Aadhaar Card", idNumber: "999912345676", selected: true }],
    contact: { email: "rama@example.in", city: "Tirupati", state: "Andhra Pradesh", country: "India", pincode: "517501" } }).then(() => done(true));`);
  await m.navigate(popupUrl); await sleep(400);
  await m.click(await m.find("#add-pilgrim"));
  for (const [k, v] of [["name", "Sita Devi"], ["age", "31"], ["idNumber", "999912345684"]]) {
    const id = await m.find(`#pilgrim-form [name="${k}"]`);
    await m.send("WebDriver:ElementSendKeys", { id, text: v });
  }
  await m.exec(`const f = document.querySelector('#pilgrim-form'); f.elements.gender.value = "Female"; f.elements.idType.value = "Aadhaar Card";`);
  await m.click(await m.find('#pilgrim-form button[type="submit"]'));
  await sleep(400);
  out.popupFormErrors = await m.exec(`return document.querySelector('#form-errors').textContent`);
  out.popupListNames = await m.exec(`return [...document.querySelectorAll('#pilgrim-list .who')].map(e => e.textContent)`);
  await m.screenshot(S + "out/popup.png");

  // Open the mock booking page and press the on-page button (a trusted click, as the handler requires).
  await m.navigate("http://ttdevasthanams.ap.gov.in/pilgrim-details");
  await sleep(800);
  out.pageUrl = (await m.send("WebDriver:GetCurrentURL")).value;
  out.pageTitle = await m.exec(`return document.title + " | rows=" + document.querySelectorAll('input[name=fname]').length + " | readyState=" + document.readyState + " | React=" + typeof React + "/" + typeof ReactDOM + " | errors=" + JSON.stringify(window.__errors) + " | scripts=" + [...document.scripts].map(s => s.src).join(",")`);
  out.fabPresent = !!(await m.exec(`return document.getElementById('ttdqf-fab')`));
  if (!out.fabPresent) {
    await sleep(1500);
    out.fabPresent = !!(await m.exec(`return document.getElementById('ttdqf-fab')`));
    const h = (await m.send("WebDriver:GetWindowHandle")).value;
    await m.newTab(); await m.navigate(popupUrl); await sleep(300);
    out.perms = await m.execAsync(`const done = arguments[0]; browser.permissions.getAll().then(done);`);
    out.statusProbe = await m.execAsync(`const done = arguments[0]; (async () => {
      const all = await browser.tabs.query({}); const [tab] = all.filter(t => /ttdevasthanams/.test(t.url || ""));
      if (!tab) { done({ allTabs: all.map(t => t.url) }); return; }
      done({ tabUrl: tab && tab.url, reply: await browser.tabs.sendMessage(tab.id, { type: "STATUS" }) }); })().catch(e => done({ error: String(e) }));`);
    await m.setContext("chrome");
    out.console = await m.exec(`return Services.console.getMessageArray().map(x => x.message).filter(t => /ttd|fill\.js|moz-extension|content script/i.test(t)).slice(-15);`);
    await m.setContext("content");
    await m.switchTo(h);
  }
  await m.click(await m.find("#ttdqf-fab"));
  await sleep(4000);
  out.status = await m.exec(`return document.getElementById('ttdqf-status')?.textContent`);
  out.domValues = await m.exec(`return [...document.querySelectorAll('input')].map(i => i.name + '=' + i.value)`);
  out.reactState = await m.exec(`return document.getElementById('state').textContent`);
  out.reactEvents = await m.exec(`return document.getElementById('events').textContent.split('\\n').length`);
  await m.screenshot(S + "out/page-after-fab.png");

  // Second path: the popup's message route (FILL via tabs.sendMessage) against a fresh form.
  await m.navigate("http://ttdevasthanams.ap.gov.in/pilgrim-details"); await sleep(800);
  const pageHandle = (await m.send("WebDriver:GetWindowHandle")).value;
  await m.newTab(); await m.navigate(popupUrl); await sleep(400);
  out.messageResult = await m.execAsync(`const done = arguments[0];
    (async () => { const [tab] = await browser.tabs.query({ url: "http://ttdevasthanams.ap.gov.in/*" });
      const { pilgrims, contact } = await browser.storage.local.get({ pilgrims: [], contact: {} });
      done(await browser.tabs.sendMessage(tab.id, { type: "FILL", pilgrims: pilgrims.filter(p => p.selected !== false), contact })); })().catch(e => done({ error: String(e) }));`);
  await m.switchTo(pageHandle);
  out.messageReactState = await m.exec(`return document.getElementById('state').textContent`);
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  await m.quit(); m.close(); ff.kill(); server.kill();
}
const filledBoth = (r) => r && r.ok && r.filled.length === 2 && r.warnings.length === 0;
const stateOk = (txt) => { try { const s = JSON.parse(txt); return s.rows[0].idProofNumber === "999912345676" && s.rows[1].gender === "Female" && s.general.pincode === "517501"; } catch { return false; } };
out.pass = !out.error && out.popupListNames?.length === 2 && /Filled 2 of 2/.test(out.status || "") && stateOk(out.reactState) && filledBoth(out.messageResult) && stateOk(out.messageReactState);
console.log(JSON.stringify(out, null, 1));
console.log(out.pass ? "E2E PASS" : "E2E FAIL");
process.exit(out.pass ? 0 : 1);
