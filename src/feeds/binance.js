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

class BinanceFeed {
  constructor({ engine }) {
    this.engine = engine;
    this.pairs = [];
    this.ws = null;
    this.backoff = 1000;
    this.reconnectTimer = null;
    this.refreshTimer = null;
    this.stopped = false;
  }

  async start() {
    await this._refreshPairs();                    // ১) সব active পেয়ার আবিষ্কার
    this._openSocket();                            // ২) কম্বাইন্ড kline_1m স্ট্রিম
    if (cfg.PAIR_REFRESH_HOURS > 0) {              // ৩) নতুন লিস্টিং অটো-অ্যাড
      this.refreshTimer = setInterval(
        () => this._refreshPairs().catch(e => console.error('[binance] refresh fail:', e.message)),
        cfg.PAIR_REFRESH_HOURS * 3600 * 1000
      );
      if (this.refreshTimer.unref) this.refreshTimer.unref();
    }
  }

  async _fetchActivePairs() {
    const res = await fetch(cfg.BINANCE_REST_URL + '/api/v3/ticker/24hr');
    if (!res.ok) throw new Error('Binance REST ' + res.status);
    const data = await res.json();
    const quote = cfg.QUOTE_ASSET;
    return data
      .filter(t => t.symbol.endsWith(quote) && Number(t.quoteVolume || 0) >= cfg.MIN_24H_QUOTE_VOLUME)
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, cfg.MAX_PAIRS)
      .map(t => t.symbol);
  }

  async _seedHistory(symbol) {
    const url = cfg.BINANCE_REST_URL + '/api/v3/klines?symbol=' + symbol +
                '&interval=' + cfg.TIMEFRAME + '&limit=' + cfg.BUFFER_CANDLES;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const k = await res.json();
      this.engine.seedHistory(symbol, k.map(r => ({ open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] })));
    } catch (e) {
      console.warn('[binance] history fail', symbol, e.message);  // ওয়ার্ম-আপ ছাড়াই চলবে
    }
  }

  async _refreshPairs() {
    try {
      const list = await this._fetchActivePairs();
      const prev = new Set(this.pairs);
      const added = list.filter(s => !prev.has(s));
      const removed = this.pairs.filter(s => !list.includes(s));
      if (added.length) {
        console.log('[binance] নতুন পেয়ার:', added.length, '· মোট:', list.length);
        await mapLimit(added, 8, s => this._seedHistory(s));
      }
      if (removed.length) console.log('[binance] পেয়ার রিমুভ:', removed.length);
      this.pairs = list;
    } catch (e) {
      console.error('[binance] pair refresh fail:', e.message);
    }
  }

  _openSocket() {
    if (this.stopped) return;
    if (this.ws) { try { this.ws.terminate(); } catch (e) { } this.ws = null; }
    if (!this.pairs.length) { this._scheduleReconnect(); return; }
    const streams = this.pairs.map(s => s.toLowerCase() + '@kline_' + cfg.TIMEFRAME).join('/');
    const ws = new WebSocket(cfg.BINANCE_WS_URL + '/stream?streams=' + streams);
    this.ws = ws;
    ws.on('open', () => { this.backoff = 1000; console.log('[binance] 🟢 WS কানেক্টেড —', this.pairs.length, 'পেয়ার লাইভ'); });
    ws.on('message', raw => this._onMessage(raw));
    ws.on('close', () => { if (this.ws === ws) { this.ws = null; this._scheduleReconnect(); } });
    ws.on('error', e => { console.error('[binance] ws error:', e.message); try { ws.terminate(); } catch (e2) { } });
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this._openSocket(); }, this.backoff);
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
    this.backoff = Math.min(60000, this.backoff * 2);
  }

  _onMessage(raw) {
    try {
      const msg = JSON.parse(String(raw));
      const k = msg && msg.data && msg.data.k;
      if (!k || !k.x) return;                        // ★ শুধু CLOSED ক্যান্ডেল (k.x===true)
      const symbol = msg.stream ? msg.stream.split('@')[0].toUpperCase() : ((k.s || '').toUpperCase());
      if (!symbol) return;
      this.engine.onClosedCandle(symbol, { open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
    } catch (e) {
      console.error('[binance] message parse fail:', e.message);
    }
  }

  stop() {
    this.stopped = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) { try { this.ws.terminate(); } catch (e) { } this.ws = null; }
  }
}

module.exports = { BinanceFeed };
