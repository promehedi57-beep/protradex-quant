'use strict';

/**
 * src/indicators.js
 * Incremental per (symbol × timeframe) indicator states:
 * RSI, Z-Score (rolling mean/std), EMA(fast/slow), S/R levels.
 * Each state machine ingests candle closes and keeps running sums —
 * O(1) per close, no resorting. (ADX is maintained in the engine layer
 * where it needs full +/-DM streams.)
 */

const cfg = require('./config');
const { clamp, clamp01 } = require('./math');
const RSI_P   = cfg.RULES.RSIPERIOD ?? 14;
const Z_P     = cfg.RULES.ZPERIOD   ?? 50;
const EMA_F   = cfg.RULES.EMA_FAST  ?? 9;
const EMA_S   = cfg.RULES.EMA_SLOW  ?? 21;

class RSI {
  constructor(period = RSI_P) {
    this.period = period;
    this.gain = 0; this.loss = 0; this.ready = false;
    this.prev = null;
  }
  push(price) {
    if (this.prev != null) {
      const ch = price - this.prev;
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      if (!this.ready) {           // simple average on first `period` changes
        this.gain = ((this._n ?? 0) === 0 ? g : this.gain + g);
        this.loss = ((this._n ?? 0) === 0 ? l : this.loss + l);
        this._n = (this._n ?? 0) + 1;
        if (this._n === this.period) { this.gain /= this.period; this.loss /= this.period; this.ready = true; }
      } else {                     // Wilder smoothing thereafter
        this.gain = (this.gain * (this.period - 1) + g) / this.period;
        this.loss = (this.loss * (this.period - 1) + l) / this.period;
      }
    }
    this.prev = price;
    return this.value();
  }
  value() {
    if (!this.ready || (this.loss === 0 && this.gain === 0)) return 50;
    if (this.loss === 0) return 100;
    const rs = this.gain / this.loss;
    return clamp(100 - 100 / (1 + rs), 0, 100);
  }
}

class ZScore {
  constructor(period = Z_P) {
    this.period = period;
    this.window = [];
    this.ready = false;
  }
  push(price) {
    this.window.push(price);
    if (this.window.length > this.period) this.window.shift();
    if (this.window.length === this.period) this.ready = true;
    return this.value();
  }
  value() {
    if (!this.ready) return 0;
    const n = this.window.length;
    const mean = this.window.reduce((a, b) => a + b, 0) / n;
    let varr = 0;
    for (const x of this.window) varr += (x - mean) ** 2;
    const sd = Math.sqrt(varr / n) || 1e-9;
    return (this.window[n - 1] - mean) / sd;
  }
}

class EMA {
  constructor(period) { this.period = period; this.val = null; }
  push(price) {
    const k = 2 / (this.period + 1);
    this.val = this.val == null ? price : price * k + this.val * (1 - k);
    return this.val;
  }
  value() { return this.val; }
}

