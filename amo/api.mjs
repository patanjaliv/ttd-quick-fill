// Minimal authenticated AMO v5 client: node amo/api.mjs GET addon/<slug-or-guid>/
import { createHmac, randomUUID } from 'node:crypto';
export function jwt() {
  const key = process.env.WEB_EXT_API_KEY, secret = process.env.WEB_EXT_API_SECRET;
  if (!key || !secret) throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET.');
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: key, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
export async function amo(method, path, body) {
  const res = await fetch(`https://addons.mozilla.org/api/v5/addons/${path}`, {
    method, headers: { Authorization: `JWT ${jwt()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
if (process.argv[1]?.endsWith('api.mjs')) {
  const [method, path, body] = process.argv.slice(2);
  const r = await amo(method, path, body ? JSON.parse(body) : undefined);
  console.log(r.status, JSON.stringify(r.json, null, 1).slice(0, 3000));
}
