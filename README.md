# TTD Quick Fill

Free, open-source browser extension (Chrome and Firefox) that saves your
family's details once and fills them into the Tirumala Tirupati Devasthanams
(TTD) online booking forms in one click.

**Unofficial.** Not affiliated with, endorsed by or sponsored by TTD.

## What it does

- Keeps pilgrims (name, age, gender, Aadhaar or passport number) and optional
  contact details in the browser's extension storage. Nothing leaves your
  browser; there is no server, account, analytics or ads.
- On `ttdevasthanams.ap.gov.in` it fills the **Special Entry Darshan** and
  **Sri PAT** pilgrim-details form (and the General Details block) and the
  **Srivani** form, from a popup button or a floating button on the page.
- Reports exactly which fields it verified and which you must enter by hand.
- Never presses Continue, Pay Now or Submit, never solves CAPTCHAs, never
  touches payment.

Roadmap (help welcome): paid-seva and group-seva forms, e-DIP (lucky draw)
form and date table, passphrase-protected storage, Telugu/Hindi/Tamil/Kannada/
Malayalam UI.

## Install

**Chrome / Edge / Brave:** `chrome://extensions` → Developer mode →
"Load unpacked" → pick this folder.

**Firefox:** `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on"
→ pick `manifest.json`. For a permanent install, build the zip and sign it on
addons.mozilla.org (unlisted self-distribution is fine).

Permissions: `storage` (your saved pilgrims) and access to the two TTD sites
only. No background script, no debugger permission.

## Use

1. Click the extension icon, add pilgrims, tick the ones to book for.
2. Sign in to the TTD site yourself and open the pilgrim-details form.
3. Press **Fill this page** in the popup, or the **Fill pilgrims** button on
   the page. Check every field, then continue the booking yourself.

## Development

```sh
npm test                      # unit tests (node:test)
npm run lint                  # web-ext lint
npm run build                 # zip into dist/
```

Layout:

| Path | Purpose |
|---|---|
| `manifest.json` | MV3, shared by Chrome and Firefox |
| `content/fill.js` | form detection, filling and verification, on-page button |
| `popup/` | pilgrim and contact management, fill trigger |
| `shared/validate.js` | pure validation (Aadhaar Verhoeff check etc.) |
| `tests/` | unit tests |

The TTD site is a React single-page app with combo-box inputs; text is written
through `document.execCommand('insertText')` so React sees ordinary input
events, with a prototype-setter fallback. If TTD changes a field name, update
the constants at the top of `content/fill.js`.

## Provenance

Written from scratch and MIT-licensed. The author examined an existing
closed-source Chrome extension to learn the TTD form's field names, which are
facts about the TTD website; no code from it is reused and the design differs
(no debugger API, no background script). Status: v0.1.0 has not yet been
exercised against the live TTD forms. Please open an issue with the page URL
and the field that stayed empty if a fill fails.

## Privacy

See [PRIVACY.md](PRIVACY.md).
