// Render the listing previews (amo/previews/*.html → amo/previews/out/*.png, 1280x800) with headless
// Firefox, and with --upload replace the previews on addons.mozilla.org.
//   node amo/previews.mjs            # render only
//   node amo/previews.mjs --upload   # render, then upload (needs WEB_EXT_API_KEY/SECRET)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { jwt } from "./api.mjs";

const DIR = path.resolve(new URL(".", import.meta.url).pathname, "previews");
const OUT = path.join(DIR, "out");
const FIREFOX = process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox";
const ADDON = "ttd-quick-fill";
const PREVIEWS = [
  ["1-popup", "Save each pilgrim once. Tick who is travelling; the details stay in this browser only."],
  ["2-fill", "One click on the TTD pilgrim-details page types the saved details into the form. It never presses Continue or Pay."],
  ["3-srivani", "The Srivani Trust booking form is filled too, row by row, with age, gender and proof type selected."],
  ["4-security", "Optional passphrase protection encrypts the saved details on your device (AES-256-GCM); asked once per browser session."],
];

fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(OUT, ".profile-"));
fs.writeFileSync(path.join(profile, "user.js"), `
user_pref("ui.systemUsesDarkTheme", 0);
user_pref("layout.css.prefers-color-scheme.content-override", 1);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
`);
for (const [name] of PREVIEWS) {
  const png = path.join(OUT, name + ".png");
  execFileSync(FIREFOX, ["--headless", "-no-remote", "--profile", profile, "--window-size=1280,800",
    "--screenshot", png, "file://" + path.join(DIR, name + ".html")], { stdio: "ignore" });
  console.log("rendered", path.relative(process.cwd(), png));
}
fs.rmSync(profile, { recursive: true, force: true });

if (process.argv.includes("--upload")) {
  const base = `https://addons.mozilla.org/api/v5/addons/addon/${ADDON}/`;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  // AMO throttles writes; honour its "Expected available in N seconds" and retry.
  const call = async (method, url, body, json = true) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { method, body, headers: { Authorization: `JWT ${jwt()}`, ...(json && body ? { "Content-Type": "application/json" } : {}) } });
      const text = await res.text();
      if (res.status === 429 && attempt < 6) {
        const wait = Number(text.match(/in (\d+) second/)?.[1] ?? 60) + 2;
        console.log(`  throttled, waiting ${wait}s`); await pause(wait * 1000); continue;
      }
      if (!res.ok && res.status !== 404) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    }
  };
  // Reconcile: keep previews whose caption already matches, upload the rest, delete everything else.
  // Safe to re-run after a failure part-way through.
  const existing = (await call("GET", base)).previews;
  const keep = new Set();
  for (const [i, [name, caption]] of PREVIEWS.entries()) {
    let p = existing.find((x) => x.caption?.["en-US"] === caption && !keep.has(x.id));
    if (!p) {
      const form = new FormData();
      form.set("image", new Blob([fs.readFileSync(path.join(OUT, name + ".png"))], { type: "image/png" }), name + ".png");
      p = await call("POST", base + "previews/", form, false);
      await pause(3000);
      await call("PATCH", `${base}previews/${p.id}/`, JSON.stringify({ caption: { "en-US": caption }, position: i }));
      console.log("uploaded", name, "→ preview", p.id);
    } else if (p.position !== i) {
      await call("PATCH", `${base}previews/${p.id}/`, JSON.stringify({ position: i }));
      console.log("repositioned", name, "→ preview", p.id);
    } else console.log("kept", name, "→ preview", p.id);
    keep.add(p.id);
    await pause(3000);
  }
  for (const x of existing.filter((x) => !keep.has(x.id))) { await call("DELETE", `${base}previews/${x.id}/`); console.log("deleted preview", x.id); await pause(3000); }
}
