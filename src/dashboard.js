'use strict';

/**
 * src/dashboard.js
 * Express HTTP + REST API for the APEX//QUANT terminal.
 *
 * Frontend contract (new index.html):
 *   GET  /api/status          → { signals:[...], stats:{...}, connections:{...} }
 *   GET  /api/settings        → { settings:{ confidenceThreshold, soundAlerts } }
 *   POST /api/settings        → sync threshold + sound
 *   POST /api/share-telegram  → signal payload → Telegram targets
 *   WS   /ws                  → same payload as /api/status, pushed every 1s
 *
 * Legacy endpoints kept: /api/pairs, /api/candles/:symbol, /api/strategy,
 *   /api/gemini/*, /api/ai/scan, /api/analyze-chart, /api/execution,
 *   /api/confidence, /webhook, /health
 */

const path = require('path');
const express = require('express');
const cfg = require('./config');

/* ── UI settings (runtime, memory) — synced with the terminal slider ── */
const uiSettings = { confidenceThreshold: 60, soundAlerts: false };

/* ── symbol formatters (engine symbol → terminal pair label) ── */
const CRYPTO_QUOTES = ['USDT', 'USDC', 'BUSD', 'TUSD', 'FDUSD', 'USD', 'BTC', 'ETH'];
const FX_CURRENCIES = ['EUR', 'GBP', 'USD', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'XAU', 'XAG', 'BTC', 'ETH', 'SOL'];

function fmtPair(sym) {
  const s = String(sym || '').toUpperCase();
  if (!s) return sym;
  if (s.endsWith('_OTC')) {
    const fx = s.replace(/_OTC$/, '');
    for (let i = 0; i < FX_CURRENCIES.length; i++) {
      const c = FX_CURRENCIES[i];
      if (fx.startsWith(c)) {
        const rest = fx.slice(c.length);
        if (FX_CURRENCIES.includes(rest)) return c + '/' + rest + ' OTC';
      }
    }
    return fx + ' OTC';
  }
  for (const q of CRYPTO_QUOTES) {
    if (s.endsWith(q) && s.length > q.length) return s.slice(0, -q.length) + '/' + q;
  }
  return s;
}

function dpFor(sym, price) {
  const s = String(sym || '').toUpperCase();
  if (s.includes('JPY')) return 3;
  if (s.endsWith('_OTC')) return 5;
  const p = Number(price) || 0;
  if (p >= 100000) return 1;
  if (p >= 10) return 2;
  if (p >= 1) return 4;
  return 5;
}

const clampN = (v, a, b) => Math.min(b, Math.max(a, Number(v) || a));

/* ── shared payload: /api/status + WS broadcast ── */
function buildStatusPayload({ engine, rt, telegram, metrics, feedsStatus }) {
  const now = Date.now();
  const tf = cfg.ACTIVE_TIMEFRAME || 15;
  const tfSec = tf * 60;
  const signals = [];
  const snap = (typeof engine.getPairsSnapshot === 'function') ? engine.getPairsSnapshot(300) : [];
  const floor = (rt && typeof rt.getConfidence === 'function') ? rt.getConfidence() : 0;

  for (const p of snap) {
    if (p.signal !== 'CALL' && p.signal !== 'PUT') continue;
    const conf = Math.round(Number(p.confidence) || 0);
    if (conf < floor) continue;
    const last = (engine.lastSignals && engine.lastSignals.get) ? engine.lastSignals.get(p.symbol) : null;
    const ts = (last && last.t) || now;
    signals.push({
      id: p.symbol,
      pair: fmtPair(p.symbol),
      market: p.universe === 'otc' ? 'OTC' : p.universe === 'fx' ? 'FX' : 'CRYPTO',
      direction: p.signal,
      confidence: conf,
      rsi: Math.round((Number(p.rsi) || 50) * 10) / 10,
      entryPrice: Number(p.price) || 0,
      dp: dpFor(p.symbol, p.price),
      candleTime: tfSec,
      timestamp: ts,
      status: '',
      source: 'live',
    });
  }

  const fs = (typeof feedsStatus === 'function') ? feedsStatus() : {};
  const st = (typeof engine.status === 'function') ? engine.status() : {};

  return {
    ok: true,
    uptime_seconds: st.uptime || 0,
    signals,
    stats: {
      winRate: (metrics && Number.isFinite(metrics.winRate)) ? metrics.winRate : null,
      wins: (metrics && Number.isFinite(metrics.wins)) ? metrics.wins : 0,
      losses: (metrics && Number.isFinite(metrics.losses)) ? metrics.losses : 0,
      totalSignals: engine.signalsTotal || 0,
    },
    connections: { binance: !!fs.binance, oanda: !!fs.oanda, otc: !!fs.otc },
  };
}

