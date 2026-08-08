'use strict';
/* src/feed.js — unified tick stream: Binance (crypto/Real), TwelveData (FX Real), OTC sim.
   Emits ONE contract: onTick({symbol, price, ts, market:'real'|'otc', broker}). */
const cfg = require('./config');

/* ── Binance crypto feed (REAL) ── */
class BinanceFeed {
  constructor({ onTick, onLivePrice, onClosedCandle, statusCb } = {}) {
    this.onTick = onTick || (()=>{}); this.onLivePrice = onLivePrice || (()=>{});
    this.onClosedCandle = onClosedCandle || (()=>{}); this.statusCb = statusCb || (()=>{});
    this.connected = false; this._ws = null; this._timer = null; this._closed = true;
    this._reconnect = 1000; this._stops = 0;
  }
  start() {
    if (!cfg.BINANCE_ENABLED) { console.warn('[feed/binance] disabled'); return this; }
    this._connect(); return this;
  }
  _connect() {
    const syms = cfg.BINANCE_SYMBOLS.map(s => s.toLowerCase() + '@kline_1m');
    this._ws = new (require('ws'))(cfg.BINANCE_WS_URL, { perMessageDeflate: false });
    this._ws.on('open', () => { this.connected = true; this._stops = 0; this._reconnect = 1000; this.statusCb(true); this._heartbeat(); });
    this._ws.on('message', (raw) => this._onMessage(raw));
    this._ws.on('error', (e) => { this.connected = false; this.statusCb(false); console.error('[feed/binance] ws err', e.message); });
    this._ws.on('close', () => { this.connected = false; this.statusCb(false); this._retry(); });
    this._ws.on('open', () => this._ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: syms, id: 1 })));
  }
  _heartbeat() { clearInterval(this._timer); this._timer = setInterval(() => this._ws && this._ws.readyState === 1 && this._ws.ping(), 30000); if (this._timer.unref) this._timer.unref(); }
  _retry() { clearInterval(this._timer); if (this._closed) return; setTimeout(() => { this._stops++; this._reconnect = Math.min(30000, this._reconnect * 2); this._connect(); }, this._reconnect); }
  _onMessage(raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || m.e !== 'kline' || !m.k) return;
    const symbol = m.k.s; const price = Number(m.k.c); const closed = !!m.k.x;
    this.onTick({ symbol, price, ts: m.E || Date.now(), market: 'real', broker: 'Binance' });
    this.onLivePrice(symbol, price);
    if (closed) this.onClosedCandle(symbol, { symbol, o:+m.k.o, h:+m.k.h, l:+m.k.l, c:+m.k.c, v:+m.k.v, n:+m.k.n, openAt: m.k.t });
  }
  isConnected() { return this.connected; }
  stop() { this._closed = true; clearInterval(this._timer); if (this._ws) this._ws.close(); }
}

/* ── TwelveData REST polling feed (REAL FX spot) ── */
class TwelveDataFeed {
  constructor({ onTick, onLivePrice, intervalMs = 4000 } = {}) {
    this.onTick = onTick || (()=>{}); this.onLivePrice = onLivePrice || (()=>{});
    this.connected = false; this._timer = null; this._closed = false; this.intervalMs = intervalMs;
  }
  start() {
    if (!cfg.TWELVEDATA_ENABLED) { console.warn('[feed/twelvedata] disabled'); return this; }
    if (!cfg.TWELVEDATA_KEY) { console.warn('[feed/twelvedata] no API key — FX feed idle'); return this; }
    const step = async () => {
      if (this._closed) return;
      try {
        const sym = cfg.TWELVEDATA_SYMBOLS[0]; // poll primary quote for live price
        const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(cfg.TWELVEDATA_KEY)}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error('http ' + r.status);
        const j = await r.json();
        const px = Number(j.price);
        if (Number.isFinite(px)) {
          this.connected = true;
          const s = sym.replace('/', '').toUpperCase();
          this.onTick({ symbol: s, price: px, ts: Date.now(), market: 'real', broker: 'TwelveData' });
          this.onLivePrice(s, px);
        }
      } catch (e) { this.connected = false; console.error('[feed/twelvedata]', e.message); }
    };
    step(); this._timer = setInterval(step, this.intervalMs); if (this._timer.unref) this._timer.unref();
    return this;
  }
  isConnected() { return this.connected; }
  stop() { this._closed = true; clearInterval(this._timer); }
}

/* ── OTC simulated feed (24/7, weekend-safe) ── */
class OTCSimFeed {
  constructor({ onTick, intervalMs } = {}) {
    this.onTick = onTick || (()=>{}); this.interval = intervalMs || cfg.OTC_TICK_MS || 1000;
    this.enabled = cfg.OTC_ENABLED !== false; this._timer = null; this._prices = new Map(); this._closed = false;
    this.base = { EURUSD_OTC:1.0847, GBPUSD_OTC:1.2721, USDJPY_OTC:154.9, AUDUSD_OTC:0.6620,
      XAUUSD_OTC:2381.2, BTCUSD_OTC:64230, ETHUSD_OTC:3418, SOLUSD_OTC:172.4, _d:100 };
  }
  start() {
    if (!this.enabled) { console.warn('[feed/otc] disabled'); return this; }
    for (const s of cfg.OTC_SYMBOLS) { const b = this.base[s] ?? this.base._d; this._prices.set(s, b * (1 + (Math.random() - .5) * .01)); }
    const step = () => { if (this._closed) return; for (const [sym, p] of this._prices) { const px = Math.max(p * (1 + (Math.random() - .5) * (sym.includes('JPY') ? .0009 : .00035)), 1e-9); this._prices.set(sym, px); this.onTick({ symbol: sym, price: px, ts: Date.now(), market: 'otc', broker: 'OTC' }); } };
    step(); this._timer = setInterval(step, this.interval); if (this._timer.unref) this._timer.unref();
    return this;
  }
  isConnected() { return this.enabled; }
  stop() { this._closed = true; clearInterval(this._timer); }
}

module.exports = { BinanceFeed, TwelveDataFeed, OTCSimFeed };
