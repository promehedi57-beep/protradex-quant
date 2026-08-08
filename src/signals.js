'use strict';
/* src/signals.js — event bus. Supports .on('signal', fn) AND .onSignal(fn).
   Every emit is guarded: a listener error NEVER crashes the caller. */
const { EventEmitter } = require('events');

class SignalBus extends EventEmitter {
  constructor() { super(); this.setMaxListeners(100); this._guard = (fn) => (...a) => { try { fn(...a); } catch (e) { console.error('[signals] listener error', e.message); } }; }
  onSignal(fn) { return this.on('signal', this._guard(fn)); }
  onChannel(ch, fn) { return this.on(ch, this._guard(fn)); }
  publish(ch, payload) { try { this.emit(ch, payload); } catch (e) { console.error('[signals] emit error', e.message); } }
  emit(ch, ...a) { return super.emit(ch, ...a); }
}
module.exports = { SignalBus };
