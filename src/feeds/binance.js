'use strict';
const cfg = require('../config');

class BinanceFeed {
  constructor({ onTick, onClosedCandle, onLivePrice, statusCb }) {
    // onTick({symbol,price,ts})       → every kline update (incl. in-progress close)
    // onClosedCandle(symbol, bar1m)   → only when a 1m candle closes
    // onLivePrice(symbol, price)      → in-progress price for dashboard
    this.onTick = onTick || (()=>{});
    this.onClosedCandle = onClosedCandle || (()=>{});
    this.onLivePrice = onLivePrice || (()=>{});
    this.statusCb = statusCb || (()=>{});
    this.connected = false;
    this._ws = null;
    this._reconnectDelay = 1000;
    this._closed = true;
  }

  start() {
    // builds stream param from cfg.BINANCE_SYMBOLS, opens wss, routes to _onMessage
    // (existing reconnection + heartbeats preserved)
  }

  _onMessage(raw) {
    // NOTE: keep your existing JSON parsing / ping logic here, then:
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.e === 'kline' && msg.k && msg.k.s) {
      const symbol = cfg.BINANCE_SYMBOLS.includes(msg.k.s) ? msg.k.s : msg.k.s;
      const price = Number(msg.k.c);
      const isClosed = !!msg.k.x;
      this.onTick({ symbol, price, ts: msg.E || Date.now() });
      this.onLivePrice(symbol, price);
      if (isClosed) {
        // Build a 1m bar from the kline payload → hand to aggregator/engine.
        this.onClosedCandle(symbol, {
          symbol,
          o: Number(msg.k.o), h: Number(msg.k.h),
          l: Number(msg.k.l), c: Number(msg.k.c),
          v: Number(msg.k.v), n: Number(msg.k.n),
          openAt: msg.k.t,
        });
      }
    }
  }

  isConnected() { return this.connected; }
  // ... rest (open/close reconnect, stop) unchanged
}
module.exports = { BinanceFeed };
