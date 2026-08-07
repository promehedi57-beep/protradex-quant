'use strict';

class Metrics {
  constructor() {
    this.latencies = [];
    this.reset();
  }
  reset() {
    this.candles = 0;
    this.evals = 0;
    this.signals = 0;
    this.errors = 0;
    this.overBudget = 0;
    this.startedAt = Date.now();
  }
  record(ms) {
    this.latencies.push(ms);
    if (this.latencies.length > 5000) this.latencies.splice(0, this.latencies.length - 5000);
  }
  p95() {
    if (!this.latencies.length) return 0;
    const a = [...this.latencies].sort((x, y) => x - y);
    return a[Math.floor(a.length * 0.95)];
  }
  snapshot() {
    return {
      uptimeS: Math.round((Date.now() - this.startedAt) / 1000),
      latencyP95Ms: Math.round(this.p95() * 100) / 100,
      signals: this.signals,
      overBudget: this.overBudget
    };
  }
}

module.exports = { Metrics };
