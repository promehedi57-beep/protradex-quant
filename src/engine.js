'use strict';
const cfg = require('./config');
const { CandleState } = require('./indicators');
const { evaluate } = require('./rules');

const BATCH = 40;

class QuantEngine {
  constructor({ signalBus, metrics }) {
    this.signalBus = signalBus;
    this.metrics = metrics;
    this.states = new Map();      // symbol → CandleState
    this.queue = [];              // পেন্ডিং ইভ্যালুয়েশন
    this.processing = false;
    this.onCandle = null;         // হিটবিট হুক
    this.stats = { candles: 0, evaluations: 0, signals: 0, overBudget: 0, lastLatencyMs: 0 };
  }

  _state(symbol) {
    let st = this.states.get(symbol);
    if (!st) {
      st = new CandleState({
        symbol,
        rsiPeriod: cfg.RSI_PERIOD, zscorePeriod: cfg.ZSCORE_PERIOD,
        donchianPeriod: cfg.DONCHIAN_PERIOD, adxPeriod: cfg.ADX_PERIOD,
        atrPeriod: cfg.ATR_PERIOD, emaFast: cfg.EMA_FAST, emaSlow: cfg.EMA_SLOW,
        macdFast: cfg.MACD_FAST, macdSlow: cfg.MACD_SLOW, macdSignal: cfg.MACD_SIGNAL
      });
      this.states.set(symbol, st);
    }
    return st;
  }

  /** ফিড থেকে শুধু CLOSED ক্যান্ডেল কল হবে */
  onClosedCandle(symbol, candle) {
    try {
      const st = this._state(symbol);
      st.update(candle);
      this.stats.candles++;
      if (this.onCandle) this.onCandle(symbol);
      this.queue.push(symbol);
      this._drain();
    } catch (e) {
      console.error('[engine] onClosedCandle error', symbol, e.message);
    }
  }

  /** বুটে হিটরি সিডিং (ওয়ার্ম-আপ) — REST থেকে */
  seedHistory(symbol, candles) {
    if (!Array.isArray(candles) || !candles.length) return;
    const st = this._state(symbol);
    for (const c of candles) {
      if (c && Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low)) {
        st.update(c);
      }
    }
    this.stats.candles += candles.length;
  }

  _drain() {
    if (this.processing) return;
    this.processing = true;
    const start = Date.now();
    const step = () => {
      const batch = this.queue.splice(0, BATCH);
      for (const sym of batch) {
        const st = this.states.get(sym);
        if (!st || !st.snap || !st.snap.ready) continue;   // ওয়ার্ম-আপ শেষ না হলে স্কিপ
        const t0 = Date.now();
        this.stats.evaluations++;
        try {
          const sig = evaluate(st.snap);
          if (sig) { this.stats.signals++; this.signalBus.emit(sig); }
        } catch (e) {
          console.error('[engine] evaluate error', sym, e.message);
        }
        this.stats.lastLatencyMs = Date.now() - t0;
        if (this.metrics) this.metrics.record(Date.now() - t0);
      }
      if (this.queue.length) {
        if (Date.now() - start >= cfg.ENGINE_BUDGET_MS) {  // বাজেট শেষ → ইভেন্ট-লুপ ব্লক করছি না
          this.stats.overBudget++;
          setImmediate(step);
        } else {
          step();
        }
      } else {
        this.processing = false;
      }
    };
    step();
  }

  snapshot() { return { ...this.stats, pairs: this.states.size }; }
}

module.exports = { QuantEngine };
