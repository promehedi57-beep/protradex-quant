'use strict';

const cfg = require('./config');

class SignalBus {
  constructor(opts = {}) {
    // opts যদি undefined হয় বা cooldownMs না থাকে, তবে config.js থেকে মান নেবে
    this.cooldownMs = opts.cooldownMs || cfg.SIGNAL_COOLDOWN_MS || 300000;
    this.last = new Map(); // pair → {ts, direction}
    this.handlers = [];
    this._pruneTimer = setInterval(() => this.prune(), 10 * 60 * 1000);
    if (this._pruneTimer.unref) this._pruneTimer.unref();
  }

  // index.js-এর signalBus.on(...) কলের জন্য নতুন যোগ করা হলো
  on(event, fn) {
    if (typeof event === 'function') {
      this.handlers.push(event);
    } else if (typeof fn === 'function') {
      this.handlers.push(fn);
    }
  }

  onSignal(fn) { 
    if (typeof fn === 'function') this.handlers.push(fn); 
  }

  prune() { // ১ ঘণ্টার পুরনো এন্ট্রি মুছুন — মেমরি-লিক রোধে
    const cutoff = Date.now() - 3600 * 1000;
    for (const [k, v] of this.last) {
      if (v.ts < cutoff) this.last.delete(k);
    }
  }

  emit(sig) {
    if (!sig) return false;
    const pairKey = sig.pair || sig.symbol;
    if (!pairKey) return false;

    const now = Date.now();
    const prev = this.last.get(pairKey);

    if (prev && now - prev.ts < this.cooldownMs) return false;          // কুলডাউন
    if (prev && prev.direction === sig.direction && now - prev.ts < this.cooldownMs * 6) return false; // অ্যান্টি-হুইপস

    this.last.set(pairKey, { ts: now, direction: sig.direction });

    for (const h of this.handlers) {
      try { 
        h(sig); 
      } catch (e) { 
        console.error('[signals] handler error:', e.message); 
      }
    }
    return true;
  }

  // QuantEngine compatibility helper
  publish(event, sig) {
    // event যদি একটি অবজেক্ট হয় (যেমন sig) তবে সেটা পাস করবে
    const actualSig = sig || (typeof event === 'object' ? event : null);
    return this.emit(actualSig);
  }

  stop() { 
    if (this._pruneTimer) clearInterval(this._pruneTimer); 
  }
}

module.exports = { SignalBus };
