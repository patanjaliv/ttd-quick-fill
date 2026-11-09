// Records the demo video: the real extension in a headless Firefox, driven through the popup and
// the look-alike booking forms in demo/mock with sample data, captured frame by frame and stitched
// with ffmpeg plus a spoken narration (macOS `say`).
//   node demo/record.mjs            → demo/out/ttd-quick-fill-demo.mp4
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { Marionette, sleep } from "../e2e/marionette.mjs";

const DEMO = new URL(".", import.meta.url).pathname, ROOT = path.resolve(DEMO, ".."), E2E = ROOT + "/e2e/";
const W = DEMO + "work/", OUT = DEMO + "out/", FR = OUT + "frames/", AU = OUT + "audio/";
const FIREFOX = process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox";
const VOICE = process.env.VOICE || "Rishi";
const PORT = 2830;

const PILGRIMS = [
  { name: "Rama", age: "34", gender: "Male", idType: "Aadhaar Card", idNumber: "999912345678" },
  { name: "Krishna", age: "36", gender: "Male", idType: "Aadhaar Card", idNumber: "999912345684" },
  { name: "Sita", age: "31", gender: "Female", idType: "Aadhaar Card", idNumber: "999912345697" },
  { name: "Radha", age: "29", gender: "Female", idType: "Passport", idNumber: "K4171234" },
];
const CONTACT = { email: "rama@example.in", city: "Tirupati", state: "Andhra Pradesh", country: "India", pincode: "517501" };
const PASS = "my-secret-pass";

// Scenes: caption shown on screen, narration spoken. A scene lasts at least as long as its narration.
const SCENES = {
  title:    ["", "TTD Quick Fill is a free, open-source Firefox extension. It fills the pilgrim details on the TTD booking website for you. Here is how to use it."],
  install:  ["", "Install it from addons dot mozilla dot org. Search for TTD Quick Fill and click Add to Firefox."],
  add:      ["<b>Step 2</b> · Open the extension and add each pilgrim once<small>Name, age, gender and ID number. Stored only in this browser.</small>", "Open the extension from the toolbar and add each pilgrim once: the name, age, gender, and ID number. Everything is stored only in your browser."],
  more:     ["<b>Step 2</b> · Add the rest of the family<small>Tick the ones travelling this time.</small>", "Add everyone you usually book for. Before a booking, tick just the people travelling this time."],
  contact:  ["<b>Step 3</b> · Optional contact details<small>Used for the General Details section of the form.</small>", "You can also save the contact details that the General Details section asks for."],
  fill:     ["<b>Step 4</b> · On the pilgrim-details page, press <b>Fill pilgrims</b><small>It never presses Continue or Pay. You review and continue yourself.</small>", "When you reach the pilgrim details page, a Fill pilgrims button appears at the bottom right. One click, and the ticked pilgrims are filled in, row by row. The extension never presses Continue or Pay. You check the form and continue yourself."],
  srivani:  ["Works on the <b>Srivani Trust</b> booking form too", "It works on the Srivani Trust booking form as well."],
  protect:  ["<b>Optional</b> · Protect the saved details with a passphrase<small>Encrypted on your device. Asked once per browser session.</small>", "For extra safety, protect the saved details with a passphrase. They are then encrypted on your device, and you unlock them once per browser session."],
  end:      ["", "TTD Quick Fill is free and open source. Find it on addons dot mozilla dot org. Wishing you a smooth booking."],
};

// ------------------------------------------------------------------ setup --
fs.rmSync(W, { recursive: true, force: true }); fs.rmSync(OUT, { recursive: true, force: true });
for (const d of [W, FR, AU]) fs.mkdirSync(d, { recursive: true });
execFileSync("rsync", ["-a", "--exclude", "e2e", "--exclude", "demo", "--exclude", "dist", "--exclude", "node_modules", "--exclude", ".git", ROOT + "/", W + "ext/"]);
const manifest = JSON.parse(fs.readFileSync(W + "ext/manifest.json", "utf8"));
manifest.host_permissions.push("http://ttdevasthanams.ap.gov.in/*");
manifest.content_scripts[0].matches.push("http://ttdevasthanams.ap.gov.in/*");
fs.writeFileSync(W + "ext/manifest.json", JSON.stringify(manifest, null, 2));
fs.cpSync(DEMO + "mock", W + "mock", { recursive: true });
for (const f of ["react.js", "react-dom.js"]) fs.copyFileSync(E2E + "mock/" + f, W + "mock/" + f);

// Narration first, so each scene can be held for as long as its audio runs.
const narr = {};
for (const [key, [, text]] of Object.entries(SCENES)) {
  const f = `${AU}${key}.aiff`;
  execFileSync("say", ["-v", VOICE, "-o", f, text]);
  narr[key] = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
}

