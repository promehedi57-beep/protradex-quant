'use strict';

/**
 * src/dashboard.js
 * HTTP dashboard + REST API on cfg.PORT (Render exposes one port).
 * API shapes match the QX·01 index.html parser:
 *   GET /api/status → {uptime_seconds, binance, oanda, otc, signals_total, execution, confidence, timeframe}
 *   GET /api/pairs  → array: [{symbol, price, change, volume, rsi, zscore, signal, confidence, direction, universe}]
 */

const path = require('path');
const express = require('express');

function basicAuth(req, res, next) {
  const u = req.app.locals.dashUser, p = req.app.locals.dashPass;
  if (!u && !p) return next();
  const b64 = (req.headers.authorization || '').replace(/^Basic\s+/i, '');
  if (!b64) return res.status(401).set('WWW-Authenticate', 'Basic realm="qx"').end();
  const [user, pass] = Buffer.from(b64, 'base64').toString('utf8').split(':');
  if (user !== u || pass !== p) return res.status(403).end();
  next();
}

function createDashboard({ engine, metrics, feedsStatus = () => ({}), rt }) {
  const app = express();
  app.locals.dashUser = process.env.DASHBOARD_USER || '';
  app.locals.dashPass = process.env.DASHBOARD_PASS || '';

  app.use(express.json({ limit: '1mb' }));
  app.use(basicAuth);
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/status', (req, res) => {
    const s = engine.status();
    const fs = feedsStatus();
    res.json({
      uptime_seconds: s.uptime,
      binance: fs.binance === true,
      oanda: fs.oanda === true,
      otc: fs.otc === true,
      signals_total: s.signals_total,
      execution: rt ? rt.getExecution() : false,
      confidence: rt ? rt.getConfidence() : 65,
      timeframe: s.timeframe,
      tfs: s.tfs || [],
      connections: { binance: fs.binance, oanda: fs.oanda, otc: fs.otc, watch: s.pairs },
    });
  });

  app.get('/api/pairs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 24, 200);
    res.json(engine.getPairsSnapshot(limit));
  });

  app.post('/api/execution', (req, res) => {
    const v = req.body && req.body.enabled;
    if (typeof v === 'boolean' && rt) rt.setExecution(v);
    res.json({ execution: rt ? rt.getExecution() : false });
  });

  app.post('/api/confidence', (req, res) => {
    const v = Number(req.body && req.body.value);
    if (Number.isFinite(v) && rt) rt.setConfidence(v);
    res.json({ confidence: rt ? rt.getConfidence() : 65 });
  });

  app.post('/api/confidence/adjust', (req, res) => {
    const d = Number(req.body && req.body.delta);
    if (Number.isFinite(d) && rt) rt.setConfidence(rt.getConfidence() + d);
    res.json({ confidence: rt ? rt.getConfidence() : 65 });
  });

  app.post('/webhook', (req, res) => {
    const secret = process.env.WEBHOOK_SECRET;
    const inAuth = req.headers['x-webhook-secret'] || req.query.secret;
    if (secret && inAuth !== secret) return res.status(403).json({ ok: false });
    try { engine.signalBus && engine.signalBus.publish('signal', req.body); } catch (e) {}
    res.json({ ok: true });
  });

  app.get('/health', (req, res) => res.json({ ok: true, t: new Date().toISOString() }));

  return app;
}

module.exports = { createDashboard };
