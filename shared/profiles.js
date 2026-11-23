// TTD Quick Fill — profiles (enhancement, 0.4.0). Plain script: used by the popup, the content script and the tests.
//
// A profile is a named group of saved pilgrims ("Family", "Parents", "Office trip"…) in the order they should be
// filled. Profiles hold only a label and pilgrim ids, never the pilgrims' details, so they live beside the vault
// as plain storage; the pilgrims themselves stay wherever they are (encrypted when a passphrase is set).
// When a profile is active, a fill uses exactly that group; otherwise the ticked pilgrims are used, as before.
(() => {
  "use strict";
  const KEY = "profiles", ACTIVE = "activeProfile";

  /** { profiles: [{ id, name, pilgrimIds }], active: id | "" } */
  async function list(ext) {
    const got = await ext.storage.local.get({ [KEY]: [], [ACTIVE]: "" });
    const profiles = (Array.isArray(got[KEY]) ? got[KEY] : []).filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
      .map((p) => ({ id: p.id, name: p.name, pilgrimIds: Array.isArray(p.pilgrimIds) ? p.pilgrimIds.filter((x) => typeof x === "string") : [] }));
    return { profiles, active: typeof got[ACTIVE] === "string" ? got[ACTIVE] : "" };
  }
  const save = (ext, profiles) => ext.storage.local.set({ [KEY]: profiles });
  const setActive = (ext, id) => ext.storage.local.set({ [ACTIVE]: id || "" });

  /** The pilgrims a profile fills, in the profile's order; ids of pilgrims deleted since are skipped. null without a profile. */
  function pilgrimsFor(profile, pilgrims) {
    if (!profile) return null;
    const byId = new Map(pilgrims.map((p) => [p.id, p]));
    return profile.pilgrimIds.map((id) => byId.get(id)).filter(Boolean);
  }

  /** What a fill should use: the active profile's group when one is chosen and still exists, else the ticked pilgrims. */
  function choose(pilgrims, profiles, active) {
    const profile = profiles.find((p) => p.id === active) || null;
    const group = pilgrimsFor(profile, pilgrims);
    return group ? { pilgrims: group, profile } : { pilgrims: pilgrims.filter((p) => p.selected !== false), profile: null };
  }

  (globalThis.TTDQF ||= {}).profiles = { list, save, setActive, pilgrimsFor, choose };
})();
