'use strict';

class SignalBus {
  constructor(opts) {
    this.cooldownMs = opts.cooldownMs;
    this.last = new Map(); // pair → {ts, direction}
    this.handlers = [];
    this._pruneTimer = setInterval(() => this.prune(), 10 * 60 * 1000);
    if (this._pruneTimer.unref) this._pruneTimer.unref();
  }
  onSignal(fn) { this.handlers.push(fn); }
  prune() { // ১ ঘণ্টার পুরনো এন্ট্রি মুছুন — মেমরি-লিক নয়
    const cutoff = Date.now() - 3600 * 1000;
    for (const [k, v] of this.last) if (v.ts < cutoff) this.last.delete(k);
  }
  emit(sig) {
    const now = Date.now();
    const prev = this.last.get(sig.pair);
    if (prev && now - prev.ts < this.cooldownMs) return false;          // কুলডাউন
    if (prev && prev.direction === sig.direction && now - prev.ts < this.cooldownMs * 6) return false; // অ্যান্টি-হুইপস
    this.last.set(sig.pair, { ts: now, direction: sig.direction });
    for (const h of this.handlers) {
      try { h(sig); } catch (e) { console.error('[signals] handler error:', e.message); }
    }
    return true;
  }
  stop() { clearInterval(this._pruneTimer); }
}

module.exports = { SignalBus };
