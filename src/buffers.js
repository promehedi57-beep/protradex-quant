'use strict';

/* ---------- EMA (SMA-সিডেড, k=2/(n+1)) ---------- */
class EMAState {
  constructor(period) { this.period = period; this.sum = 0; this.count = 0; this.value = null; }
  update(price) {
    if (this.count < this.period) {
      this.sum += price; this.count++;
      if (this.count === this.period) this.value = this.sum / this.period;
      return this.value;
    }
    const k = 2 / (this.period + 1);
    this.value = price * k + this.value * (1 - k);
    return this.value;
  }
  get ready() { return this.value !== null; }
}

/* ---------- RSI (Wilder smoothing) ---------- */
class RSIState {
  constructor(period) { this.period = period; this.avgGain = null; this.avgLoss = null; this.prev = null; this.count = 0; }
  update(price) {
    if (this.prev === null) { this.prev = price; return null; }
    const diff = price - this.prev; this.prev = price;
    const gain = diff > 0 ? diff : 0, loss = diff < 0 ? -diff : 0;
    if (this.avgGain === null) { this.avgGain = gain; this.avgLoss = loss; this.count = 1; return null; }
    if (this.count < this.period) {
      this.avgGain += gain; this.avgLoss += loss; this.count++;
      if (this.count < this.period) return null;
      this.avgGain /= this.period; this.avgLoss /= this.period;
    } else {
      this.avgGain = (this.avgGain * (this.period - 1) + gain) / this.period;
      this.avgLoss = (this.avgLoss * (this.period - 1) + loss) / this.period;
    }
    if (this.avgGain + this.avgLoss === 0) return 50;
    if (this.avgLoss === 0) return 100;
    return 100 - 100 / (1 + this.avgGain / this.avgLoss);
  }
  get ready() { return this.count >= this.period; }
}

/* ---------- ADX / +DI / -DI (Wilder) ---------- */
class ADXState {
  constructor(period) { this.period = period; this.trSum = 0; this.pdmSum = 0; this.mdmSum = 0; this.count = 0; this.prevADX = null; this.prev = null; }
  update(c) {
    if (this.prev === null) { this.prev = c; return null; }
    const tr = Math.max(c.high - c.low, Math.abs(c.high - this.prev.close), Math.abs(c.low - this.prev.close));
    const up = c.high - this.prev.high, down = this.prev.low - c.low;
    const pdm = (up > down && up > 0) ? up : 0;
    const mdm = (down > up && down > 0) ? down : 0;
    this.prev = c;
    if (this.count < this.period) {
      this.trSum += tr; this.pdmSum += pdm; this.mdmSum += mdm; this.count++;
      if (this.count < this.period) return null;
    } else {
      this.trSum = this.trSum - this.trSum / this.period + tr;
      this.pdmSum = this.pdmSum - this.pdmSum / this.period + pdm;
      this.mdmSum = this.mdmSum - this.mdmSum / this.period + mdm;
    }
    const pDI = this.trSum > 0 ? (100 * this.pdmSum) / this.trSum : 0;
    const mDI = this.trSum > 0 ? (100 * this.mdmSum) / this.trSum : 0;
    const dx = (pDI + mDI) > 0 ? (100 * Math.abs(pDI - mDI)) / (pDI + mDI) : 0;
    this.prevADX = this.prevADX === null ? dx : (this.prevADX * (this.period - 1) + dx) / this.period;
    return { adx: this.prevADX, plusDI: pDI, minusDI: mDI };
  }
  get ready() { return this.prevADX !== null; }
}

/* ---------- ATR (Wilder) ---------- */
class ATRState {
  constructor(period) { this.period = period; this.trSum = 0; this.count = 0; this.value = null; this.prev = null; }
  update(c) {
    if (this.prev === null) { this.prev = c; return null; }
    const tr = Math.max(c.high - c.low, Math.abs(c.high - this.prev.close), Math.abs(c.low - this.prev.close));
    this.prev = c;
    if (this.count < this.period) { this.trSum += tr; this.count++; if (this.count === this.period) this.value = this.trSum / this.period; return this.value; }
    this.value = (this.value * (this.period - 1) + tr) / this.period;
    return this.value;
  }
  get ready() { return this.value !== null; }
}

