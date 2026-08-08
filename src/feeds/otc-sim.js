'use strict';

/**
 * src/feeds/otc-sim.js
 * Simulated OTC tick feed — fully deterministic-walk random walk per symbol,
 * runs 24/7 (weekends/holidays/closed exchanges don't matter).
 * Emits the same contract as Binance: onTick({symbol, price}).
 */

const cfg = require('./config');

class OTCSimFeed {
  /**
   * @param {object} opts
   * @param {(t:{symbol:string, price:number, ts:number}) => void} opts.onTick
   */
  constructor({ onTick } = {}) {
    if (typeof onTick !== 'function') throw new Error('OTCSimFeed requires onTick');
    this.onTick = onTick;
    this.enabled = cfg.OTC_ENABLED !== false;
    this.symbols = (cfg.OTC_SYMBOLS || []).map(s => s.toUpperCase());
    this.interval = Math.max(100, cfg.OTC_TICK_MS || 1000);
    // base reference prices for the OTC universe
    this.base = {
      EURUSD_OTC: 1.0847, GBPUSD_OTC: 1.2721, USDJPY_OTC: 154.9,  AUDUSD_OTC: 0.6620,
      XAUUSD_OTC: 2381.2, BTCUSD_OTC: 64230,  ETHUSD_OTC: 3418,    SOLUSD_OTC: 172.4,
      // any custom OTC symbol defaults here:
      _default: 100.0,
    };
    this._prices = new Map();
    this._timer = null;
    this.stats = { ticks: 0, symbols: this.symbols.length };
  }

  _init(seed) {
    // deterministic per-symbol seed → stable initial price
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const base = this.base[seed] ?? this.base._default;
    const jitter = ((h % 1000) / 1000 - 0.5) * base * 0.02;   // ±1%
    return base + jitter;
  }

  start() {
    if (!this.enabled) { console.warn('[otc-sim] disabled via OTC_ENABLED=false'); return this; }
    for (const s of this.symbols) this._prices.set(s, this._init(s));
    const step = () => {
      for (const [sym, p] of this._prices) {
        const vol  = sym.includes('JPY') ? 0.0009 : 0.00035;          // noise scale
        const drift = (Math.random() - 0.5) * vol;
        const px = Math.max(p * (1 + drift), 1e-9);
        this._prices.set(sym, px);
        this.stats.ticks++;
        try { this.onTick({ symbol: sym, price: px, ts: Date.now() }); }
        catch (e) { console.error('[otc-sim] onTick error:', e && e.message); }
      }
    };
    step();
    this._timer = setInterval(step, this.interval);
    if (this._timer.unref) this._timer.unref();
    console.log(`[otc-sim] started · ${this.symbols.length} symbols · every ${this.interval}ms`);
    return this;
  }

  stop() { if (this._timer) clearInterval(this._timer); }
  isEnabled() { return this.enabled; }
}

module.exports = { OTCSimFeed };
