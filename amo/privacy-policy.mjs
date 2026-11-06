// Pushes PRIVACY.md to the AMO listing's privacy-policy field
// (PATCH /api/v5/addons/addon/{guid}/eula_policy/). web-ext sign cannot set it.
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';

const key = process.env.WEB_EXT_API_KEY, secret = process.env.WEB_EXT_API_SECRET;
if (!key || !secret) { console.error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET.'); process.exit(2); }
const guid = JSON.parse(readFileSync('manifest.json', 'utf8')).browser_specific_settings.gecko.id;
const policy = readFileSync('PRIVACY.md', 'utf8').replace(/^# .*\n+/, '');

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: key, jti: randomUUID(), iat: now, exp: now + 60 })}`;
const jwt = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;

const url = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(guid)}/eula_policy/`;
const res = await fetch(url, { method: 'PATCH', headers: { Authorization: `JWT ${jwt}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ privacy_policy: { 'en-US': policy } }) });
const body = await res.text();
console.log(res.status, body.slice(0, 500));
process.exit(res.ok ? 0 : 1);
