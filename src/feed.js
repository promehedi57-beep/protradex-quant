'use strict';
/* src/feed.js — combined stream binance fix */
const cfg = require('./config');

/* ── Binance crypto feed (REAL) ── */
class BinanceFeed {
  constructor({ onTick, onLivePrice, onClosedCandle, statusCb } = {}) {
    this.onTick = onTick || (()=>{}); 
    this.onLivePrice = onLivePrice || (()=>{});
    this.onClosedCandle = onClosedCandle || (()=>{}); 
    this.statusCb = statusCb || (()=>{});
    this.connected = false; 
    this._ws = null; 
    this._timer = null; 
    this._closed = false;
    this._reconnect = 1000;
  }

  start() {
    if (!cfg.BINANCE_ENABLED) return this;
    this._connect(); 
    return this;
  }

  _connect() {
    if (this._closed) return;

    // 💡 ৪-০-৪ এরর ফিক্স: বাইন্যান্স কম্বাইন্ড স্ট্রিম ইউআরএল সরাসরি পাস করা হয়েছে
    const syms = (cfg.BINANCE_SYMBOLS || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'])
      .map(s => s.toLowerCase() + '@kline_1m')
      .join('/');

    const streamUrl = `wss://stream.binance.com:9443/stream?streams=${syms}`;

    this._ws = new (require('ws'))(streamUrl, { perMessageDeflate: false });

    this._ws.on('open', () => { 
      this.connected = true; 
      this._reconnect = 1000; 
      this.statusCb(true); 
      this._heartbeat(); 
      console.log('[feed/binance] connected to combined stream');
    });

    this._ws.on('message', (raw) => this._onMessage(raw));

    this._ws.on('error', (e) => { 
      this.connected = false; 
      this.statusCb(false); 
      console.error('[feed/binance] ws err:', e.message); 
    });

    this._ws.on('close', () => { 
      this.connected = false; 
      this.statusCb(false); 
      this._retry(); 
    });
  }

  _heartbeat() { 
    clearInterval(this._timer); 
    this._timer = setInterval(() => this._ws && this._ws.readyState === 1 && this._ws.ping(), 30000); 
    if (this._timer.unref) this._timer.unref(); 
  }

  _retry() { 
    clearInterval(this._timer); 
    if (this._closed) return; 
    setTimeout(() => { 
      this._reconnect = Math.min(30000, this._reconnect * 2); 
      this._connect(); 
    }, this._reconnect); 
  }

  _onMessage(raw) {
    let msg; 
    try { msg = JSON.parse(raw); } catch { return; }
    
    // Combined stream payload format checks data field
    const m = msg.data || msg;
    if (!m || m.e !== 'kline' || !m.k) return;

    const symbol = m.k.s; 
    const price = Number(m.k.c); 
    const closed = !!m.k.x;

    this.onTick({ symbol, price, ts: m.E || Date.now(), market: 'real', broker: 'Binance' });
    this.onLivePrice(symbol, price);

    if (closed) {
      this.onClosedCandle(symbol, { symbol, o:+m.k.o, h:+m.k.h, l:+m.k.l, c:+m.k.c, v:+m.k.v, n:+m.k.n, openAt: m.k.t });
    }
  }

  isConnected() { return this.connected; }

  stop() { 
    this._closed = true; 
    clearInterval(this._timer); 
    if (this._ws) this._ws.close(); 
  }
}

/* ── TwelveData REST polling feed (REAL FX spot) ── */
class TwelveDataFeed {
  constructor({ onTick, onLivePrice, intervalMs = 4000 } = {}) {
    this.onTick = onTick || (()=>{}); 
    this.onLivePrice = onLivePrice || (()=>{});
    this.connected = false; 
    this._timer = null; 
    this._closed = false; 
    this.intervalMs = intervalMs;
  }

  start() {
    if (!cfg.TWELVEDATA_ENABLED) return this;
    if (!cfg.TWELVEDATA_KEY) { 
      console.warn('[feed/twelvedata] no API key — FX feed idle'); 
      return this; 
    }

    const step = async () => {
      if (this._closed) return;
      try {
        const syms = cfg.TWELVEDATA_SYMBOLS || ['EUR/USD'];
        const sym = syms[0];
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
      } catch (e) { 
        this.connected = false; 
        console.error('[feed/twelvedata]', e.message); 
      }
    };

    step(); 
    this._timer = setInterval(step, this.intervalMs); 
    if (this._timer.unref) this._timer.unref();
    return this;
  }

  isConnected() { return this.connected; }
  stop() { this._closed = true; clearInterval(this._timer); }
}

/* ── OTC simulated feed (24/7) ── */
class OTCSimFeed {
  constructor({ onTick, intervalMs } = {}) {
    this.onTick = onTick || (()=>{}); 
    this.interval = intervalMs || cfg.OTC_TICK_MS || 1000;
    this.enabled = cfg.OTC_ENABLED !== false; 
    this._timer = null; 
    this._prices = new Map(); 
    this._closed = false;
    this.base = { 
      EURUSD_OTC: 1.0847, GBPUSD_OTC: 1.2721, USDJPY_OTC: 154.9, AUDUSD_OTC: 0.6620,
      XAUUSD_OTC: 2381.2, BTCUSD_OTC: 64230, ETHUSD_OTC: 3418, SOLUSD_OTC: 172.4, _d: 100 
    };
  }

  start() {
    if (!this.enabled) return this;
    const symbols = cfg.OTC_SYMBOLS || ['EURUSD_OTC', 'GBPUSD_OTC', 'XAUUSD_OTC'];
    for (const s of symbols) { 
      const b = this.base[s] ?? this.base._d; 
      this._prices.set(s, b * (1 + (Math.random() - 0.5) * 0.01)); 
    }

    const step = () => { 
      if (this._closed) return; 
      for (const [sym, p] of this._prices) { 
        const px = Math.max(p * (1 + (Math.random() - 0.5) * (sym.includes('JPY') ? 0.0009 : 0.00035)), 1e-9); 
        this._prices.set(sym, px); 
        this.onTick({ symbol: sym, price: px, ts: Date.now(), market: 'otc', broker: 'OTC' }); 
      } 
    };

    step(); 
    this._timer = setInterval(step, this.interval); 
    if (this._timer.unref) this._timer.unref();
    return this;
  }

  isConnected() { return this.enabled; }
  stop() { this._closed = true; clearInterval(this._timer); }
}

module.exports = { BinanceFeed, TwelveDataFeed, OTCSimFeed };
