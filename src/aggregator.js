'use strict';

/**
 * src/tf.js
 * 1m closed bars → higher-timeframe candle folder (5m / 10m / 15m / 20m …).
 * Buckets are epoch-aligned (5m closes at :00/:05/:10…), fully incremental,
 * bounded memory (ring of last N closed candles per symbol×TF).
 */

const cfg = require('./config');
const { MS_1M } = require('./aggregator');

class TFEngine {
  /**
   * @param {object} opts
   * @param {(symbol:string, tfMinutes:number, candle:object) => void} opts.onCandle
   *        Called once per CLOSED higher-TF candle. candle = {openAt,closeAt,o,h,l,c,v}
   */
  constructor({ onCandle } = {}) {
    if (typeof onCandle !== 'function') {
      throw new Error('TFEngine: onCandle(symbol, tf, candle) callback is required');
    }
    this.onCandle = onCandle;

    // Sanitize TF list: integers ≥ 1, unique, ascending.
    this.tfs = [...new Set((cfg.TIMEFRAMES || [5, 10, 15, 20]).map(Number))]
      .filter(n => Number.isInteger(n) && n >= 1)
      .sort((a, b) => a - b);
    if (!this.tfs.length) this.tfs = [15];

    this.keep = Math.max(60, cfg.TF_KEEP_CANDLES || 260);
    this.symbols = new Map(); // symbol -> Map(tfMs -> { current, closed: [] })
    this.stats = { candles: 0, late: 0, symbols: 0 };
  }

  _bucket(ts, tfMs) {
    return Math.floor(ts / tfMs);
  }

  /**
   * Fold one CLOSED 1m bar into every configured TF.
   * @param {string} symbol
   * @param {{o:number,h:number,l:number,c:number,v?:number,openAt:number}} bar
   */
  push(symbol, bar) {
    if (!symbol || !bar || !Number.isFinite(bar.openAt) ||
        !Number.isFinite(bar.o) || !Number.isFinite(bar.h) ||
        !Number.isFinite(bar.l) || !Number.isFinite(bar.c)) {
      this.stats.late++;
      return;
    }

    let sym = this.symbols.get(symbol);
    if (!sym) {
      sym = new Map();
      this.symbols.set(symbol, sym);
      this.stats.symbols = this.symbols.size;
    }

    for (const tf of this.tfs) {
      const tfMs = tf * MS_1M;
      let st = sym.get(tfMs);
      if (!st) {
        st = { current: null, closed: [] };
        sym.set(tfMs, st);
      }

      const bucket = this._bucket(bar.openAt, tfMs);
      if (!st.current || bucket !== st.current.bucket) {
        // Rollover → close previous candle, open new one.
        if (st.current) this._close(symbol, st, tf, st.current);
        st.current = {
          bucket,
          openAt: bar.openAt,
          o: bar.o, h: bar.h, l: bar.l, c: bar.c,
          v: bar.v || 0,
        };
      } else {
        // Same bucket → merge.
        if (bar.h > st.current.h) st.current.h = bar.h;
        if (bar.l < st.current.l) st.current.l = bar.l;
        st.current.c = bar.c;
        st.current.v += bar.v || 0;
      }
    }
  }

  _close(symbol, st, tf, candle) {
    const closed = {
      openAt:  candle.openAt,
      closeAt: candle.openAt + tf * MS_1M,
      o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v,
    };
    st.closed.push(closed);
    if (st.closed.length > this.keep) st.closed.shift();
    this.stats.candles++;
    try {
      this.onCandle(symbol, tf, closed);
    } catch (err) {
      console.error(`[tf] onCandle error (${symbol} ${tf}m):`, err && err.message);
    }
  }

  /** Last N closed candles for (symbol, tf). Shallow copies — do not mutate. */
  getCandles(symbol, tfMinutes) {
    const sym = this.symbols.get(symbol);
    if (!sym) return [];
    return (sym.get(tfMinutes * MS_1M) || { closed: [] }).closed.slice();
  }

  /** Currently-forming candle (not closed) or null. */
  current(symbol, tfMinutes) {
    const sym = this.symbols.get(symbol);
    if (!sym) return null;
    return sym.get(tfMinutes * MS_1M)?.current || null;
  }

  /** Symbols that currently have ≥1 TF with data. */
  activeSymbols() {
    return [...this.symbols.keys()];
  }

  stop() {
    this.symbols.clear();
  }
}

module.exports = { TFEngine };
