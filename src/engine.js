'use strict';

/**
 * src/engine.js
 * Multi-TF quant pipeline core.
 * Instruments: RSI, Z-Score, S/R, EMA slope, and TF confluence.
 * Runs < ENGINE_BUDGET_MS per batch (parallel-ish via chunked _drain).
 */

const cfg = require('./config');
const { Aggregator } = require('./aggregator');
const { TFEngine } = require('./tf');
const { IndicatorHub } = require('./indicators');
const { computeConfidence } = require('./confidence');
const rules = require('./rules');
const rt = require('./state');

class QuantEngine {
  constructor({ signalBus }) {
    this.signalBus = signalBus;
    this.livePrices = new Map();        // symbol -> last live price
    this.lastClose  = new Map();        // symbol -> last closed price
    this.lastSignals = new Map();       // symbol -> last emitted signal
    this.signalsTotal = 0;
    this.lastCandleAt = null;           // Track last 1m bar arrival time

    this.agg  = new Aggregator({ onBar: (b) => this.on1mBar(b) });
    this.tf   = new TFEngine({ onCandle: (sym, tf, c) => this.onTFCandle(sym, tf, c) });
    this.hub  = new IndicatorHub();
    this.pairs = new Map();             // symbol -> {universe:'crypto'|'otc'|'fx', lastSignal}

    this._startedAt = Date.now();
    this._budget = cfg.ENGINE_BUDGET_MS || 50;
    this._queue = [];                   // pending symbols for budgeted drain
  }

  /* ── ingestion ── */
  onTickFeed(t) {                       // called by OTC + Binance + OANDA
    this.agg.push(t);
  }

  on1mBar(bar) {
    this.lastCandleAt = Date.now();     // ✅ Set timestamp when a 1m candle arrives
    this.lastClose.set(bar.symbol, bar.c);
    
    if (!this.pairs.has(bar.symbol)) {
      this.pairs.set(bar.symbol, { universe: this._guessUniverse(bar.symbol), lastSignal: null });
    }
    
    this.hub.pushClose(bar.symbol, cfg.ACTIVE_TIMEFRAME, bar.c);   // S/R + active-TF
    this.hub.srFor(bar.symbol).pushClose(bar.c);
    this.hub.cleanup([...this.pairs.keys()]);
    this.tf.push(bar.symbol, bar);                                  // fold into multi-TF
    this._enqueue(bar.symbol);
  }

  onTFCandle(symbol, tf, candle) {
    // incremental indicators per (symbol × tf)
    this.hub.pushClose(symbol, tf, candle.c);
  }

  _guessUniverse(sym) {
    const s = String(sym).toUpperCase();
    if (s.endsWith('_OTC')) return 'otc';
    if (/(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|XAU|XAG)/.test(s) && s.includes('_')) return 'fx';
    return 'crypto';
  }

  handleLivePrice(symbol, price) { 
    this.livePrices.set(symbol, price); 
  }

  _enqueue(sym) { 
    if (!this._queue.includes(sym)) {
      this._queue.push(sym); 
    }
  }

  /* ── budgeted evaluation: < ENGINE_BUDGET_MS per burst ── */
  _drain() {
    const until = Date.now() + this._budget;
    while (this._queue.length > 0 && Date.now() < until) {
      const sym = this._queue.shift();
      try { 
        this._evaluate(sym); 
      } catch (e) { 
        console.error(`[engine] eval ${sym}:`, e && e.message); 
      }
    }
  }

  pump() { 
    this._drain(); 
  }

  _evaluate(symbol) {
    const snapshot = this._snapshot(symbol);
    
    // Safety check: skip if indicators are not warmed up yet
    if (!snapshot.ready) { 
      return; 
    }

    const rule = rules.evaluate(symbol, snapshot);
    if (!rule) { 
      return; 
    }

    if (rule.confidence >= rt.getConfidence()) {
      const lastSig = this.lastSignals.get(symbol);
      const isNew = !lastSig || 
                    lastSig.sig !== rule.sig || 
                    (Date.now() - (lastSig.t || 0)) > cfg.SIGNAL_COOLDOWN_MS;

      rule.engineAt = Date.now(); 
      rule.symbol = symbol; 
      rule.price = snapshot.price;

      if (isNew) {
        this.lastSignals.set(symbol, { sig: rule.sig, t: Date.now() });
        this.signalsTotal++;
        
        const pairData = this.pairs.get(symbol);
        if (pairData) pairData.lastSignal = rule;

        try { 
          this.signalBus.publish('signal', rule); 
        } catch (e) { 
          console.error('[engine] bus publish error:', e.message); 
        }
      }
    }
  }

