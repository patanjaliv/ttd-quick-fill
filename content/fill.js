// TTD Quick Fill — content script.
// Runs only on the two official TTD booking sites. It reads the saved pilgrims
// from extension storage (or receives them from the popup), writes them into
// the booking form the way a user typing would, and reports back exactly which
// fields were verified. It never presses Continue, Pay or Submit.
//
// Field names below are facts about the TTD web forms as served in 2026; they
// are the only knowledge of the site this file depends on.
(() => {
  "use strict";
  const ext = globalThis.browser ?? globalThis.chrome;
  const HOST_MAIN = "ttdevasthanams.ap.gov.in";

  // ---------------------------------------------------------------- forms --
  // Special Entry Darshan (SED) and Sri PAT (SPAT) share one "pilgrim details" page.
  const PILGRIM_PATHS = ["/pilgrim-details", "/spat/pilgrim-details"];
  const ROW = { name: "fname", age: "age", gender: "gender", idType: "photoIdType", idNumber: "idProofNumber" };
  const GENERAL = { email: "emailId", city: "city", state: "state", country: "country", pincode: "pincode" };
  // Srivani Trust donation darshan: numbered fields per person, native <select>s.
  const SRIVANI = (i) => ({ name: `fName${i}`, age: `age${i}`, gender: `gender${i}`, idType: `proofS${i}`, idNumber: `proofId${i}` });

  function pageKind() {
    if (location.hostname === HOST_MAIN && PILGRIM_PATHS.includes(location.pathname)) return "pilgrim-details";
    if (document.querySelector('input[name="fName0"]')) return "srivani";
    return null;
  }

  // ------------------------------------------------------------------ dom --
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const enabled = (el) => !!el && !el.disabled && !el.readOnly && !el.closest("[inert]");
  const byName = (name) => [...document.querySelectorAll(`input[name="${name}"], select[name="${name}"]`)].filter(visible);

  async function waitFor(fn, timeoutMs = 2000, stepMs = 50) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() >= end) return null;
      await sleep(stepMs);
    }
  }

  // A click as the page would receive it from a user: pointer + mouse events at the element's centre.
  function click(el) {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const r = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent("pointerup", init));
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.dispatchEvent(new MouseEvent("click", { ...init, detail: 1 }));
  }

  // Sets a value so that React (and plain pages) notice it: prefer the browser's own
  // editing command, fall back to the prototype setter plus an input event.
  function setValue(el, value) {
    el.focus({ preventScroll: true });
    try {
      el.setSelectionRange?.(0, el.value.length);
    } catch { /* type=number and friends refuse selection ranges */ }
    let done = false;
    try {
      done = document.execCommand("insertText", false, value) && el.value === value;
    } catch { /* not supported here */ }
    if (!done) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }

  function setSelect(select, wanted) {
    const target = wanted.toLowerCase();
    const option = [...select.options].find((o) => o.textContent.trim().toLowerCase() === target)
      || [...select.options].find((o) => o.textContent.trim().toLowerCase().includes(target) || o.value.toLowerCase().includes(target));
    if (!option) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value === option.value;
  }

  // The SED/SPAT page uses combo-box inputs whose choices appear as list items after a click.
  async function chooseCombo(input, wanted) {
    if (input.value.trim() === wanted) return true;
    click(input);
    const option = await waitFor(() => {
      const scope = input.closest("form") || document;
      return [...scope.querySelectorAll('li[role="option"], li')].filter(visible).find((li) => li.textContent.trim() === wanted);
    }, 2500);
    if (!option) return false;
    click(option);
    await waitFor(() => input.value.trim() === wanted, 1500);
    if (input.value.trim() !== wanted) return false;
    input.blur();
    return true;
  }

  // Validation marker TTD renders next to a rejected field.
  const hasError = (el) => !!el.closest("div")?.parentElement?.querySelector('img[src*="erroricon"], [aria-invalid="true"]');

  // -------------------------------------------------------------- filling --
  async function fillText(el, value, label, report) {
    if (!enabled(el)) { report.warnings.push(`${label}: field is disabled, left as is.`); return false; }
    if (el.value.trim()) {
      if (el.value.trim() === value) return true;
      report.warnings.push(`${label}: already had a value, left as is.`);
      return false;
    }
    setValue(el, value);
    await sleep(60);
    if (el.value.trim() !== value) { report.warnings.push(`${label}: the page did not accept the value.`); return false; }
    if (hasError(el)) report.warnings.push(`${label}: the page shows a validation error.`);
    return true;
  }

  async function fillPilgrimDetails(pilgrims, contact, report) {
    const names = byName(ROW.name);
    if (!names.length) throw new Error("No pilgrim rows found on this page.");
    const rows = names.map((_, i) => Object.fromEntries(Object.entries(ROW).map(([k, n]) => [k, byName(n)[i]])));
    const emptyRows = rows.filter((r) => Object.values(r).every((el) => el && !el.value.trim()));
    if (!emptyRows.length) throw new Error("Every pilgrim row already has details. Clear a row to fill it.");
    if (emptyRows.length < pilgrims.length) report.warnings.push(`Only ${emptyRows.length} empty row(s); ${pilgrims.length - emptyRows.length} pilgrim(s) not filled.`);

    for (let i = 0; i < Math.min(pilgrims.length, emptyRows.length); i++) {
      const p = pilgrims[i], row = emptyRows[i], who = p.name;
      let ok = await fillText(row.name, p.name, `${who} · name`, report);
      ok = (await fillText(row.age, p.age, `${who} · age`, report)) && ok;
      if (!(await chooseCombo(row.gender, p.gender))) { report.warnings.push(`${who} · gender: choose it manually.`); ok = false; }
      // The ID-type list is enabled only after the age is accepted; wait for it.
      await waitFor(() => enabled(row.idType), 1500);
      if (!(await chooseCombo(row.idType, p.idType))) { report.warnings.push(`${who} · ID type: choose it manually.`); ok = false; }
      await waitFor(() => enabled(row.idNumber), 1500);
      ok = (await fillText(row.idNumber, p.idNumber, `${who} · ID number`, report)) && ok;
      if (ok) report.filled.push(who);
    }

    // General details (one set per booking) — only empty, editable fields and only saved values.
    for (const [key, name] of Object.entries(GENERAL)) {
      const value = contact?.[key];
      const el = byName(name)[0];
      if (!value || !el || el.value.trim() || !enabled(el)) continue;
      await fillText(el, value, `General · ${key}`, report);
    }
  }

  async function fillSrivani(pilgrims, report) {
    for (let i = 0; i < pilgrims.length; i++) {
      const f = SRIVANI(i), p = pilgrims[i], who = p.name;
      const nameEl = byName(f.name)[0];
      if (!nameEl) { report.warnings.push(`${who}: no row ${i + 1} on this page.`); continue; }
      let ok = await fillText(nameEl, p.name, `${who} · name`, report);
      const ageEl = byName(f.age)[0];
      if (ageEl) ok = (await fillText(ageEl, p.age, `${who} · age`, report)) && ok;
      await sleep(300); // the page enables the ID-type list after age
      const genderEl = byName(f.gender)[0];
      if (genderEl && !setSelect(genderEl, p.gender)) { report.warnings.push(`${who} · gender: choose it manually.`); ok = false; }
      const typeEl = byName(f.idType)[0];
      if (typeEl) {
        await waitFor(() => typeEl.options.length > 1, 2000);
        if (!setSelect(typeEl, p.idType === "Passport" ? "passport" : "aadha")) { report.warnings.push(`${who} · ID type: choose it manually.`); ok = false; }
        await sleep(200);
      }
      const idEl = byName(f.idNumber)[0];
      if (idEl) ok = (await fillText(idEl, p.idNumber, `${who} · ID number`, report)) && ok;
      if (ok) report.filled.push(who);
    }
  }

  let busy = false;
  async function fill(pilgrims, contact) {
    if (busy) return { ok: false, error: "A fill is already running." };
    const kind = pageKind();
    if (!kind) return { ok: false, error: "Open a TTD pilgrim-details or Srivani booking form first." };
    if (!Array.isArray(pilgrims) || !pilgrims.length) return { ok: false, error: "No pilgrims selected. Open the extension and tick at least one." };
    const report = { ok: true, page: kind, filled: [], warnings: [] };
    busy = true;
    setStatus("Filling… do not type until it finishes.", "busy");
    try {
      if (kind === "pilgrim-details") await fillPilgrimDetails(pilgrims, contact, report);
      else await fillSrivani(pilgrims, report);
    } catch (err) {
      report.ok = false;
      report.error = err?.message || String(err);
    } finally {
      busy = false;
    }
    const summary = report.ok
      ? `Filled ${report.filled.length} of ${pilgrims.length}. ${report.warnings.length ? report.warnings.join(" ") : "Review the form, then continue yourself."}`
      : report.error;
    setStatus(summary, report.ok ? (report.warnings.length ? "warn" : "ok") : "error");
    return report;
  }

  // ------------------------------------------------------------ messaging --
  ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || sender.id !== ext.runtime.id) return undefined;
    if (message.type === "STATUS") {
      sendResponse({ page: pageKind(), rows: byName(ROW.name).length });
      return undefined;
    }
    if (message.type === "FILL") {
      fill(message.pilgrims, message.contact).then(sendResponse);
      return true;
    }
    return undefined;
  });

  // -------------------------------------------------------------- on-page --
  let statusEl = null;
  function setStatus(text, state) {
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.id = "ttdqf-status";
      statusEl.setAttribute("role", "status");
      document.body.appendChild(statusEl);
    }
    statusEl.textContent = text;
    statusEl.dataset.state = state;
    statusEl.hidden = false;
    clearTimeout(statusEl._timer);
    if (state !== "busy") statusEl._timer = setTimeout(() => { statusEl.hidden = true; }, 12000);
  }

  function mountButton() {
    if (document.getElementById("ttdqf-fab") || !pageKind()) return;
    const btn = document.createElement("button");
    btn.id = "ttdqf-fab";
    btn.type = "button";
    btn.textContent = "Fill pilgrims";
    btn.title = "TTD Quick Fill: fill the saved, selected pilgrims into this form";
    btn.addEventListener("click", async (e) => {
      if (!e.isTrusted || busy) return;
      try {
        const { pilgrims = [], contact = {} } = await ext.storage.local.get({ pilgrims: [], contact: {} });
        await fill(pilgrims.filter((p) => p.selected !== false), contact);
      } catch (err) {
        setStatus(/invalidated/i.test(err?.message) ? "Extension was updated — reload this page." : (err?.message || "Fill failed."), "error");
      }
    });
    document.body.appendChild(btn);
  }

  // The TTD site is a single-page app: watch for route changes.
  let lastPath = null;
  const observer = new MutationObserver(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; document.getElementById("ttdqf-fab")?.remove(); }
    mountButton();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mountButton();
})();
