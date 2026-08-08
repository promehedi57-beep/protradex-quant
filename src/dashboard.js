'use strict';
/* src/dashboard.js — Express app: static UI + REST API on cfg.PORT. */
const path = require('path');
const express = require('express');

function basicAuth(req, res, next) {
  const u = req.app.locals.u, p = req.app.locals.p;
  if (!u && !p) return next();
  const b64 = (req.headers.authorization || '').replace(/^Basic\s+/i, '');
  if (!b64) return res.status(401).set('WWW-Authenticate', 'Basic realm="qx"').end();
  const [user, pass] = Buffer.from(b64, 'base64').toString('utf8').split(':');
  if (user !== u || pass !== p) return res.status(403).end();
  next();
}

function createDashboard({ engine, ai, feedsStatus, rt, telegram }) {
  const app = express();
  app.locals.u = process.env.DASHBOARD_USER || ''; app.locals.p = process.env.DASHBOARD_PASS || '';
  app.use(express.json({ limit: '20mb' }));                 // allow chart screenshots (base64)
  app.use(basicAuth);
  app.use(express.static(path.join(__dirname, 'public')));

  /* ── Status ── */
  app.get('/api/status', (req, res) => {
    const s = engine.status(); const f = feedsStatus();
    res.json({ uptime_seconds:s.uptime, binance:f.binance, oanda:f.oanda, otc:f.otc,
      signals_total:s.signals_total, execution:rt?.getExecution()??false, confidence:rt?.getConfidence()??65,
      timeframe:cfgACTIVE(), tfs:cfgTFs(), gemini: ai ? ai.status() : null,
      connections:{ binance:f.binance, oanda:f.oanda, otc:f.otc, watch:s.pairs } });
  });

  /* ── Pairs (market filter) ── */
  app.get('/api/pairs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 300);
    const market = String(req.query.market || 'all');         // all | real | otc
    res.json(engine.getPairsSnapshot(limit, market));
  });

  /* ── Candle tracker (live forming + history) for a symbol ── */
  app.get('/api/candles/:symbol', (req, res) => {
    const sym = String(req.params.symbol).toUpperCase();
    const tf = Number(req.query.tf) || rt?.getActiveTf?.() || 15;
    const hist = engine.tf.getCandles(sym, tf);
    const cur = engine.tf.current(sym, tf);
    const now = Date.now(); const tfMs = tf * 60000;
    const openAt = cur ? cur.openAt : now - (now % tfMs);
    const remaining = Math.max(0, tfMs - (now - openAt));
    const price = engine.livePrices.get(sym) ?? engine.lastClose.get(sym);
    const dir = price >= (cur ? cur.o : price) ? 'bullish' : 'bearish';
    res.json({ symbol:sym, tf, history:hist, current:cur ? {...cur, price} : null,
      candle:{ index: Math.floor(openAt/tfMs), openAt, closeAt: openAt+tfMs, remaining, direction:dir, price } });
  });

  /* ── Strategy / indicator overrides (mutable) ── */
  app.post('/api/strategy', (req, res) => {
    const b = req.body || {}; const R = require('./config').RULES;
    if (b.rsiLow != null) R.RSI_LOW = clampNum(b.rsiLow,1,99);
    if (b.rsiHigh != null) R.RSI_HIGH = clampNum(b.rsiHigh,1,99);
    if (b.zscoreMin != null) R.ZSCORE_MIN = clampNum(b.zscoreMin,0,10);
    if (b.adxMin != null) R.ADX_MIN = clampNum(b.adxMin,5,60);
    if (b.srBreakout != null) R.SR_BREAKOUT_PCT = clampNum(b.srBreakout,0.01,5);
    res.json({ ok:true, RULES:R });
  });

  /* ── Gemini key (dynamic from UI) ── */
  app.post('/api/gemini/key', (req, res) => {
    const k = req.body?.key; if (!k || typeof k !== 'string') return res.status(400).json({ ok:false, error:'key required' });
    ai?.setApiKey(k); res.json({ ok:true, key: ai ? ai.getApiKey() : '' });
  });
  app.post('/api/gemini/clear', (req, res) => { ai?.setApiKey(''); res.json({ ok:true }); });

  /* ── AI: data scan (isolated) ── */
  app.post('/api/ai/scan', async (req, res) => {
    const sym = String(req.body?.symbol || '').toUpperCase();
    const tf = Number(req.body?.tf) || 15;
    const candles = engine.tf.getCandles(sym, tf).slice(-(require('./config').GEMINI_DATA_CANDLES || 50));
    if (!candles.length) return res.json({ ok:false, error:'No candle data yet for ' + sym });
    const out = await ai.analyzeData(candles, { tf });   // never rejects
    res.json({ ok:out.ok, symbol:sym, tf, ...(out.ok ? { analysis: safeJson(out.text) } : { error: out.error }) });
  });

  /* ── AI: vision chart upload (isolated) ── */
  app.post('/api/analyze-chart', async (req, res) => {
    const img = req.body?.image; const tf = Number(req.body?.tf) || 15;
    if (!img) return res.status(400).json({ ok:false, error:'image (base64 data URL) required' });
    const out = await ai.analyzeImage(img, { tf });      // never rejects
    res.json(out.ok ? { ok:true, analysis: safeJson(out.text) } : { ok:false, error:out.error });
  });

  /* ── Telegram test alert ── */
  app.post('/api/telegram/test', async (req, res) => {
    if (!telegram || !telegram.hasToken()) return res.json({ ok:false, error:'Telegram bot not configured' });
    try { const r = await telegram.sendTest(); res.json({ ok:true, sent:r }); }
    catch (e) { res.json({ ok:false, error:e.message }); }
  });

  app.post('/api/execution', (req, res) => { const v = req.body?.enabled; if (typeof v === 'boolean' && rt) rt.setExecution(v); res.json({ execution: rt?.getExecution() ?? false }); });
  app.post('/api/confidence', (req, res) => { const v = Number(req.body?.value); if (Number.isFinite(v) && rt) rt.setConfidence(v); res.json({ confidence: rt?.getConfidence() ?? 65 }); });
  app.post('/webhook', (req, res) => { engine.signalBus?.publish('signal', req.body); res.json({ ok:true }); });
  app.get('/health', (req, res) => res.json({ ok:true, t:new Date().toISOString() }));

  return app;
}

function cfgACTIVE() { return require('./config').ACTIVE_TIMEFRAME; }
function cfgTFs() { return require('./config').TIMEFRAMES; }
const clampNum = (v,a,b) => Math.min(b, Math.max(a, Number(v) || a));
function safeJson(text) { try { return JSON.parse(text); } catch { return { raw: text }; } }

module.exports = { createDashboard };