const server = spawn("python3", [E2E + "serve.py", W + "mock"], { stdio: "ignore" });
const profile = W + "profile"; fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(profile + "/user.js", `
user_pref("marionette.port", ${PORT});
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
user_pref("ui.systemUsesDarkTheme", 0);
user_pref("layout.css.prefers-color-scheme.content-override", 1);
user_pref("ui.caretBlinkTime", 0);
`);
const ff = spawn(FIREFOX, ["-marionette", "-headless", "-no-remote", "-profile", profile, "--window-size=1280,720"],
  { stdio: "ignore", env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } });
const m = new Marionette(PORT);

// --------------------------------------------------------------- recorder --
const frames = []; const t0 = Date.now(); const now = () => (Date.now() - t0) / 1000;
const scenes = []; let scene = null;
async function cap() {
  const r = await m.send("WebDriver:TakeScreenshot", { full: false });
  const f = `${FR}f${String(frames.length).padStart(5, "0")}.png`;
  fs.writeFileSync(f, Buffer.from(r.value, "base64"));
  frames.push({ f, t: now() });
}
async function hold(sec) { const end = Date.now() + sec * 1000; while (Date.now() < end) { await cap(); await sleep(150); } }
async function startScene(key) {
  console.error(`scene ${key} @ ${now().toFixed(1)}s`);
  if (scene) await endScene();
  scene = { key, start: now() };
  await caption(SCENES[key][0]);
}
async function endScene() {
  const min = narr[scene.key] + 1.0;                 // let the narration finish, then breathe
  const left = scene.start + min - now();
  if (left > 0) await hold(left);
  scene.end = now(); scenes.push(scene); scene = null;
}
// Caption bar + click marker injected into whatever page is showing (also the popup page).
const INJECT = `
  if (!document.getElementById("demo-cap")) {
    const st = document.createElement("style"); st.textContent = \`
      #demo-cap{position:fixed;left:0;right:0;top:0;z-index:2147483647;background:linear-gradient(90deg,#7d0005,#a10007);color:#fff;
        font:600 22px/1.3 "Open Sans","Segoe UI",system-ui,sans-serif;padding:14px 36px 15px;border-bottom:3px solid #f2c65d;box-shadow:0 8px 30px rgba(0,0,0,.25)}
      #demo-cap:empty{display:none} #demo-cap small{display:block;font-weight:400;font-size:15px;opacity:.9;margin-top:3px}
      #demo-cur{position:fixed;z-index:2147483647;width:30px;height:30px;border-radius:50%;background:rgba(161,0,7,.3);border:2px solid #a10007;
        pointer-events:none;transform:translate(-50%,-50%);display:none}
      \${arguments[1]}\`;
    document.documentElement.appendChild(st);
    for (const id of ["demo-cap", "demo-cur"]) { const d = document.createElement("div"); d.id = id; document.documentElement.appendChild(d); }
  }
  document.getElementById("demo-cap").innerHTML = arguments[0];`;
let pageCss = "";
const caption = (html) => m.exec(INJECT, [html, pageCss]);
const POPUP_CSS = `html{background:#fdf1f4} body{margin:100px auto 0 !important;transform:scale(1.1);transform-origin:top center}`;
const PAGE_CSS = `body{padding-top:84px !important}`;
async function go(url, css) { pageCss = css; await m.navigate(url); await sleep(600); await caption(scene ? SCENES[scene.key][0] : ""); }
async function pointAt(css) {
  await m.exec(`const el = document.querySelector(arguments[0]); el.scrollIntoView({block:"center"}); const r = el.getBoundingClientRect();
    const c = document.getElementById("demo-cur"); c.style.left = (r.left + r.width/2) + "px"; c.style.top = (r.top + r.height/2) + "px"; c.style.display = "block";`, [css]);
  await hold(0.45);
}
async function clickOn(css) {
  await pointAt(css);
  await m.click(await m.find(css));
  await m.exec(`document.getElementById("demo-cur").style.display = "none"`);
  await hold(0.3);
}
async function type(css, text, perChar = true) {
  const id = await m.find(css);
  await pointAt(css); await m.click(id);
  await m.exec(`document.getElementById("demo-cur").style.display = "none"`);
  if (perChar) for (const ch of text) { await m.send("WebDriver:ElementSendKeys", { id, text: ch }); await cap(); }
  else { await m.send("WebDriver:ElementSendKeys", { id, text }); await hold(0.35); }
}
const setSelect = (css, value) => m.exec(`const s = document.querySelector(arguments[0]); s.value = arguments[1]; s.dispatchEvent(new Event("change", {bubbles:true}));`, [css, value]);