  _snapshot(symbol) {
    const tfA = cfg.ACTIVE_TIMEFRAME;
    const s = this.hub.snapshot(symbol, tfA);
    const sr = this.hub.srFor(symbol).hit(
      s.livePrice ?? s.lastPrice ?? this.lastClose.get(symbol), 
      s.sloped ? 'up' : 'down'
    );
    const price = this.livePrices.get(symbol) ?? this.lastClose.get(symbol) ?? null;

    // TF confluence votes
    const tfVotes = (cfg.TIMEFRAMES || []).map(tf => {
      const snap = this.hub.snapshot(symbol, tf);
      return { tf, direction: snap.sloped ? 'up' : 'down', score: snap.rsi ?? 50, ready: snap.ready };
    });

    // candidate direction from active-TF Z-Score
    let direction = 'flat';
    if (s.zscore <= -1) direction = 'up';
    else if (s.zscore >= 1) direction = 'down';

    const confidence = computeConfidence({
      fastRsi: s.rsi, 
      slowRsi: this.hub.snapshot(symbol, Math.min(20, (cfg.TIMEFRAMES[cfg.TIMEFRAMES.length-1]||20))).rsi,
      zscore: s.zscore, 
      srHit: sr, 
      tfSignals: tfVotes, 
      direction,
    });

    return {
      symbol, 
      price, 
      ready: s.ready,
      rsi: s.rsi, 
      zscore: s.zscore, 
      slope: s.sloped ? 1 : -1,
      sr: { level: sr.type === 'none' ? null : srLevelHere(sr, this.hub, symbol), kind: sr.kind, type: sr.type },
      confidence, 
      direction,
      live: price ?? null,
    };
  }

  /* ── dashboard / API snapshot ── */
  getPairsSnapshot(limit = 24) {
    const out = [];
    for (const [sym, meta] of this.pairs) {
      const s = this.hub.snapshot(sym, cfg.ACTIVE_TIMEFRAME);
      const price = this.livePrices.get(sym) ?? this.lastClose.get(sym);
      if (price == null) continue;

      out.push({
        symbol: sym,
        price: price,
        change: 0,                       // 24h % — computed in feed layer
        rsi: s.rsi,
        zscore: s.zscore,
        slope: s.sloped ? 'up' : 'down',
        confidence: s.ready ? s.rsi : 0,
        direction: s.sloped ? 'CALL' : 'PUT',
        signal: meta.lastSignal?.sig || 'NEUTRAL',
        universe: meta.universe,
      });
    }
    out.sort((a, b) => (b.confidence - a.confidence));
    return out.slice(0, limit);
  }

  status() {
    return {
      uptime: Math.floor((Date.now() - this._startedAt) / 1000),
      pairs: this._pairsCount(),
      signals_total: this.signalsTotal,
      execution: rt.getExecution(),
      timeframe: cfg.ACTIVE_TIMEFRAME,
      tfs: cfg.TIMEFRAMES,
      lastCandleAt: this.lastCandleAt,
    };
  }

  _pairsCount() { 
    return this.pairs.size; 
  }

  /* live price for dashboard latency */
  onLivePrice(symbol, price) { 
    this.handleLivePrice(symbol, price); 
  }
}

function srLevelHere(sr, hub, symbol) {
  const lvl = (sr.type === 'resistance') ? hub.srFor(symbol).resistance
            : (sr.type === 'support')    ? hub.srFor(symbol).support  : null;
  return lvl ? lvl.price : null;
}

module.exports = { QuantEngine };
