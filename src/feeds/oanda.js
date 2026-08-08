'use strict';
const WebSocket = require('ws');
const cfg = require('../config');

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

class OandaFeed {
  constructor({ engine, onTick, onClosedCandle, onLivePrice, statusCb }) {
    this.engine = engine;
    
    // Standard feed event callbacks (matches Binance & OTC contract)
    this.onTick = onTick || (() => {});
    this.onClosedCandle = onClosedCandle || (() => {});
    this.onLivePrice = onLivePrice || (() => {});
    this.statusCb = statusCb || (() => {});

    this.ws = null;
    this.cur = new Map();       // instrument -> {symbol, bucket, open, high, low, close, volume}
    this.backoff = 1000;
    this.reconnectTimer = null;
    this.watchdog = null;
    this.stopped = false;
    this.connected = false;
  }

  get _apiHost() { 
    return cfg.OANDA_ENV === 'live' ? 'api-fxtrade.oanda.com' : 'api-fxpractice.oanda.com'; 
  }
  
  get _streamHost() { 
    return cfg.OANDA_ENV === 'live' ? 'stream-fxtrade.oanda.com' : 'stream-fxpractice.oanda.com'; 
  }

  async start() {
    if (!cfg.OANDA_ENABLED) {
      console.warn('[oanda] Configured disabled (cfg.OANDA_ENABLED is false)');
      this._setStatus(false, 'Disabled');
      return;
    }

    const apiKey = cfg.OANDA_API_KEY || cfg.OANDA_TOKEN;
    const instruments = cfg.OANDA_SYMBOLS || cfg.OANDA_INSTRUMENTS || [];

    if (!apiKey || !cfg.OANDA_ACCOUNT_ID || !instruments.length) {
      console.warn('[oanda] API key/account/instruments নেই — ফরেক্স ফিড বন্ধ');
      this._setStatus(false, 'Missing Config');
      return;
    }

    await this._seedHistory();
    this._openStream();
    
    this.watchdog = setInterval(() => this._flushStale(), 5000);   // গ্যাপ/স্টল হ্যান্ডেল
    if (this.watchdog.unref) this.watchdog.unref();
  }

  async _seedHistory() {
    const instruments = cfg.OANDA_SYMBOLS || cfg.OANDA_INSTRUMENTS || [];
    const apiKey = cfg.OANDA_API_KEY || cfg.OANDA_TOKEN;

    await mapLimit(instruments, 4, async inst => {
      const symbol = String(inst).toUpperCase();
      const url = `https://${this._apiHost}/v3/instruments/${inst}/candles?granularity=M1&count=${cfg.BUFFER_CANDLES || 300}`;
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!res.ok) { 
          console.warn(`[oanda] history ${symbol} HTTP ${res.status}`); 
          return; 
        }
        const d = await res.json();
        const candles = (d.candles || [])
          .filter(c => c.complete && c.mid)
          .map(c => ({ open: +c.mid.o, high: +c.mid.h, low: +c.mid.l, close: +c.mid.c, volume: +c.volume }));

        if (this.engine && typeof this.engine.seedHistory === 'function') {
          this.engine.seedHistory(symbol, candles);
        }
        console.log(`[oanda] seeded ${symbol} ${candles.length} M1 candles`);
      } catch (e) {
        console.warn(`[oanda] history fail ${symbol}:`, e.message);
      }
    });
  }

  _openStream() {
    if (this.stopped) return;

    const apiKey = cfg.OANDA_API_KEY || cfg.OANDA_TOKEN;
    const instruments = cfg.OANDA_SYMBOLS || cfg.OANDA_INSTRUMENTS || [];
    
    const url = `wss://${this._streamHost}/v3/accounts/${cfg.OANDA_ACCOUNT_ID}/pricing/stream?instruments=${instruments.join(',')}`;
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    this.ws = ws;

    ws.on('open', () => { 
      this.backoff = 1000; 
      this.connected = true;
      this._setStatus(true, 'Connected');
      console.log('[oanda] 🟢 pricing stream কানেক্টেড'); 
    });

    ws.on('message', raw => {
      try {
        const p = JSON.parse(String(raw));
        if (p.type === 'PRICE' && p.bids && p.asks && p.bids[0] && p.asks[0]) {
          this._onPrice(p);
        }
      } catch (e) { 
        /* পলিং/হিটবিট/ম্যালফর্মড মেসেজ স্কিপ */ 
      }
    });

    ws.on('close', () => { 
      if (this.ws === ws) { 
        this.ws = null; 
        this.connected = false;
        this._setStatus(false, 'Disconnected');
        this._scheduleReconnect(); 
      } 
    });

    ws.on('error', e => { 
      console.error('[oanda] ws error:', e.message); 
      try { ws.terminate(); } catch (e2) {} 
    });
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { 
      this.reconnectTimer = null; 
      this._openStream(); 
    }, this.backoff);
    
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
    this.backoff = Math.min(60000, this.backoff * 2);
  }

  _onPrice(p) {
    const symbol = String(p.instrument).toUpperCase();
    const mid = (parseFloat(p.bids[0].price) + parseFloat(p.asks[0].price)) / 2;
    if (!Number.isFinite(mid)) return;

    const ts = p.time ? new Date(p.time).getTime() : Date.now();

    // 1. Emit Raw Tick for Aggregator
    this.onTick({ symbol, price: mid, ts });

    // 2. Direct Live Price trigger for UI
    this.onLivePrice(symbol, mid);

    // 3. Rollup 1m candles for internal candle-tracking
    const bucket = Math.floor(ts / 60000) * 60000;
    const cur = this.cur.get(symbol);

    if (!cur || cur.bucket !== bucket) {
      if (cur) this._close(cur);                                             
      this.cur.set(symbol, { symbol, bucket, open: mid, high: mid, low: mid, close: mid, volume: 1 });
    } else {
      cur.high = Math.max(cur.high, mid);
      cur.low = Math.min(cur.low, mid);
      cur.close = mid;
      cur.volume++;
    }
  }

  _close(cur) {
    const bar = { 
      symbol: cur.symbol,
      o: cur.open, 
      h: cur.high, 
      l: cur.low, 
      c: cur.close, 
      v: cur.volume,
      openAt: cur.bucket
    };

    if (this.engine && typeof this.engine.onClosedCandle === 'function') {
      this.engine.onClosedCandle(cur.symbol, bar);
    }
    
    this.onClosedCandle(cur.symbol, bar);
  }

  _flushStale() {   // ৯০ সেকেন্ডেও নতুন টিক না এলে মিনিট ক্লোজ (মার্কেট বন্ধ/গ্যাপ)
    const now = Date.now();
    for (const [inst, cur] of this.cur) {
      if (now - cur.bucket >= 90000) {
        this.cur.delete(inst);
        this._close(cur);
      }
    }
  }

  _setStatus(connected, text) {
    if (typeof this.statusCb === 'function') {
      this.statusCb({ connected, text, source: 'oanda' });
    }
  }

  isConnected() {
    return this.connected;
  }

  stop() {
    this.stopped = true;
    this.connected = false;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) { 
      try { this.ws.terminate(); } catch (e) {} 
      this.ws = null; 
    }
    this._setStatus(false, 'Stopped');
  }
}

module.exports = { OandaFeed };
