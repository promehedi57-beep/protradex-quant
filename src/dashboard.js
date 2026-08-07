'use strict';
const path = require('path');
const express = require('express');
const cfg = require('./config');
const rt = require('./state');

const human = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s/86400)+'d '+Math.floor(s%86400/3600)+'h '+Math.floor(s%3600/60)+'m '+(s%60)+'s'; };

function createDashboard({ engine, metrics, feedsStatus }) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Optional Basic Auth
  if (cfg.DASHBOARD_USER && cfg.DASHBOARD_PASS) {
    app.use((req, res, next) => {
      const b64 = (req.headers.authorization || '').replace(/^Basic\s+/i, '');
      const buf = Buffer.from(b64, 'base64').toString('utf8');
      const [u, p] = buf.split(':');
      if (u === cfg.DASHBOARD_USER && p === cfg.DASHBOARD_PASS) return next();
      res.set('WWW-Authenticate', 'Basic realm="ProTradeX"');
      return res.status(401).end();
    });
  }

  app.use(express.static(path.join(__dirname, 'public')));

  /* ---------- REST API ---------- */
  app.get('/api/status', (req, res) => {
    res.json({
      uptimeS: Math.round((Date.now() - metrics.startedAt) / 1000),
      uptimeHuman: human((Date.now() - metrics.startedAt) / 1000),
      binanceConnected: !!feedsStatus.binance,
      oandaConnected: !!feedsStatus.oanda,
      wsConnected: !!(feedsStatus.binance || feedsStatus.oanda),
      pairs: engine.states.size,
      signals: metrics.signals,
      candles: engine.stats.candles,
      latencyP95Ms: metrics.p95(),
      executionEnabled: rt.getExecution(),
      minConfidence: rt.getConfidence(),
      lastCandleAgo: rt.state.lastCandleAt ? Math.round((Date.now() - rt.state.lastCandleAt) / 1000) : null
    });
  });

  app.get('/api/pairs', (req, res) => {
    const n = Math.min(50, parseInt(req.query.limit, 10) || 20);
    res.json(engine.getPairsSnapshot(n));
  });

  app.post('/api/execution', (req, res) => {
    const v = !!(req.body && req.body.enabled);
    rt.setExecution(v);
    res.json({ ok: true, executionEnabled: rt.getExecution() });
  });

  app.post('/api/confidence', (req, res) => {
    const v = Number(req.body && req.body.value);
    if (!Number.isFinite(v)) return res.status(400).json({ ok: false, error: 'value: number দরকার' });
    res.json({ ok: true, minConfidence: rt.setConfidence(v) });
  });

  app.post('/api/confidence/adjust', (req, res) => {
    const d = Number(req.body && req.body.delta) || 0;
    res.json({ ok: true, minConfidence: rt.setConfidence(rt.getConfidence() + d) });
  });

  /* TradingView webhook — একই পোর্টে (Render-ফ্রেন্ডলি) */
  if (cfg.WEBHOOK_ENABLED) {
    app.post('/webhook', (req, res) => {
      const secret = cfg.WEBHOOK_SECRET;
      if (secret && req.get('x-webhook-secret') !== secret && req.query.secret !== secret) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      }
      const body = req.body || {};
      const symbol = body.symbol || body.pair || body.ticker;
      if (!symbol) return res.status(400).json({ ok: false, error: 'missing symbol' });
      const candle = {
        open: Number(body.open ?? body.o),
        high: Number(body.high ?? body.h),
        low: Number(body.low ?? body.l),
        close: Number(body.close ?? body.c),
        volume: Number(body.volume ?? body.v ?? 0)
      };
      if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) {
        return res.status(400).json({ ok: false, error: 'invalid OHLC' });
      }
      engine.onClosedCandle(String(symbol).toUpperCase(), candle);
      res.json({ ok: true });
    });
  }
  app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now(), pairs: engine.states.size }));

  return app;
}

module.exports = { createDashboard };
