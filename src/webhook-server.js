'use strict';
const express = require('express');
const cfg = require('./config');

function createWebhookServer({ engine }) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

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

  app.get('/health', (req, res) =>
    res.json({ ok: true, ts: Date.now(), pairs: engine.states ? engine.states.size : 0 }));

  return app;
}

module.exports = { createWebhookServer };
