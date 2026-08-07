update(candle) {
    this.closes.push(candle.close);
    if (this.closes.length > 500) this.closes.shift();
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
    this.snap.ready = this.ready;   // ← এই লাইনটা যোগ করুন (নাহলে কোনো সিগনাল আসবে না)
    return this.snap;
}
