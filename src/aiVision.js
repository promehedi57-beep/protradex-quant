'use strict';
/* src/aiVision.js — OPTIONAL, fully-decoupled Gemini layer.
   Used ONLY by /api/ai/scan and /api/analyze-chart. Never imported by the
   tick/engine/signal path. Every failure resolves to {ok:false, error} — never rejects. */
const cfg = require('./config');

const ENDPOINT = (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

class AIVision {
  constructor() {
    this._key = cfg.GEMINI_API_KEY || '';   // starts from env; updatable from UI
    this.model = cfg.GEMINI_MODEL || 'gemini-2.0-flash';
    this.timeout = cfg.GEMINI_TIMEOUT_MS || 8000;
    this.lastStatus = { keySet: !!this._key, lastCall: 0, lastOk: false, lastError: null };
    this._inFlight = 0;
  }
  setApiKey(k) { this._key = (k || '').trim(); this.lastStatus.keySet = !!this._key; this.lastStatus.lastError = null; return this.lastStatus.keySet; }
  getApiKey() { return this._key ? this._key.slice(0, 6) + '…' + this._key.slice(-4) : ''; }
  hasKey() { return !!this._key; }

  _request(parts) {
    if (!this.hasKey()) return Promise.resolve({ ok:false, error:'No Gemini API key set' });
    this._inFlight++; this.lastStatus.lastCall = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeout);
    return fetch(ENDPOINT(this.model, this._key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ contents:[{ parts }], generationConfig: { maxOutputTokens: cfg.GEMINI_MAX_TOKENS, temperature: 0.4 } }),
    }).then(async (r) => {
      clearTimeout(t); if (!r.ok) { const b = await r.text().catch(()=>''); throw new Error('HTTP ' + r.status + ' ' + b.slice(0,120)); }
      const j = await r.json();
      const text = j?.candidates?.[0]?.content?.parts?.map(p=>p.text).join('') || '';
      this.lastStatus.lastOk = true; this.lastStatus.lastError = null;
      return { ok:true, text, raw:j };
    }).catch((e) => {
      clearTimeout(t);
      const msg = e?.name === 'AbortError' ? 'Gemini timeout (' + this.timeout + 'ms)' : e.message;
      this.lastStatus.lastOk = false; this.lastStatus.lastError = msg;
      return { ok:false, error:msg };   // ← NEVER throws. UI shows this error only.
    }).finally(() => { this._inFlight--; });
  }

  /* Data-based: 50-candle OHLCV text → pattern/S-R/trend analysis */
  analyzeData(candles, opts = {}) {
    const lines = (candles || []).map((c, i) => `${i}:O${c.o} H${c.h} L${c.l} C${c.c} V${c.v}`).join('\n');
    const prompt = `You are a binary-options technical analyst. Analyze this ${opts.tf||15}m OHLCV candle data (last ${(candles||[]).length} candles):
${lines}
Reply STRICTLY as JSON: {"direction":"CALL|PUT|NEUTRAL","confidence":0-100,"sr":{"support":x,"resistance":x},"trend":"bullish|bearish|ranging","reason":"<short>"}`;
    return this._request([{ text: prompt }]);
  }

  /* Vision: drag-and-drop chart screenshot (data URL / base64) */
  analyzeImage(base64Data, opts = {}) {
    if (!base64Data) return Promise.resolve({ ok:false, error:'No image provided' });
    const mime = (base64Data.match(/^data:(image\/[a-z+]+);base64,/i) || [null, 'image/png'])[1];
    const b64 = base64Data.replace(/^data:[^,]+,/, '');
    const prompt = `You are a binary-options chart analyst. Read this ${opts.tf||15}m chart screenshot. Reply STRICTLY as JSON: {"direction":"CALL|PUT|NEUTRAL","confidence":0-100,"sr":{"support":x,"resistance":x},"trend":"bullish|bearish|ranging","reason":"<short>"}`;
    return this._request([{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }]);
  }

  status() { return { ...this.lastStatus, inFlight: this._inFlight }; }
}

module.exports = { AIVision };
