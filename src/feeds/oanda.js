'use strict';
const WebSocket = require('ws');
const cfg = require('./config');

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
  constructor({ engine }) {
    this.engine = engine;
    this.ws = null;
    this.cur = new Map();       // instrument → {symbol, bucket, open, high, low, close, volume}
    this.backoff = 1000;
    this.reconnectTimer = null;
    this.watchdog = null;
    this.stopped = false;
  }

  get _apiHost() { return cfg.OANDA_ENV === 'live' ? 'api-fxtrade.oanda.com' : 'api-fxpractice.oanda.com'; }
  get _streamHost() { return cfg.OANDA_ENV === 'live' ? 'stream-fxtrade.oanda.com' : 'stream-fxpractice.oanda.com'; }

  async start() {
    if (!cfg.OANDA_API_KEY || !cfg.OANDA_ACCOUNT_ID || !cfg.OANDA_INSTRUMENTS.length) {
      console.warn('[oanda] API key/account/instruments নেই — ফরেক্স ফিড বন্ধ');
      return;
    }
    await this._seedHistory();
    this._openStream();
    this.watchdog = setInterval(() => this._flushStale(), 5000);   // গ্যাপ/স্টল হ্যান্ডেল
    if (this.watchdog.unref) this.watchdog.unref();
  }

  async _seedHistory() {
    await mapLimit(cfg.OANDA_INSTRUMENTS, 4, async inst => {
      const url = 'https://' + this._apiHost + '/v3/instruments/' + inst + '/candles?granularity=M1&count=' + cfg.BUFFER_CANDLES;
      try {
        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + cfg.OANDA_API_KEY } });
        if (!res.ok) { console.warn('[oanda] history ' + inst + ' HTTP ' + res.status); return; }
        const d = await res.json();
        const candles = (d.candles || [])
          .filter(c => c.complete && c.mid)
          .map(c => ({ open: +c.mid.o, high: +c.mid.h, low: +c.mid.l, close: +c.mid.c, volume: +c.volume }));
        this.engine.seedHistory(inst, candles);
        console.log('[oanda] seeded', inst, candles.length, 'M1 candles');
      } catch (e) {
        console.warn('[oanda] history fail', inst, e.message);
      }
    });
  }

  _openStream() {
    if (this.stopped) return;
    const url = 'wss://' + this._streamHost + '/v3/accounts/' + cfg.OANDA_ACCOUNT_ID +
                '/pricing/stream?instruments=' + cfg.OANDA_INSTRUMENTS.join(',');
    const ws = new WebSocket(url, { headers: { Authorization: 'Bearer ' + cfg.OANDA_API_KEY } });
    this.ws = ws;
    ws.on('open', () => { this.backoff = 1000; console.log('[oanda] 🟢 pricing stream কানেক্টেড'); });
    ws.on('message', raw => {
      try {
        const p = JSON.parse(String(raw));
        if (p.type === 'PRICE' && p.bids && p.asks && p.bids[0] && p.asks[0]) this._onPrice(p);
      } catch (e) { /* হিটবিট/ম্যালফর্মড স্কিপ */ }
    });
    ws.on('close', () => { if (this.ws === ws) { this.ws = null; this._scheduleReconnect(); } });
    ws.on('error', e => { console.error('[oanda] ws error:', e.message); try { ws.terminate(); } catch (e2) { } });
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this._openStream(); }, this.backoff);
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
    this.backoff = Math.min(60000, this.backoff * 2);
  }

  _onPrice(p) {
    const mid = (parseFloat(p.bids[0].price) + parseFloat(p.asks[0].price)) / 2;
    if (!Number.isFinite(mid)) return;
    const bucket = Math.floor(new Date(p.time).getTime() / 60000) * 60000;   // ১-মিনিট বাকেট
    const cur = this.cur.get(p.instrument);
    if (!cur || cur.bucket !== bucket) {
      if (cur) this._close(cur);                                             // আগের মিনিট CLOSED
      this.cur.set(p.instrument, { symbol: p.instrument, bucket, open: mid, high: mid, low: mid, close: mid, volume: 1 });
    } else {
      cur.high = Math.max(cur.high, mid);
      cur.low = Math.min(cur.low, mid);
      cur.close = mid;
      cur.volume++;
    }
  }

  _close(cur) {
    this.engine.onClosedCandle(cur.symbol, { open: cur.open, high: cur.high, low: cur.low, close: cur.close, volume: cur.volume });
  }

  _flushStale() {   // ৯০ সেকেন্ডেও নতুন টিক না এলে মিনিট ক্লোজ করুন (মার্কেট বন্ধ/গ্যাপ)
    const now = Date.now();
    for (const [inst, cur] of this.cur) {
      if (now - cur.bucket >= 90000) {
        this.cur.delete(inst);
        this._close(cur);
      }
    }
  }

  stop() {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) { try { this.ws.terminate(); } catch (e) { } this.ws = null; }
  }
}

module.exports = { OandaFeed };
