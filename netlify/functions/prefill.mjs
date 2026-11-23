// 預填代號暫存：GET 讀取、PUT 寫入、PATCH 標記已帶入。代號當日有效（由前端檢查 validUntil）。
import { getStore } from '@netlify/blobs';

const CODE_RE = /^[0-9A-Z]{8}$/;
const MAX_BYTES = 64 * 1024;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export default async (req, context) => {
  const code = String(context.params.code || '').toUpperCase();
  if (!CODE_RE.test(code)) return json({ ok: false, error: 'bad code' }, 400);
  const store = getStore({ name: 'prefill', consistency: 'strong' });

  if (req.method === 'GET') {
    const data = await store.get(code, { type: 'json' });
    return json({ exists: !!data, data: data || null });
  }
  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ ok: false, error: 'too large' }, 413);
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return json({ ok: false, error: 'bad json' }, 400); }
    if (!obj || typeof obj.payload !== 'string' || typeof obj.validUntil !== 'string') return json({ ok: false, error: 'bad payload' }, 400);
    const exists = await store.get(code);
    if (exists) return json({ ok: false, error: 'code exists' }, 409);
    await store.setJSON(code, { payload: obj.payload, t: obj.t || '', created: Date.now(), validUntil: obj.validUntil, used: false });
    return json({ ok: true });
  }
  if (req.method === 'PATCH') {
    const data = await store.get(code, { type: 'json' });
    if (!data) return json({ ok: false, error: 'not found' }, 404);
    if (!data.used) await store.setJSON(code, Object.assign(data, { used: true, usedAt: Date.now() }));
    return json({ ok: true });
  }
  return json({ ok: false, error: 'method not allowed' }, 405);
};

export const config = { path: '/api/prefill/:code' };
