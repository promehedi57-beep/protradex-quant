'use strict';
/* dashboard.js — Express REST + static host for APEX//QUANT terminal.
   GET  /api/status        -> {mode,engine,uptime_seconds,binance,oanda,otc,realtime,
                               signals:[{id,pair,market,direction,confidence,rsi,
                                         entryPrice,price,dp,candleTime,timestamp,expireAt,status}],
                               stats:{winRate,wins,losses,totalSignals,active,streak}}
   GET/POST /api/settings , POST /api/share-telegram , GET/POST /api/confidence,
   POST /api/confidence/adjust , POST /api/strategy , POST /api/telegram/test ,
   GET /health[z] , POST /webhook                                             */
const path = require('path');
const http = require('http');
const express = require('express');
const { SignalStore, clamp } = require('./signalStore');

function createDashboard(deps = {}) {
  const store = deps.store || new SignalStore();
  const telegram = deps.telegram || null;
  const cfg = deps.config || {};
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const staticDir = deps.staticDir || path.join(__dirname, 'public');
  if (deps.serveStatic !== false) app.use(express.static(staticDir, { index: 'index.html' }));

  const settings = Object.assign({
    confidenceThreshold: Number(cfg.CONFIDENCE_THRESHOLD) || 70,
    soundAlerts: true, binance: true, otc: true,
  }, deps.settings || {});

  const engineStatus = () => {
    const es = (typeof deps.engineStatus === 'function' ? deps.engineStatus() : {}) || {};
    return {
      mode: es.mode || 'live',
      engine: es.engine || 'apex-quant',
      uptime_seconds: es.uptime_seconds != null ? es.uptime_seconds
                        : Math.round((Date.now() - (deps.startedAt || Date.now())) / 1000),
      binance: es.binance !== false && settings.binance,
      oanda: !!(es.oanda && settings.oanda),
      otc: es.otc !== false && settings.otc,
      realtime: !!es.realtime, exec: !!es.exec,
    };
  };

  // ONCE — build the exact payload the terminal ingests (reused by REST + WS)
  const statusPayload = () => {
    const active = store.getActive(), st = store.stats(), es = engineStatus();
    return {
      ...es,
      serverTime: Date.now(),
      signals: active.map(s => ({
        id: s.id, pair: s.pair, market: s.market,
        direction: s.direction,                      // 'CALL' | 'PUT' — exact
        confidence: s.confidence, rsi: s.rsi,
        entryPrice: s.entryPrice, price: s.price, dp: s.dp,
        candleTime: s.candleTime, timestamp: s.timestamp, expireAt: s.expireAt,
        status: s.result || s.status || s.phase || 'active', source: s.source,
      })),
      stats: {
        winRate: st.winRate, wins: st.wins, losses: st.losses,
        totalSignals: st.totalSignals, active: st.active, streak: st.streak,
      },
    };
  };

  app.get('/api/status', (req, res) => res.json(statusPayload()));

  app.get('/api/pairs', (req, res) => {
    const act = store.getActive();
    const by = {};
    act.forEach(s => by[s.pair] = { symbol: s.pair, price: s.price, ...s });
    res.json({ pairs: Object.values(by), count: act.length });
  });

  app.get('/api/settings', (req, res) =>
    res.json({ settings: { confidenceThreshold: settings.confidenceThreshold, soundAlerts: settings.soundAlerts } }));
  app.post('/api/settings', (req, res) => {
    const b = req.body || {};
    if (Number.isFinite(+b.confidenceThreshold)) settings.confidenceThreshold = clamp(+b.confidenceThreshold, 50, 95);
    if (typeof b.soundAlerts === 'boolean') settings.soundAlerts = b.soundAlerts;
    if (typeof deps.onSettings === 'function') deps.onSettings({ ...settings });
    res.json({ ok: true, settings: { confidenceThreshold: settings.confidenceThreshold, soundAlerts: settings.soundAlerts } });
  });

  app.post('/api/share-telegram', async (req, res) => {
    if (!telegram) return res.status(503).json({ ok: false, error: 'telegram not configured' });
    try {
      const b = req.body || {};
      const out = await telegram.shareSignal({
        pair: b.pair, market: b.market || 'CRYPTO', direction: b.direction,
        confidence: b.confidence, rsi: b.rsi, entryPrice: b.entryPrice ?? b.price,
        candleTime: b.candleTime, timestamp: b.timestamp || Date.now(),
      }, req);
      res.json({ ok: true, sent: out?.sent !== false, ...out });
    } catch (e) { res.status(500).json({ ok: false, sent: false, error: e.message }); }
  });

  app.get('/api/confidence', (req, res) =>
    res.json({ confidence: (deps.getConfidence && deps.getConfidence()) || 0, threshold: settings.confidenceThreshold }));
  app.post('/api/confidence', (req, res) => {
    const v = clamp(req.body?.confidence ?? req.body?.value, 0, 100);
    if (typeof deps.setConfidence === 'function') deps.setConfidence(v);
    res.json({ ok: true, confidence: v });
  });
  app.post('/api/confidence/adjust', (req, res) => {
    const d = Number(req.body?.delta) || 0;
    const v = clamp(((deps.getConfidence && deps.getConfidence()) || 0) + d, 0, 100);
    if (typeof deps.setConfidence === 'function') deps.setConfidence(v);
    res.json({ ok: true, confidence: v });
  });

  app.post('/api/strategy', (req, res) => {
    const s = req.body || {};
    if (typeof deps.saveStrategy === 'function') deps.saveStrategy(s);
    else cfg.strategy = s;
    res.json({ ok: true, saved: s });
  });

  app.post('/api/telegram/test', async (req, res) => {
    if (!telegram) return res.status(503).json({ ok: false, error: 'telegram not configured' });
    try { const out = await telegram.testAlert(req.body?.message); res.json({ ok: true, sent: out?.sent !== false }); }
    catch (e) { res.status(503).json({ ok: false, error: e.message }); }
  });

  app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
  app.get('/healthz', (req, res) => res.status(200).end('ok'));
  if (typeof deps.webhook === 'function') app.post('/webhook', deps.webhook);
  else app.post('/webhook', (req, res) => res.json({ ok: true, received: true, echo: req.body || {} }));

  return { app, store, settings, statusPayload, engineStatus };
}

function boot(deps = {}) {
  if (!deps.store) deps.store = new SignalStore();
  deps.startedAt = deps.startedAt || Date.now();
  const dash = createDashboard(deps);
  const server = http.createServer(dash.app);
  global.__qxWs = global.__qxWs || {};
  global.__qxWs.statusPayload = dash.statusPayload;
  global.__qxWs.store = dash.store;
  return { server, ...dash, startedAt: deps.startedAt };
}

module.exports = { createDashboard, boot };
