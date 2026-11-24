// 匯率：GET 回傳國際參考匯率（ExchangeRate-API，open.er-api.com，中間價），快取 6 小時。
import { getStore } from '@netlify/blobs';

const CODES = ['USD','EUR','JPY','CNY','HKD','GBP','AUD','CAD','SGD','CHF','NZD','ZAR','THB','SEK'];
const REF_URL = 'https://open.er-api.com/v6/latest/USD';
const REF_TTL = 6 * 60 * 60 * 1000;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra)
});
const tpe = d => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = t => (p.find(x => x.type === t) || {}).value;
  return g('year') + '/' + g('month') + '/' + g('day') + ' ' + g('hour').replace('24', '00') + ':' + g('minute');
};
async function refRates(store) {
  const cached = await store.get('ref', { type: 'json' });
  if (cached && Date.now() - cached.fetchedAt < REF_TTL) return cached.doc;
  try {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(REF_URL, { signal: ctl.signal }); clearTimeout(tm);
    const d = await r.json();
    if (d.result !== 'success' || !d.rates || !d.rates.TWD) throw new Error('bad ref');
    const rates = {};
    CODES.forEach(c => { if (d.rates[c]) { const mid = +(d.rates.TWD / d.rates[c]).toFixed(c === 'JPY' ? 5 : 4); rates[c] = { spotBuy: mid, spotSell: mid, cashBuy: mid, cashSell: mid }; } });
    const doc = { ok: true, source: 'ref', provider: 'ExchangeRate-API (open.er-api.com)', rates, count: Object.keys(rates).length, dataTime: tpe(new Date(d.time_last_update_unix * 1000)), uploadedAt: new Date().toISOString() };
    await store.setJSON('ref', { fetchedAt: Date.now(), doc });
    return doc;
  } catch (e) {
    return cached ? cached.doc : null;
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const store = getStore({ name: 'fx-rates', consistency: 'strong' });
  if (req.method === 'GET') {
    const ref = await refRates(store);
    if (ref) return json(ref, 200, CORS);
    return json({ ok: false, empty: true }, 200, CORS);
  }
  return json({ ok: false, error: 'method not allowed' }, 405);
};

export const config = { path: '/api/rates' };
