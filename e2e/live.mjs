// Live-site check: opens a visible Firefox with the extension loaded (no proxy, no mock) on the
// real TTD site and keeps a Marionette session open for diagnostics. The person signs in and opens
// a booking form themselves; this script only inspects form structure and masked values.
//   node e2e/live.mjs            # watch and report
//   node e2e/live.mjs fill       # also press the on-page button once a form is detected
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { Marionette, sleep } from "./marionette.mjs";

const E2E = new URL(".", import.meta.url).pathname;
const ROOT = path.resolve(E2E, "..");
const profile = E2E + "work/live-profile";
const FIREFOX = process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox";
const doFill = process.argv.includes("fill");
const PORT = 2829;

fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(profile + "/user.js", `
user_pref("marionette.port", ${PORT});
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("extensions.webextOptionalPermissionPrompts", false);
`);
// ATTACH=1 reuses a Firefox already started by an earlier run (the sign-in survives).
if (!process.env.ATTACH) spawn(FIREFOX, ["-marionette", "-no-remote", "-profile", profile],
  { stdio: "ignore", env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } });
const m = new Marionette(PORT);
await m.connect();
await m.newSession();
await m.send("WebDriver:SetTimeouts", { pageLoad: 60000, script: 20000, implicit: 0 });
if (!process.env.ATTACH || process.env.RELOAD) {
  const addon = await m.installAddon(ROOT);
  console.log("extension loaded:", addon.value);
  await m.navigate("https://ttdevasthanams.ap.gov.in/");
}
console.log("Sign in in the Firefox window and open a pilgrim-details form. Watching all tabs...");

const mask = (v) => (v.length > 3 ? "*".repeat(v.length - 2) + v.slice(-2) : v ? "*" : "");
const INSPECT = `
  const vis = el => el.getClientRects().length > 0;
  const fields = [...document.querySelectorAll('input, select')].filter(vis).map(el => ({
    tag: el.tagName.toLowerCase(), type: el.type, name: el.name || null, id: el.id || null,
    placeholder: el.placeholder || null, disabled: el.disabled, readOnly: el.readOnly,
    role: el.getAttribute('role'), hasValue: !!el.value, value: el.value,
    options: el.tagName === 'SELECT' ? [...el.options].map(o => o.textContent.trim()).slice(0, 8) : undefined,
    errorNear: !!el.closest('div')?.parentElement?.querySelector('img[src*="erroricon"], [aria-invalid="true"]')
  }));
  return { path: location.pathname, title: document.title, fab: !!document.getElementById('ttdqf-fab'),
    status: document.getElementById('ttdqf-status')?.textContent || null,
    lists: document.querySelectorAll('ul li[role="option"], li[role="option"]').length,
    buttons: [...document.querySelectorAll('button')].filter(vis).map(b => b.textContent.trim()).filter(Boolean).slice(0, 12),
    fields };`;

let lastPath = null, filled = false, lastSig = null;
for (;;) {
  await sleep(2500);
  // Look at every tab; report the one that has a form, else the last TTD tab.
  let info = null;
  try {
    const handles = (await m.send("WebDriver:GetWindowHandles")).value ?? (await m.send("WebDriver:GetWindowHandles"));
    for (const h of handles) {
      await m.switchTo(h);
      const url = (await m.send("WebDriver:GetCurrentURL")).value;
      if (!/ttdevasthanams|tirupatibalaji/.test(url)) continue;
      const i = await m.exec(INSPECT);
      if (!i) continue;
      i.tab = url;
      if (!info || i.fields.some(f => f.name)) info = i;
    }
  } catch (e) { console.log("(page busy:", e.message.split("\n")[0], ")"); continue; }
  if (!info) continue;
  const sig = JSON.stringify([info.path, info.fields.map(f => [f.name, f.disabled, f.hasValue]), info.status]);
  if (sig === lastSig) continue;
  lastSig = sig;
  if (info.path !== lastPath) { lastPath = info.path; console.log(`\n== ${new URL(info.tab).host}${info.path}  (${info.title})  fab=${info.fab}`); }
  const named = info.fields.filter(f => f.name);
  if (named.length) {
    console.log("fields:", named.map(f => `${f.tag}[name=${f.name}${f.type && f.type !== 'text' ? ' type=' + f.type : ''}]${f.disabled ? ' disabled' : ''}${f.readOnly ? ' readonly' : ''}${f.hasValue ? ' =' + mask(f.value) : ''}${f.errorNear ? ' ERR' : ''}${f.options ? ' opts=' + JSON.stringify(f.options) : ''}`).join("\n        "));
    if (info.buttons.length) console.log("buttons:", info.buttons.join(" | "));
  }
  if (info.status) console.log("extension status:", info.status);
  const looksLikeForm = named.some(f => /^fname$|^fName0$/.test(f.name));
  if (doFill && looksLikeForm && info.fab && !filled) {
    filled = true;
    console.log("pressing the on-page Fill pilgrims button...");
    try { await m.click(await m.find("#ttdqf-fab")); } catch (e) { console.log("click failed:", e.message); }
  }
}
