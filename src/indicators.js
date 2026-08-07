update(candle) {
    // ১. সেফটি চেক: ক্যান্ডেল বা candle.close সঠিকভাবে পাওয়া গেছে কিনা
    if (!candle || typeof candle.close !== 'number') {
      return this.snap || null;
    }

    this.closes.push(candle.close);
    if (this.closes.length > 500) this.closes.shift();

    // ২. ইন্ডিকেটর হিসাবের জন্য পর্যাপ্ত ক্যান্ডেল জমেছে কিনা চেক করা (কমপক্ষে ৩০টি ক্যান্ডেল)
    const isDataReady = this.closes.length >= 30;

    this.snap = {
      symbol: this.symbol,
      lastClose: candle.close,
      rsi: this.rsi ? this.rsi.update(candle.close) : null,
      zscore: this.zscore ? this.zscore.update(candle.close) : null,
      donchian: this.donchian ? this.donchian.update(candle) : null,
      adx: this.adx ? this.adx.update(candle) : null,
      atr: this.atr ? this.atr.update(candle) : null,
      emaFast: this.emaFast ? this.emaFast.update(candle.close) : null,
      emaSlow: this.emaSlow ? this.emaSlow.update(candle.close) : null,
      macd: this.macd ? this.macd.update(candle.close) : null,
      slope: (typeof linRegSlope === 'function' && this.closes.length >= 14) 
             ? linRegSlope(this.closes, 14) 
             : 0
    };

    // ৩. ready প্রপার্টি নিশ্চিত করা
    this.ready = typeof this.ready !== 'undefined' ? this.ready : isDataReady;
    this.snap.ready = this.ready || isDataReady;

    return this.snap;
}
