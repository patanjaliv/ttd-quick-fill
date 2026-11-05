import { GENDERS, ID_TYPES, validatePilgrim, validateContact } from "../shared/validate.js";

const ext = globalThis.browser ?? globalThis.chrome;
const $ = (sel) => document.querySelector(sel);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const load = () => ext.storage.local.get({ pilgrims: [], contact: {} });
const save = (patch) => ext.storage.local.set(patch);

// ------------------------------------------------------------------ list --
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

async function renderList() {
  const { pilgrims } = await load();
  const list = $("#pilgrim-list");
  list.replaceChildren();
  $("#pilgrim-empty").hidden = pilgrims.length > 0;
  for (const p of pilgrims) {
    const tick = el("input", { type: "checkbox", checked: p.selected !== false, title: "Include when filling" });
    tick.addEventListener("change", async () => {
      const { pilgrims } = await load();
      await save({ pilgrims: pilgrims.map((x) => (x.id === p.id ? { ...x, selected: tick.checked } : x)) });
    });
    const text = el("div", {}, el("div", { className: "who", textContent: p.name }),
      el("div", { className: "meta", textContent: `${p.age} · ${p.gender} · ${p.idType === "Passport" ? "Passport" : "Aadhaar"} ${maskId(p.idNumber)}` }));
    const edit = el("button", { type: "button", textContent: "Edit" });
    edit.addEventListener("click", () => openForm(p));
    const del = el("button", { type: "button", textContent: "Delete", className: "btn-danger" });
    del.addEventListener("click", async () => {
      if (!confirm(`Delete ${p.name}?`)) return;
      const { pilgrims } = await load();
      await save({ pilgrims: pilgrims.filter((x) => x.id !== p.id) });
      renderList();
    });
    list.append(el("li", {}, tick, text, edit, del));
  }
}

const maskId = (id) => (id.length > 4 ? "••••" + id.slice(-4) : id);

// ------------------------------------------------------------------ form --
const form = $("#pilgrim-form");
function fillSelect(select, options) {
  select.replaceChildren(...options.map((o) => el("option", { value: o, textContent: o })));
}
fillSelect(form.elements.gender, GENDERS);
fillSelect(form.elements.idType, ID_TYPES);

function openForm(p = null) {
  form.reset();
  $("#form-errors").textContent = "";
  $("#form-title").textContent = p ? "Edit pilgrim" : "Add pilgrim";
  if (p) for (const k of ["id", "name", "age", "gender", "idType", "idNumber"]) form.elements[k].value = p[k] ?? "";
  form.hidden = false;
  form.elements.name.focus();
}
$("#add-pilgrim").addEventListener("click", () => openForm());
$("#cancel-pilgrim").addEventListener("click", () => { form.hidden = true; });
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const { ok, value, errors } = validatePilgrim(data);
  if (!ok) { $("#form-errors").textContent = Object.values(errors).join("\n"); return; }
  const { pilgrims } = await load();
  if (value.id) {
    const existing = pilgrims.find((x) => x.id === value.id);
    value.selected = existing ? existing.selected !== false : true;
    await save({ pilgrims: pilgrims.map((x) => (x.id === value.id ? value : x)) });
  } else {
    value.id = uid();
    await save({ pilgrims: [...pilgrims, value] });
  }
  form.hidden = true;
  renderList();
});

// --------------------------------------------------------------- contact --
const contactForm = $("#contact-form");
async function renderContact() {
  const { contact } = await load();
  for (const k of ["email", "city", "state", "country", "pincode"]) contactForm.elements[k].value = contact[k] ?? "";
  if (Object.values(contact).some(Boolean)) $("#contact-section").open = true;
}
contactForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const { ok, value, errors } = validateContact(Object.fromEntries(new FormData(contactForm)));
  $("#contact-errors").textContent = ok ? "" : Object.values(errors).join("\n");
  if (!ok) return;
  await save({ contact: value });
  setStatus("Contact details saved.");
});

// ------------------------------------------------------------------ fill --
const setStatus = (text) => { $("#fill-status").textContent = text; };

async function activeTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab;
}

$("#fill").addEventListener("click", async () => {
  const btn = $("#fill");
  btn.disabled = true;
  setStatus("Filling…");
  try {
    const tab = await activeTab();
    if (!tab?.id || !/^https:\/\/(ttdevasthanams|tirupatibalaji)\.ap\.gov\.in\//.test(tab.url || "")) {
      setStatus("Open a TTD booking page (ttdevasthanams.ap.gov.in) in this tab first.");
      return;
    }
    const { pilgrims, contact } = await load();
    const selected = pilgrims.filter((p) => p.selected !== false);
    if (!selected.length) { setStatus("Tick at least one pilgrim."); return; }
    const result = await ext.tabs.sendMessage(tab.id, { type: "FILL", pilgrims: selected, contact });
    if (!result) { setStatus("No reply from the page. Reload the TTD tab and try again."); return; }
    if (!result.ok) { setStatus(result.error || "Could not fill this page."); return; }
    const lines = [`Filled ${result.filled.length} of ${selected.length} pilgrim(s).`, ...result.warnings];
    if (!result.warnings.length) lines.push("Review the form and continue yourself.");
    setStatus(lines.join("\n"));
  } catch (err) {
    setStatus(/receiving end|could not establish|no matching message handler/i.test(err?.message || "")
      ? "The page is not ready. Reload the TTD tab and try again."
      : (err?.message || "Fill failed."));
  } finally {
    btn.disabled = false;
  }
});

renderList();
renderContact();
