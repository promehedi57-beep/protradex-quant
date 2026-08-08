'use strict';
/* src/tf.js — 1m bars → 1/5/10/15m candles. MS_1M injected via constructor (decoupled). */
class TFEngine {
  constructor({ onCandle, tfs = [1,5,10,15], keep = 260 } = {}) {
    if (typeof onCandle !== 'function') throw new Error('TFEngine: onCandle required');
    this.onCandle = onCandle; this.tfs = [...new Set(tfs.map(Number))].filter(n => Number.isInteger(n) && n >= 1).sort((a,b)=>a-b);
    if (!this.tfs.length) this.tfs = [15]; this.keep = Math.max(60, keep); this.MS_1M = 60000; this.map = new Map(); this.stats = { candles:0, late:0, symbols:0 };
  }
  push(symbol, bar) {
    if (!symbol || !bar || !Number.isFinite(bar.openAt)) { this.stats.late++; return; }
    let sm = this.map.get(symbol); if (!sm) { sm = new Map(); this.map.set(symbol, sm); this.stats.symbols = this.map.size; }
    for (const tf of this.tfs) {
      const tfMs = tf * this.MS_1M; let st = sm.get(tfMs); if (!st) { st = { cur:null, closed:[] }; sm.set(tfMs, st); }
      const bucket = Math.floor(bar.openAt / tfMs);
      if (!st.cur || bucket !== st.cur.bucket) { if (st.cur) this._close(symbol, st, tf, st.cur); st.cur = { bucket, openAt:bar.openAt, o:bar.o, h:bar.h, l:bar.l, c:bar.c, v:bar.v||0 }; }
      else { if (bar.h>st.cur.h) st.cur.h=bar.h; if (bar.l<st.cur.l) st.cur.l=bar.l; st.cur.c=bar.c; st.cur.v += bar.v||0; }
    }
  }
  _close(symbol, st, tf, c) { const closed = { openAt:c.openAt, closeAt:c.openAt + tf*this.MS_1M, o:c.o, h:c.h, l:c.l, c:c.c, v:c.v }; st.closed.push(closed); if (st.closed.length>this.keep) st.closed.shift(); this.stats.candles++; try { this.onCandle(symbol, tf, closed); } catch (e) { console.error('[tf]', e.message); } }
  getCandles(symbol, tf) { const sm=this.map.get(symbol); return (sm && sm.get(tf*this.MS_1M)) ? sm.get(tf*this.MS_1M).closed.slice() : []; }
  current(symbol, tf) { const sm=this.map.get(symbol); return (sm && sm.get(tf*this.MS_1M)?.cur) || null; }
  activeSymbols() { return [...this.map.keys()]; }
  stop() { this.map.clear(); }
}
module.exports = { TFEngine };