/* ---------- Z-Score (রোলিং sum/sumSq — O(1)) ---------- */
class RollingZScore {
  constructor(period) { this.period = period; this.window = []; this.sum = 0; this.sumSq = 0; }
  update(price) {
    this.window.push(price); this.sum += price; this.sumSq += price * price;
    if (this.window.length > this.period) { const old = this.window.shift(); this.sum -= old; this.sumSq -= old * old; }
    if (this.window.length < this.period) return null;
    const mean = this.sum / this.period;
    const variance = Math.max(0, this.sumSq / this.period - mean * mean);
    const sd = Math.sqrt(variance);
    return sd > 0 ? (price - mean) / sd : 0;
  }
  get ready() { return this.window.length >= this.period; }
}

/* ---------- Donchian (O(period), period ছোট) ---------- */
class DonchianState {
  constructor(period) { this.period = period; this.window = []; }
  update(c) {
    this.window.push(c);
    if (this.window.length > this.period) this.window.shift();
    if (this.window.length < this.period) return null;
    let hi = -Infinity, lo = Infinity;
    for (const x of this.window) { if (x.high > hi) hi = x.high; if (x.low < lo) lo = x.low; }
    return { upper: hi, lower: lo, middle: (hi + lo) / 2 };
  }
  get ready() { return this.window.length >= this.period; }
}

/* ---------- MACD (3টি chained EMA) ---------- */
class MACDState {
  constructor(fast, slow, signal) {
    this.fast = new EMAState(fast); this.slow = new EMAState(slow); this.signal = new EMAState(signal);
    this.last = null;
  }
  update(price) {
    this.fast.update(price); this.slow.update(price);
    if (!this.fast.ready || !this.slow.ready) return null;
    const macd = this.fast.value - this.slow.value;
    this.signal.update(macd);
    const sig = this.signal.ready ? this.signal.value : null;
    this.last = { macd, signal: sig, histogram: sig !== null ? macd - sig : null };
    return this.last;
  }
  get ready() { return this.last !== null && this.last.signal !== null; }
}

/* ---------- Linear Regression Slope (O(period)) ---------- */
function linRegSlope(closes, period) {
  if (closes.length < period) return null;
  const n = period;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  let sumY = 0, sumXY = 0;
  for (let j = 0; j < n; j++) { const y = closes[closes.length - n + j]; sumY += y; sumXY += j * y; }
  return (n * sumXY - sumX * sumY) / denom;
}

/* ---------- ★ প্রতি-পেয়ার কম্বাইন্ড স্টেট (ইঞ্জিন এটাকেই আপডেট করে) ---------- */
class CandleState {
  constructor(opts) {
    this.symbol = opts.symbol;
    this.rsi = new RSIState(opts.rsiPeriod);
    this.zscore = new RollingZScore(opts.zscorePeriod);
    this.donchian = new DonchianState(opts.donchianPeriod);
    this.adx = new ADXState(opts.adxPeriod);
    this.atr = new ATRState(opts.atrPeriod);
    this.emaFast = new EMAState(opts.emaFast);
    this.emaSlow = new EMAState(opts.emaSlow);
    this.macd = new MACDState(opts.macdFast, opts.macdSlow, opts.macdSignal);
    this.closes = [];
    this.snap = null;
  }
  update(candle) {
    this.closes.push(candle.close);
    if (this.closes.length > 500) this.closes.shift(); // ক্যাপ
    this.snap = {
      symbol: this.symbol,
      lastClose: candle.close,
      rsi: this.rsi.update(candle.close),
      zscore: this.zscore.update(candle.close),
      donchian: this.donchian.update(candle),
      adx: this.adx.update(candle),
      atr: this.atr.update(candle),
      emaFast: this.emaFast.update(candle.close),
      emaSlow: this.emaSlow.update(candle.close),
      macd: this.macd.update(candle.close),
      slope: linRegSlope(this.closes, 14)
    };
    return this.snap;
  }
  get ready() {
    return this.rsi.ready && this.zscore.ready && this.donchian.ready && this.adx.ready &&
           this.atr.ready && this.emaFast.ready && this.emaSlow.ready && this.macd.ready;
  }
}

module.exports = { CandleState, linRegSlope };