function basicAuth(req, res, next) {
  const u = req.app.locals.u, p = req.app.locals.p;
  if (!u && !p) return next();
  const b64 = (req.headers.authorization || '').replace(/^Basic\s+/i, '');
  if (!b64) return res.status(401).set('WWW-Authenticate', 'Basic realm="apex"').end();
  const [user, pass] = Buffer.from(b64, 'base64').toString('utf8').split(':');
  if (user !== u || pass !== p) return res.status(403).end();
  next();
}

function createDashboard({ engine, ai, feedsStatus, rt, telegram, metrics }) {
  const app = express();
  app.locals.u = cfg.DASHBOARD_USER || '';
  app.locals.p = cfg.DASHBOARD_PASS || '';

  app.use(express.json({ limit: '20mb' }));          // chart screenshots (base64)
  app.use(basicAuth);
  app.use(express.static(path.join(__dirname, 'public')));

  /* ═══ NEW CONTRACT (APEX//QUANT) ═══ */
  app.get('/api/status', (req, res) => {
    res.json(buildStatusPayload({ engine, rt, telegram, metrics, feedsStatus }));
  });

  app.get('/api/settings', (req, res) => {
    res.json({ settings: { ...uiSettings } });
  });

  app.post('/api/settings', (req, res) => {
    const b = req.body || {};
    if (Number.isFinite(+b.confidenceThreshold)) {
      uiSettings.confidenceThreshold = clampN(+b.confidenceThreshold, 50, 95);
      if (rt && typeof rt.setConfidence === 'function') rt.setConfidence(uiSettings.confidenceThreshold);
    }
    if (typeof b.soundAlerts === 'boolean') uiSettings.soundAlerts = b.soundAlerts;
    res.json({ ok: true, settings: { ...uiSettings } });
  });

  app.post('/api/share-telegram', async (req, res) => {
    const b = req.body || {};
    if (!b.pair || !b.direction) return res.status(400).json({ ok: false, error: 'pair + direction required' });
    if (!telegram || typeof telegram.shareSignal !== 'function') {
      return res.status(503).json({ ok: false, error: 'Telegram bot not configured' });
    }
    try {
      const sent = await telegram.shareSignal(b);
      res.json({ ok: !!sent, sent: !!sent });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /* ═══ LEGACY / EXTRA ENDPOINTS (kept) ═══ */
  app.get('/api/pairs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 300);
    const market = String(req.query.market || 'all');
    res.json(engine.getPairsSnapshot(limit, market));
  });

  app.get('/api/candles/:symbol', (req, res) => {
    const sym = String(req.params.symbol).toUpperCase();
    const tf = Number(req.query.tf) || cfg.ACTIVE_TIMEFRAME || 15;
    const tfMs = tf * 60000;
    const hist = (engine.tf && engine.tf.getCandles) ? engine.tf.getCandles(sym, tf) : [];
    const cur = (engine.tf && engine.tf.current) ? engine.tf.current(sym, tf) : null;
    const now = Date.now();
    const openAt = cur ? cur.openAt : now - (now % tfMs);
    const price = (engine.livePrices && engine.livePrices.get(sym)) ?? (engine.lastClose && engine.lastClose.get(sym));
    res.json({
      symbol: sym, tf, history: hist,
      current: cur ? { ...cur, price } : null,
      candle: {
        index: Math.floor(openAt / tfMs), openAt, closeAt: openAt + tfMs,
        remaining: Math.max(0, tfMs - (now - openAt)),
        direction: (price != null && cur && price >= cur.o) ? 'bullish' : (price != null ? 'bearish' : 'flat'),
        price: price ?? null,
      },
    });
  });

  app.post('/api/strategy', (req, res) => {
    const b = req.body || {};
    if (b.rsiLow != null) cfg.RULES.RSI_LOW = clampN(b.rsiLow, 1, 99);
    if (b.rsiHigh != null) cfg.RULES.RSI_HIGH = clampN(b.rsiHigh, 1, 99);
    if (b.zscoreMin != null) cfg.RULES.ZSCORE_MIN = clampN(b.zscoreMin, 0, 10);
    if (b.adxMin != null) cfg.RULES.ADX_MIN = clampN(b.adxMin, 5, 60);
    if (b.srBreakout != null) cfg.RULES.SR_BREAKOUT_PCT = clampN(b.srBreakout, 0.01, 5);
    res.json({ ok: true, RULES: cfg.RULES });
  });

  app.post('/api/gemini/key', (req, res) => {
    const k = req.body && req.body.key;
    if (!k || typeof k !== 'string') return res.status(400).json({ ok: false, error: 'key required' });
    if (ai && typeof ai.setApiKey === 'function') ai.setApiKey(k);
    res.json({ ok: true, key: ai ? ai.getApiKey() : '' });
  });
  app.post('/api/gemini/clear', (req, res) => { if (ai) ai.setApiKey(''); res.json({ ok: true }); });

  app.post('/api/ai/scan', async (req, res) => {
    if (!ai) return res.status(503).json({ ok: false, error: 'AI layer disabled' });
    const sym = String((req.body && req.body.symbol) || '').toUpperCase();
    const tf = Number((req.body && req.body.tf) || cfg.ACTIVE_TIMEFRAME || 15);
    const candles = (engine.tf && engine.tf.getCandles ? engine.tf.getCandles(sym, tf) : []).slice(-(cfg.GEMINI_DATA_CANDLES || 50));
    if (!candles.length) return res.json({ ok: false, error: 'No candle data yet for ' + sym });
    const out = await ai.analyzeData(candles, { tf });   // never rejects
    res.json(out.ok ? { ok: true, symbol: sym, tf, analysis: safeJson(out.text) } : { ok: false, error: out.error });
  });

  app.post('/api/analyze-chart', async (req, res) => {
    if (!ai) return res.status(503).json({ ok: false, error: 'AI layer disabled' });
    const img = req.body && req.body.image;
    const tf = Number((req.body && req.body.tf) || 15);
    if (!img) return res.status(400).json({ ok: false, error: 'image (base64 data URL) required' });
    const out = await ai.analyzeImage(img, { tf });      // never rejects
    res.json(out.ok ? { ok: true, analysis: safeJson(out.text) } : { ok: false, error: out.error });
  });

  app.post('/api/execution', (req, res) => {
    const v = req.body && req.body.enabled;
    if (typeof v === 'boolean' && rt && typeof rt.setExecution === 'function') rt.setExecution(v);
    res.json({ execution: rt ? rt.getExecution() : false });
  });

  app.post('/api/confidence', (req, res) => {
    const v = Number(req.body && req.body.value);
    if (Number.isFinite(v) && rt) rt.setConfidence(v);
    res.json({ confidence: rt ? rt.getConfidence() : 65 });
  });

  app.post('/webhook', (req, res) => {
    try { if (engine.signalBus) engine.signalBus.publish('signal', req.body); } catch (e) {}
    res.json({ ok: true });
  });

  app.get('/health', (req, res) => res.json({ ok: true, t: new Date().toISOString() }));

  return app;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

module.exports = { createDashboard, buildStatusPayload, fmtPair };
