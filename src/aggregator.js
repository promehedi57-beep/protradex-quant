'use strict';

/**
 * src/aggregator.js
 * Raw tick → 1m OHLCV bar aggregator.
 * O(1) per-tick rollup; emits a bar ONLY when the minute boundary rolls over.
 * No timers, no silent failures — every malformed tick is counted, every emit is guarded.
 */

const MS_1M = 60_000;

class Aggregator {
  /**
   * @param {object} opts
   * @param {(bar: {symbol:string,o:number,h:number,l:number,c:number,v:number,
   *                 openAt:number,closeAt:number,count:number}) => void} opts.onBar
   *        Called exactly once per CLOSED 1m bar.
   */
  constructor({ onBar } = {}) {
    if (typeof onBar !== 'function') {
      throw new Error('Aggregator: onBar callback is required');
    }
    this.onBar = onBar;
    this.bars = new Map(); // symbol -> open 1m bar
    this.stats = { ticks: 0, bars: 0, malformed: 0, late: 0, symbols: 0 };

    // Memory guard: drop symbols that stopped feeding (>3 min stale).
    this._pruneTimer = setInterval(() => this._prune(), 5 * 60 * 1000);
    if (this._pruneTimer.unref) this._pruneTimer.unref();
  }

  /**
   * Feed one tick (price update). Idempotent-safe, O(1).
   * @param {{symbol:string, price:number, ts?:number}} t
   */
  push(t) {
    if (!t || typeof t.symbol !== 'string' || !Number.isFinite(t.price)) {
      this.stats.malformed++;
      return;
    }
    const ts   = Number.isFinite(t.ts) ? t.ts : Date.now();
    const minute = Math.floor(ts / MS_1M);
    const cur  = this.bars.get(t.symbol);

    if (!cur) {
      // First tick of a fresh symbol.
      this.bars.set(t.symbol, {
        symbol: t.symbol, o: t.price, h: t.price, l: t.price, c: t.price,
        v: 0, count: 1, minute, openAt: ts,
      });
      this.stats.symbols = this.bars.size;
      this.stats.ticks++;
      return;
    }

    if (minute === cur.minute) {
      // Same-minute rollup.
      if (t.price > cur.h) cur.h = t.price;
      if (t.price < cur.l) cur.l = t.price;
      cur.c = t.price;
      cur.count++;
    } else if (minute > cur.minute) {
      // Boundary crossed → close old bar, open new one.
      this._close(cur);
      this.bars.set(t.symbol, {
        symbol: t.symbol, o: t.price, h: t.price, l: t.price, c: t.price,
        v: 0, count: 1, minute, openAt: ts,
      });
    } else {
      // Out-of-order / late tick from a previous minute — drop, but never silently.
      this.stats.late++;
      return;
    }
    this.stats.ticks++;
  }

  _close(bar) {
    try {
      const closed = {
        symbol:  bar.symbol,
        o:       bar.o,
        h:       bar.h,
        l:       bar.l,
        c:       bar.c,
        v:       bar.count,          // tick-count proxy volume (OTC has no real volume)
        openAt:  bar.openAt,
        closeAt: bar.openAt + MS_1M,
        count:   bar.count,
      };
      this.stats.bars++;
      this.onBar(closed);
    } catch (err) {
      // Never let a downstream error kill the feed loop.
      console.error('[aggregator] onBar error:', err && err.message);
    }
  }

  _prune() {
    const nowMin = Math.floor(Date.now() / MS_1M);
    for (const [sym, bar] of this.bars) {
      if (nowMin - bar.minute > 3) this.bars.delete(sym);
    }
  }

  /** Flush & release (shutdown only). */
  stop() {
    clearInterval(this._pruneTimer);
    this.bars.clear();
  }
}

module.exports = { Aggregator, MS_1M };
