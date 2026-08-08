'use strict';
/* src/aggregator.js — raw tick → 1m OHLCV bar. MS_1M defined locally (no cross-require). */
const MS_1M = 60000;
class Aggregator {
  constructor({ onBar } = {}) { if (typeof onBar !== 'function') throw new Error('Aggregator: onBar required'); this.onBar = onBar; this.bars = new Map(); this.stats = { ticks:0, bars:0, malformed:0, late:0, symbols:0 }; this._prune = setInterval(() => { const m = Math.floor(Date.now()/MS_1M); for (const [s,b] of this.bars) if (m - b.minute > 3) this.bars.delete(s); }, 5*60000); if (this._prune.unref) this._prune.unref(); }
  push(t) {
    if (!t || typeof t.symbol !== 'string' || !Number.isFinite(t.price)) { this.stats.malformed++; return; }
    const ts = Number.isFinite(t.ts) ? t.ts : Date.now();
    const minute = Math.floor(ts / MS_1M); const cur = this.bars.get(t.symbol);
    if (!cur) { this.bars.set(t.symbol, { symbol:t.symbol, o:t.price, h:t.price, l:t.price, c:t.price, v:0, count:1, minute, openAt:ts }); this.stats.symbols=this.bars.size; this.stats.ticks++; return; }
    if (minute === cur.minute) { if (t.price>cur.h) cur.h=t.price; if (t.price<cur.l) cur.l=t.price; cur.c=t.price; cur.count++; }
    else if (minute > cur.minute) { this._close(cur); this.bars.set(t.symbol, { symbol:t.symbol, o:t.price, h:t.price, l:t.price, c:t.price, v:0, count:1, minute, openAt:ts }); }
    else { this.stats.late++; return; }
    this.stats.ticks++;
  }
  _close(b) { try { this.stats.bars++; this.onBar({ symbol:b.symbol, o:b.o, h:b.h, l:b.l, c:b.c, v:b.count, count:b.count, openAt:b.openAt }); } catch (e) { console.error('[aggregator]', e.message); } }
  stop() { clearInterval(this._prune); this.bars.clear(); }
}
module.exports = { Aggregator, MS_1M };
