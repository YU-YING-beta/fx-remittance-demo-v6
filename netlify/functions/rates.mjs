// 匯率：GET 回傳當日上傳的臺灣銀行牌告，沒有則回傳國際參考匯率（open.er-api.com，中間價）；PUT 上傳臺銀牌告 CSV。
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
const todayTpe = () => tpe(new Date()).slice(0, 10);

function parseRatesCsv(text) {
  const rates = {}, num = v => { const n = parseFloat(String(v || '').trim()); return isFinite(n) && n > 0 ? n : null; };
  String(text).replace(/^﻿/, '').split(/\r?\n/).forEach(raw => {
    const c = raw.split(/[,\t]/).map(x => x.trim().replace(/^"|"$/g, '').trim());
    const m = /\b([A-Z]{3})\b/.exec((c[0] || '').toUpperCase()), code = m ? m[1] : '';
    if (!CODES.includes(code)) return;
    let b = c.findIndex(x => /^(本行買入|buying)$/i.test(x)), s = c.findIndex(x => /^(本行賣出|selling)$/i.test(x));
    if ((b < 0 || s < 0) && c.length >= 14) { b = 1; s = 11; }
    if (b < 0 || s < 0) return;
    const q = { cashBuy: num(c[b + 1]), spotBuy: num(c[b + 2]), cashSell: num(c[s + 1]), spotSell: num(c[s + 2]) };
    if (q.spotBuy == null || q.spotSell == null || !(q.spotSell > q.spotBuy)) return;
    rates[code] = q;
  });
  return rates;
}
const dataTimeFromName = n => { const m = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(n || ''); return m ? m[1] + '/' + m[2] + '/' + m[3] + ' ' + m[4] + ':' + m[5] : null; };

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
    const up = await store.get('upload', { type: 'json' });
    if (up && String(up.dataTime || '').slice(0, 10) === todayTpe()) return json(Object.assign({ ok: true }, up), 200, CORS);
    const ref = await refRates(store);
    if (ref) return json(ref, 200, CORS);
    if (up) return json(Object.assign({ ok: true }, up), 200, CORS);
    return json({ ok: false, empty: true }, 200, CORS);
  }
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch (e) { return json({ ok: false, error: '資料格式錯誤' }, 400); }
    const csv = String(body && body.csv || '');
    if (csv.length > 200 * 1024) return json({ ok: false, error: '檔案過大，請確認是臺銀牌告 CSV' }, 413);
    const rates = parseRatesCsv(csv), n = Object.keys(rates).length;
    if (n < 10) return json({ ok: false, error: '只辨識出 ' + n + ' 種幣別，請確認上傳的是臺灣銀行牌告匯率 CSV' }, 400);
    const fileName = String(body.fileName || '').slice(0, 120);
    const doc = { bank: '臺灣銀行', source: 'upload', rates, count: n, dataTime: dataTimeFromName(fileName), fileName, uploadedAt: new Date().toISOString() };
    await store.setJSON('upload', doc);
    return json(Object.assign({ ok: true }, doc));
  }
  return json({ ok: false, error: 'method not allowed' }, 405);
};

export const config = { path: '/api/rates' };
