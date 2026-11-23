// TTD Quick Fill — React bridge (enhancement, 0.3.2). Loaded before fill.js.
// In Nov 2026 the TTD site switched its text fields and dropdowns to a component that ignores every event a
// script makes (it checks nativeEvent.isTrusted: an untrusted change is reverted, a dropdown opens and picks only
// on a trusted click). A content script cannot make trusted events, but it can hand the value to the page's own
// React handler, which is what the page does itself after a real keystroke or click. This file finds that
// handler on an element (React keeps its props on the DOM node as __reactProps$…) and calls it with an event
// object that carries the fields the page reads. fill.js uses it as a second step after its normal typing/click,
// so forms that never needed it behave exactly as before.
(() => {
  "use strict";

  // Firefox content scripts see the page's own properties on a DOM node only through wrappedJSObject.
  const raw = (el) => (el && el.wrappedJSObject) || el;
  const propsOf = (el) => {
    const p = raw(el);
    if (!p) return null;
    try { const k = Object.keys(p).find((k) => k.startsWith("__reactProps$")); return k ? p[k] : null; } catch { return null; }
  };
  const handler = (el, name) => { const p = propsOf(el); const fn = p && p[name]; return typeof fn === "function" ? fn : null; };

  // The event the handler receives, built in the page's own world so the page can read it (cloneInto is Firefox's way).
  function trustedEvent(el) {
    const ev = { target: el, currentTarget: el, isTrusted: true, nativeEvent: { isTrusted: true, target: el }, type: "input",
                 preventDefault() {}, stopPropagation() {}, persist() {} };
    return typeof cloneInto === "function" ? cloneInto(ev, window, { cloneFunctions: true, wrapReflectors: true }) : ev;
  }

  /** True when React renders this element (so the two calls below can do something). */
  const has = (el) => !!propsOf(el);

  /** Puts `value` in the field and hands it to the page's React onChange as a typed value. */
  function setText(el, value) {
    const fn = handler(el, "onChange");
    if (!fn) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    try { fn(trustedEvent(el)); } catch { return false; }
    return true;
  }

  /** Calls the page's React onClick for an element (opens a gated dropdown, picks a gated option). */
  function click(el) {
    const fn = handler(el, "onClick");
    if (!fn) return false;
    try { fn(trustedEvent(el)); } catch { return false; }
    return true;
  }

  globalThis.__ttdqfReact = { has, setText, click };
})();
