// Minimal Marionette (Firefox remote protocol v3) client: enough to install a temporary
// add-on, drive pages and read results. Protocol frames are "<len>:<json>".
import net from "node:net";
export class Marionette {
  constructor(port = 2828) { this.port = port; this.id = 0; this.pending = new Map(); this.buf = ""; }
  connect() {
    return new Promise((resolve, reject) => {
      const tryConnect = (left) => {
        const sock = net.createConnection(this.port, "127.0.0.1");
        sock.once("error", (e) => left > 0 ? setTimeout(() => tryConnect(left - 1), 500) : reject(e));
        sock.once("connect", () => {
          this.sock = sock; sock.setEncoding("utf8");
          this.hello = new Promise((r) => { this.onHello = r; });
          sock.on("data", (d) => this.feed(d));
          this.hello.then(resolve);
        });
      };
      tryConnect(60);
    });
  }
  feed(d) {
    this.buf += d;
    for (;;) {
      const colon = this.buf.indexOf(":");
      if (colon < 0) return;
      const len = Number(this.buf.slice(0, colon));
      if (this.buf.length < colon + 1 + len) return;
      const msg = JSON.parse(this.buf.slice(colon + 1, colon + 1 + len));
      this.buf = this.buf.slice(colon + 1 + len);
      if (!Array.isArray(msg)) { this.onHello?.(msg); continue; }
      const [, id, error, result] = msg;
      const p = this.pending.get(id); this.pending.delete(id);
      if (!p) continue;
      error ? p.reject(new Error(`${error.error}: ${error.message}`)) : p.resolve(result);
    }
  }
  send(cmd, params = {}) {
    const id = ++this.id;
    const body = JSON.stringify([0, id, cmd, params]);
    this.sock.write(`${Buffer.byteLength(body)}:${body}`);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async newSession() { return this.send("WebDriver:NewSession", { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } }); }
  navigate(url) { return this.send("WebDriver:Navigate", { url }); }
  async exec(script, args = []) { return (await this.send("WebDriver:ExecuteScript", { script, args })).value; }
  async execAsync(script, args = []) { return (await this.send("WebDriver:ExecuteAsyncScript", { script, args })).value; }
  async find(css) { const r = await this.send("WebDriver:FindElement", { using: "css selector", value: css }); return r.value["element-6066-11e4-a52e-4f735466cecf"]; }
  click(id) { return this.send("WebDriver:ElementClick", { id }); }
  async screenshot(file) { const r = await this.send("WebDriver:TakeScreenshot", { full: true }); (await import("node:fs")).writeFileSync(file, Buffer.from(r.value, "base64")); }
  setContext(value) { return this.send("Marionette:SetContext", { value }); }
  installAddon(path) { return this.send("Addon:Install", { path, temporary: true }); }
  async newTab() { const r = await this.send("WebDriver:NewWindow", { type: "tab" }); await this.send("WebDriver:SwitchToWindow", { handle: r.handle }); return r.handle; }
  switchTo(handle) { return this.send("WebDriver:SwitchToWindow", { handle }); }
  quit() { return this.send("Marionette:Quit", { flags: ["eForceQuit"] }).catch(() => {}); }
  close() { this.sock?.destroy(); }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
