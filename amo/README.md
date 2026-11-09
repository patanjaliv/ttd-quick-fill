# Submitting to addons.mozilla.org

Credentials: generate a JWT issuer/secret at
https://addons.mozilla.org/developers/addon/api/key/ and keep them in
`~/.config/ttd-quick-fill/amo.env` (mode 600):

    WEB_EXT_API_KEY=user:12345:678
    WEB_EXT_API_SECRET=...

Then:

    npm run build
    npm run amo:submit     # web-ext sign --channel listed (new version, waits for review)
    npm run amo:privacy    # pushes PRIVACY.md to the listing's privacy-policy field

`amo/metadata.json` is sent with every version (listing text, category,
licence, release notes, reviewer notes). Edit it before a release.

## Previews

`node amo/previews.mjs` renders `amo/previews/*.html` to 1280x800 PNGs with headless Firefox;
`--upload` pushes them to the listing with captions. AMO throttles listing writes hard
(minutes to an hour), so space out repeated uploads.
