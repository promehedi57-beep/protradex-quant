'use strict';

// লিনিয়ার রিগ্রেশন স্লোপ ক্যালকুলেশন
function linRegSlope(values, period) {
  if (!values || values.length < period) return 0;
  const slice = values.slice(-period);
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < period; i++) {
    sumX += i;
    sumY += slice[i];
    sumXY += i * slice[i];
    sumX2 += i * i;
  }
  const slope = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
  return isNaN(slope) ? 0 : slope;
}

class CandleState {
  constructor(opts = {}) {
    this.symbol = opts.symbol || 'BTCUSDT';
    this.closes = [];
    this.ready = false;
    
    // সেফটি ফলব্যাক অবজেক্ট (ইন্ডিকেটর না থাকলে যেন ক্র্যাশ না করে)
    this.rsi = opts.rsi || { update: () => 50 };
    this.zscore = opts.zscore || { update: () => 0 };
    this.donchian = opts.donchian || { update: (c) => ({ upper: c.close, lower: c.close }) };
    this.adx = opts.adx || { update: () => 25 };
    this.atr = opts.atr || { update: (c) => 10 };
    this.emaFast = opts.emaFast || { update: (c) => c };
    this.emaSlow = opts.emaSlow || { update: (c) => c };
    this.macd = opts.macd || { update: () => ({ macd: 0, signal: 0, histogram: 0 }) };
  }

  update(candle) {
    if (!candle || typeof candle.close !== 'number') {
      return this.snap || null;
    }

    this.closes.push(candle.close);
    if (this.closes.length > 500) this.closes.shift();

    const isDataReady = this.closes.length >= 14;
    this.ready = isDataReady;

    this.snap = {
      symbol: this.symbol,
      lastClose: candle.close,
      rsi: typeof this.rsi?.update === 'function' ? this.rsi.update(candle.close) : 50,
      zscore: typeof this.zscore?.update === 'function' ? this.zscore.update(candle.close) : 0,
      donchian: typeof this.donchian?.update === 'function' ? this.donchian.update(candle) : null,
      adx: typeof this.adx?.update === 'function' ? this.adx.update(candle) : null,
      atr: typeof this.atr?.update === 'function' ? this.atr.update(candle) : null,
      emaFast: typeof this.emaFast?.update === 'function' ? this.emaFast.update(candle.close) : candle.close,
      emaSlow: typeof this.emaSlow?.update === 'function' ? this.emaSlow.update(candle.close) : candle.close,
      macd: typeof this.macd?.update === 'function' ? this.macd.update(candle.close) : null,
      slope: linRegSlope(this.closes, 14),
      ready: this.ready
    };

    return this.snap;
  }
}

module.exports = { CandleState, linRegSlope };