/* ── Support / Resistance (fractal swings + horizontal clustering) ── */
class SRLevels {
  /**
   * @param {number} lookback  window (candles) used per swing
   * @param {number} breakoutPct  % above/below level to confirm a breakout
   */
  constructor(lookback = cfg.SR_LOOKBACK || 48, breakoutPct = cfg.SR_BREAKOUT_PCT || 0.15) {
    this.lookback = lookback;
    this.breakoutPct = breakoutPct;
    this.closes = [];
    this.resistance = null;   // {price, strength}
    this.support    = null;
  }
  pushClose(price) {
    this.closes.push(price);
    if (this.closes.length > this.lookback) this.closes.shift();
    this._recompute();
    return this;
  }
  _swing(pivot) {
    // a swing pivot is a fractal: peak lower than neighbours AND volume of touches
    const arr = this.closes, n = arr.length, i = arr.indexOf(pivot);
    if (i < 2 || i >= n - 2) return null;
    const a = arr[i-2], b = arr[i-1], c = arr[i], d = arr[i+1], e = arr[i+2];
    const swingHigh = c > a && c > b && c > d && c > e;
    const swingLow  = c < a && c < b && c < d && c < e;
    if (swingHigh) return { type: 'resistance', price: c, strength: 1 };
    if (swingLow)  return { type: 'support',    price: c, strength: 1 };
    return null;
  }
  _recompute() {
    const arr = this.closes; if (arr.length < 5) return;
    const pivots = [];
    for (let i = 2; i < arr.length - 2; i++) {
      const s = this._swing(arr[i]);
      if (s) pivots.push(s);
    }
    if (!pivots.length) return;
    // cluster nearby pivot prices into a level of accumulated strength
    const clusters = [];
    for (const p of pivots) {
      const c = clusters.find(c => Math.abs(c.price - p.price) / p.price < 0.004);
      if (c) { c.price = (c.price * c.strength + p.price) / (c.strength + 1); c.strength++; }
      else clusters.push({ price: p.price, strength: 1, type: p.type });
    }
    const ress = clusters.filter(c => c.type === 'resistance');
    const sups = clusters.filter(c => c.type === 'support');
    this.resistance = ress.length ? ress.reduce((a, b) => (b.strength > a.strength ? b : a)) : null;
    this.support    = sups.length ? sups.reduce((a, b) => (b.strength > a.strength ? b : a)) : null;
    // a support above price flips meaning → keep it only if it's the nearest below-open high
  }
  /** nearest level relative to `price`, with breakout/bounce classification */
  hit(price, dir) {
    if (cfg.SR_ENABLED === false) return { type: 'none', kind: 'inside', distPct: 1 };
    const rel = level => level ? Math.abs(price - level.price) / price : Infinity;
    const dR = rel(this.resistance), dS = rel(this.support);
    if (dR === Infinity && dS === Infinity) return { type: 'none', kind: 'inside', distPct: 1 };
    const useR = dR <= dS;
    const level = useR ? this.resistance : this.support;
    const distPct = useR ? dR : dS;
    if (distPct > 0.01) return { type: 'none', kind: 'inside', distPct };   // not touching either
    if (useR) {
      // price is at/above resistance → breakout (up) or rejection (down)
      const broke = price >= level.price * (1 + this.breakoutPct / 100);
      return { type: 'resistance', kind: broke ? 'breakout' : 'bounce', distPct: clamp01(distPct * 100) };
    }
    const broke = price <= level.price * (1 - this.breakoutPct / 100);
    return { type: 'support', kind: broke ? 'breakout' : 'bounce', distPct: clamp01(distPct * 100) };
  }
}

/* ── Per-symbol×TF set ── */
class SymbolSR { constructor() { this.set = new Map(); } }

/** Full per-symbol state container. */
class IndicatorHub {
  constructor() {
    this.map = new Map();        // `${symbol}|${tfMinutes}` -> state
    this.sr   = new Map();       // symbol -> SRLevels (S/R computed on ACTIVE TF closes)
    this.readyFlags = new Map();
  }
  key(symbol, tf) { return `${symbol}|${tf}`; }
  get(symbol, tf) {
    let s = this.map.get(this.key(symbol, tf));
    if (!s) {
      s = {
        rsi:  new RSI(), z: new ZScore(),
        emaF: new EMA(EMA_F), emaS: new EMA(EMA_S),
        lastPrice: null,
        ready: false,
      };
      this.map.set(this.key(symbol, tf), s);
    }
    return s;
  }
  pushClose(symbol, tf, price) {
    const s = this.get(symbol, tf);
    s.rsi.push(price); s.z.push(price);
    s.emaF.push(price); s.emaS.push(price);
    s.lastPrice = price;
    s.ready = s.rsi.ready && s.z.ready;
    this.readyFlags.set(this.key(symbol, tf), s.ready);
    return s;
  }
  touch(symbol, tf) { return this.get(symbol, tf); }
  srFor(symbol) {
    if (!this.sr.has(symbol)) this.sr.set(symbol, new SRLevels());
    return this.sr.get(symbol);
  }
  snapshot(symbol, tf) {
    const s = this.get(symbol, tf);
    return {
      rsi:     Math.round(s.rsi.value() * 10) / 10,
      zscore:  Math.round(s.z.value() * 100) / 100,
      emaFast: s.emaF.value(),
      emaSlow: s.emaS.value(),
      sloped:  (s.emaF.value() ?? 0) > (s.emaS.value() ?? 0),
      ready: !!this.readyFlags.get(this.key(symbol, tf)),
    };
  }
  cleanup(keepSymbols) {
    // drop state for symbols removed from universe (memory guard)
    const set = new Set(keepSymbols || []);
    for (const k of this.map.keys()) { const sym = k.split('|')[0]; if (!set.has(sym)) this.map.delete(k); }
    for (const k of this.sr.keys())  if (!set.has(k)) this.sr.delete(k);
  }
}

module.exports = { IndicatorHub, RSI, ZScore, EMA, SRLevels };
