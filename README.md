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
- Optional passphrase protection: the saved details are then stored encrypted
  (AES-256-GCM, key derived with PBKDF2-SHA256) and unlocked once per browser
  session. See *Security* below.
- Never presses Continue, Pay Now or Submit, never solves CAPTCHAs, never
  touches payment.

Roadmap (help welcome): paid-seva and group-seva forms, e-DIP (lucky draw)
form and date table, Telugu/Hindi/Tamil/Kannada/Malayalam UI.

## Install

**Chrome / Edge / Brave:** `chrome://extensions` → Developer mode →
"Load unpacked" → pick this folder.

**Firefox:** install from addons.mozilla.org once the listing is approved
(https://addons.mozilla.org/firefox/addon/ttd-quick-fill/). For development:
`about:debugging#/runtime/this-firefox` → "Load Temporary Add-on"
→ pick `manifest.json`. If the popup shows a **Grant access to TTD sites**
banner, press it once (site access can also be toggled under about:addons →
TTD Quick Fill → Permissions).

Permissions: `storage` (your saved pilgrims) and access to the two TTD sites
only. No debugger permission, no network access.

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
npm run test:e2e              # headless Firefox end-to-end test (see below)
```

The end-to-end test needs a local Firefox (`FIREFOX_BIN` defaults to the macOS
app path). It drives Firefox over Marionette, loads the extension temporarily,
serves `e2e/mock/pilgrim-details.html` (a React controlled form with the TTD
field names) at the real hostname through a local HTTP proxy, fills it from the
on-page button and from the popup message path, and checks React's state.
`HEADED=1 KEEP_OPEN=1 npm run test:e2e` runs it in a visible, slowed-down
Firefox window and leaves that window open with the extension loaded, so you
can try the popup and the on-page button by hand (and sign in to the real site
in the same window: only plain HTTP is proxied to the mock).

Layout:

| Path | Purpose |
|---|---|
| `manifest.json` | MV3, shared by Chrome and Firefox |
| `content/fill.js` | form detection, filling and verification, on-page button |
| `popup/` | pilgrim and contact management, fill trigger |
| `shared/validate.js` | pure validation (Aadhaar Verhoeff check etc.) |
| `shared/vault.js` | optional passphrase encryption of the saved details |
| `background.js` | answers the on-page button with the (decrypted) saved details |
| `tests/` | unit tests |
| `e2e/` | headless-Firefox end-to-end test with a mock TTD form |

The TTD site is a React single-page app with combo-box inputs; text is written
through `document.execCommand('insertText')` so React sees ordinary input
events, with a prototype-setter fallback. If TTD changes a field name, update
the constants at the top of `content/fill.js`.

## Provenance

Written from scratch and MIT-licensed. The author examined an existing
closed-source Chrome extension to learn the TTD form's field names, which are
facts about the TTD website; no code from it is reused and the design differs
(no debugger API, no synthetic keyboard driver). Status: v0.2.0 passes the end-to-end
test against a mock of the form on Firefox 159 but has not yet been exercised
against the live TTD site. Please open an issue with the page URL
and the field that stayed empty if a fill fails.

## Security

Without a passphrase the details sit as plain JSON in the browser's extension
storage, readable by anyone with access to the browser profile on disk. Turning
on **Passphrase protection** in the popup replaces them with one sealed box
(`shared/vault.js`):

- key: AES-256-GCM, derived with PBKDF2-HMAC-SHA256, 600,000 iterations
  (OWASP's figure), random 16-byte salt;
- every write uses a fresh 12-byte IV, and the box's purpose is bound in as
  associated data; GCM's tag means a wrong passphrase or a tampered box fails
  loudly, so no separate verifier is stored;
- after an unlock the raw key is kept in `storage.session` (memory only, gone
  when the browser closes) so the passphrase is asked once per session;
  **Lock now** forgets it immediately. Only the popup and the background
  script can read it; the content script on the TTD page asks the background
  script for the details and never sees the key;
- the passphrase is never stored and cannot be recovered.

What it does not protect against: malware running as you while the vault is
unlocked, a keylogger, or the TTD website itself (the form receives plain text
when you fill it, as it must).

## Privacy

See [PRIVACY.md](PRIVACY.md).
