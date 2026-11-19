// TTD Quick Fill — generic pilgrim form (enhancement, 0.3.0).
// Loaded before fill.js. fill.js keeps its own, verified adapters for the SED/SPAT pilgrim-details page and
// the Srivani form; this file is consulted only when neither of those matches. It finds pilgrim rows by the
// *labels* a person reads (Name, Age, Gender, ID proof, ID number) instead of by field names, so a seva form
// the extension has never seen (Arjitha seva, Angapradakshinam, senior-citizen darshan, accommodation …)
// can still be filled, with a warning to check every field. It never presses Continue, Pay or Submit.
(() => {
  "use strict";

  // Label text → which pilgrim field it is. Order matters: the first match wins.
  const KINDS = [
    ["idNumber", /\b(id|proof|aadha?ar|passport|document)\b.*\b(no\.?|number|num)\b|\b(no\.?|number)\s*of\s*(id|proof)/i],
    ["idType",   /\b(id|proof|document)\b.*\btype\b|\bphoto\s*id\b|\bid\s*proof\b|\bproof\s*type\b/i],
    ["gender",   /\b(gender|sex)\b/i],
    ["age",      /\bage\b/i],
    ["name",     /\bname\b/i],
  ];
  // Labels that look like a pilgrim field but are not one.
  const NOT_PILGRIM = /\b(user|login|bank|account|father|mother|husband|guardian|hotel|room|card|holder|booking|group|package|temple|seva|branch|ifsc|street|village|city|state|country|pin|mobile|phone|email)\b/i;

  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const text = (s) => (s || "").replace(/\s+/g, " ").trim();

  // The words a person sees next to a field: <label for>, a wrapping <label>, aria-label, placeholder, the
  // nearest preceding label-ish text in the same row/cell, then the field's own name as a last resort.
  function labelOf(el) {
    const parts = [];
    if (el.id) document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => parts.push(text(l.textContent)));
    const wrap = el.closest("label"); if (wrap) parts.push(text(wrap.textContent));
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    if (el.getAttribute("aria-labelledby")) el.getAttribute("aria-labelledby").split(/\s+/).forEach((id) => { const n = document.getElementById(id); if (n) parts.push(text(n.textContent)); });
    if (el.placeholder) parts.push(el.placeholder);
    if (!parts.join(" ").trim()) {
      // walk up a little and take the text of the nearest label-like sibling before the field
      let node = el, hops = 0;
      while (node && hops < 4 && !parts.join(" ").trim()) {
        let sib = node.previousElementSibling;
        while (sib && !parts.join(" ").trim()) {
          if (/^(LABEL|SPAN|DIV|P|TD|TH|STRONG|B)$/.test(sib.tagName) && text(sib.textContent).length <= 60 && !sib.querySelector("input,select,textarea")) parts.push(text(sib.textContent));
          sib = sib.previousElementSibling;
        }
        node = node.parentElement; hops++;
      }
    }
    if (!parts.join(" ").trim()) parts.push(el.name || "");
    return parts.join(" | ");
  }

  function kindOf(label) {
    if (!label || NOT_PILGRIM.test(label)) return null;
    for (const [kind, re] of KINDS) if (re.test(label)) return kind;
    return null;
  }

  // Every visible, user-facing field on the page in document order, with the pilgrim field it looks like.
  function fields() {
    const sel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=file]), select';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      if (el.type === "radio") {
        // a radio group counts once, by the group's label (its name) plus the first option's label
        if (out.some((f) => f.el.type === "radio" && f.el.name === el.name)) continue;
      }
      const label = labelOf(el) + (el.type === "radio" ? " " + text(el.closest("fieldset")?.querySelector("legend")?.textContent) : "");
      const kind = kindOf(label);
      if (kind) out.push({ el, kind, label });
    }
    return out;
  }

  // Rows: each "name" field starts a pilgrim; the fields after it, up to the next name, belong to that pilgrim.
  function rows() {
    const fs = fields();
    const rows = [];
    let cur = null;
    for (const f of fs) {
      if (f.kind === "name") { cur = { name: f.el }; rows.push(cur); continue; }
      if (cur && !cur[f.kind]) cur[f.kind] = f.el;
    }
    return rows.filter((r) => r.age || r.gender || r.idType || r.idNumber);
  }

  /** True when this page has at least one pilgrim row the generic layer can fill. */
  function detect() {
    if (/login|otp|signin|sign-in/i.test(location.pathname)) return false;
    return rows().length > 0;
  }

  const isEmpty = (el) => !el || (el.type === "radio" ? !document.querySelector(`input[type=radio][name="${CSS.escape(el.name)}"]:checked`) : !String(el.value || "").trim());

  // A choice field may be a native <select>, a radio group, or a combo-box input (readonly / role=combobox).
  async function choose(el, wanted, label, who, report, h) {
    if (!el) { report.warnings.push(`${who} · ${label}: not found on this form, choose it manually.`); return false; }
    if (el.tagName === "SELECT") {
      if (h.setSelect(el, wanted)) return true;
      // ID types: the saved value is "Aadhaar" / "Passport"; the form may say "Aadhar Card" / "Passport"
      if (h.setSelect(el, wanted.slice(0, 5))) return true;
    } else if (el.type === "radio") {
      const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
      const hit = group.find((r) => (labelOf(r) + " " + r.value).toLowerCase().includes(wanted.toLowerCase().slice(0, 4)));
      if (hit) { hit.click(); await h.sleep(60); if (hit.checked) return true; }
    } else {
      if (await h.chooseCombo(el, wanted)) return true;
    }
    report.warnings.push(`${who} · ${label}: choose it manually.`);
    return false;
  }

  /** Fills the saved pilgrims into empty rows. `h` = the helpers fill.js already uses for its own forms. */
  async function fill(pilgrims, report, h) {
    const all = rows();
    if (!all.length) throw new Error("No pilgrim rows found on this page.");
    const empty = all.filter((r) => isEmpty(r.name));
    if (!empty.length) throw new Error("Every pilgrim row already has a name. Clear a row to fill it.");
    if (empty.length < pilgrims.length) report.warnings.push(`Only ${empty.length} empty row(s); ${pilgrims.length - empty.length} pilgrim(s) not filled.`);
    for (let i = 0; i < Math.min(pilgrims.length, empty.length); i++) {
      const p = pilgrims[i], row = empty[i], who = p.name;
      let ok = await h.fillText(row.name, p.name, `${who} · name`, report);
      if (row.age) ok = (await h.fillText(row.age, p.age, `${who} · age`, report)) && ok; else report.warnings.push(`${who} · age: not found on this form.`);
      if (row.gender) ok = (await choose(row.gender, p.gender, "gender", who, report, h)) && ok;
      if (row.idType) {
        await h.waitFor(() => h.enabled(row.idType) && (row.idType.tagName !== "SELECT" || row.idType.options.length > 1), 1500);
        ok = (await choose(row.idType, p.idType, "ID type", who, report, h)) && ok;
      }
      if (row.idNumber) {
        await h.waitFor(() => h.enabled(row.idNumber), 1500);
        ok = (await h.fillText(row.idNumber, p.idNumber, `${who} · ID number`, report)) && ok;
      }
      if (ok) report.filled.push(who);
    }
    report.warnings.unshift("Unrecognised TTD form: fields were matched by their labels. Check every value before you continue.");
  }

  globalThis.__ttdqfGeneric = { detect, fill, rows, labelOf, kindOf };
})();