// ------------------------------------------------------------------ story --
try {
  await m.connect(); await m.newSession();
  await m.send("WebDriver:SetTimeouts", { pageLoad: 30000, script: 20000, implicit: 0 });
  // Headless Firefox ignores --window-size; size the window so the viewport is exactly 1280x720.
  await m.send("WebDriver:SetWindowRect", { width: 1280, height: 720 });
  const [iw, ih] = await m.exec("return [innerWidth, innerHeight]");
  if (iw !== 1280 || ih !== 720) await m.send("WebDriver:SetWindowRect", { width: 2560 - iw, height: 1440 - ih });
  console.error("viewport:", await m.exec("return innerWidth + 'x' + innerHeight"));
  const addon = await m.installAddon(W + "ext");
  await m.setContext("chrome");
  const uuids = JSON.parse(await m.exec(`return Services.prefs.getStringPref("extensions.webextensions.uuids");`));
  await m.setContext("content");
  const popup = `moz-extension://${uuids[addon.value]}/popup/index.html`;
  // Host access is granted off camera (a store install grants it at install time).
  await m.navigate(popup); await sleep(500);
  if (await m.exec(`return !document.getElementById('perm-banner').hidden`)) { await m.click(await m.find("#grant-access")); await sleep(800); }

  await startScene("title");   await go("file://" + DEMO + "cards/title.html", ""); await hold(1);
  await startScene("install"); await go("file://" + DEMO + "cards/install.html", ""); await hold(1);

  await startScene("add");
  await go(popup, POPUP_CSS); await hold(1.2);
  const addOne = async (p, perChar) => {
    await clickOn("#add-pilgrim");
    await type('#pilgrim-form [name="name"]', p.name, perChar);
    await type('#pilgrim-form [name="age"]', p.age, perChar);
    await pointAt('#pilgrim-form [name="gender"]'); await setSelect('#pilgrim-form [name="gender"]', p.gender); await hold(0.4);
    await pointAt('#pilgrim-form [name="idType"]'); await setSelect('#pilgrim-form [name="idType"]', p.idType); await hold(0.4);
    await m.exec(`document.getElementById("demo-cur").style.display = "none"`);
    await type('#pilgrim-form [name="idNumber"]', p.idNumber, perChar);
    await clickOn('#pilgrim-form button[type="submit"]');
    await hold(0.8);
  };
  await addOne(PILGRIMS[0], true);

  await startScene("more");
  for (const p of PILGRIMS.slice(1)) await addOne(p, false);
  // Radha is not travelling this time: untick her.
  await clickOn('#pilgrim-list li:nth-child(4) input[type="checkbox"]');
  await hold(1);

  await startScene("contact");
  await clickOn("#contact-section summary");
  for (const [k, v] of Object.entries(CONTACT)) await type(`#contact-form [name="${k}"]`, v, false);
  await clickOn('#contact-form button[type="submit"]');
  await hold(0.8);
  await m.exec(`document.getElementById("contact-section").open = false`); await hold(0.6);

  await startScene("fill");
  await go("http://ttdevasthanams.ap.gov.in/pilgrim-details", PAGE_CSS); await hold(2);
  await clickOn("#ttdqf-fab");
  await hold(4.5);

  await startScene("srivani");
  await go("http://ttdevasthanams.ap.gov.in/srivani", PAGE_CSS); await hold(1.5);
  await clickOn("#ttdqf-fab");
  await hold(3);

  await startScene("protect");
  await go(popup, POPUP_CSS); await hold(0.8);
  await clickOn("#security-section summary");
  await type('#enable-form [name="passphrase"]', PASS, false);
  await type('#enable-form [name="confirm"]', PASS, false);
  await clickOn('#enable-form button[type="submit"]');
  await hold(3.5);
  await clickOn("#lock-now");
  await hold(2);
  await type('#unlock-form [name="passphrase"]', PASS, false);
  await clickOn('#unlock-form button[type="submit"]');
  await hold(3);

  await startScene("end");
  await go("file://" + DEMO + "cards/end.html", ""); await hold(1);
  await endScene();
} finally {
  await m.quit(); m.close(); ff.kill(); server.kill();
}

// ------------------------------------------------------------------ stitch --
const list = frames.map((fr, i) => `file '${fr.f}'\nduration ${((frames[i + 1]?.t ?? fr.t + 0.5) - fr.t).toFixed(3)}`).join("\n") + `\nfile '${frames.at(-1).f}'\n`;
fs.writeFileSync(OUT + "frames.txt", list);
const inputs = scenes.flatMap((s) => ["-i", `${AU}${s.key}.aiff`]);
const chains = scenes.map((s, i) => `[${i + 1}:a]aformat=sample_rates=44100:channel_layouts=mono,apad=whole_dur=${(s.end - s.start).toFixed(3)}[a${i}]`).join(";");
const concat = scenes.map((_, i) => `[a${i}]`).join("") + `concat=n=${scenes.length}:v=0:a=1[aout]`;
const mp4 = OUT + "ttd-quick-fill-demo.mp4";
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", OUT + "frames.txt", ...inputs,
  "-filter_complex", `${chains};${concat}`, "-map", "0:v", "-map", "[aout]",
  "-vf", "fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", mp4]);
console.log(`frames: ${frames.length}, length: ${frames.at(-1).t.toFixed(1)}s`);
console.log("scenes:", scenes.map((s) => `${s.key} ${(s.end - s.start).toFixed(1)}s`).join(", "));
console.log("video:", mp4);
