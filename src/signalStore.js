'use strict';
/* signalStore.js — single source of truth for ACTIVE live signals.
   No heavy deps. Emits 'change' {type:'add'|'update'|'close', signal, at}. */
const { EventEmitter } = require('events');
const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));
const DEFAULT_DP = (pair, market) =>
  String(pair).toUpperCase().includes('OTC') || String(market).toUpperCase().includes('OTC') ? 5 : 2;

class SignalStore extends EventEmitter {
  constructor({ pruneMs = 1000, unref = true } = {}) {
    super();
    this.setMaxListeners(0);
    this._map = new Map();
    this._stats = { wins: 0, losses: 0, total: 0, streak: 0, _cur: 0, winRate: 0 };
    this._timer = setInterval(() => this._prune(), pruneMs);
    if (unref && this._timer.unref) this._timer.unref();
  }

  _normalize(raw, dt = Date.now()) {
    const d = String(raw.direction || raw.dir || raw.side || '').trim().toUpperCase();
    const direction = /CALL|BUY|UP|LONG/.test(d) ? 'CALL' : /PUT|SELL|DOWN|SHORT/.test(d) ? 'PUT' : null;
    if (!direction) return null;
    const pair = String(raw.pair || raw.symbol || raw.asset || raw.instrument || '').trim();
    if (!pair) return null;
    const m = String(raw.market || raw.market_type || raw.exchange || '').toUpperCase();
    const market = m.includes('OTC') || pair.toUpperCase().includes('OTC') ? 'OTC' : 'CRYPTO';
    const candleTime = Math.max(5, Number(raw.candleTime ?? raw.candle_time ?? raw.timeframe_sec ?? raw.timeframe ?? 60) || 60);
    const ts = Number(raw.timestamp ?? raw.created_at ?? raw.createdAt ?? dt) || dt;
    const entry = Number(raw.entryPrice ?? raw.entry ?? raw.price ?? 0) || 0;
    const dp = Number.isFinite(+raw.dp) ? +raw.dp : DEFAULT_DP(pair, market);
    const status = String(raw.status || '');
    return {
      id: String(raw.id ?? `${pair}|${direction}|${ts}`),
      pair, market, direction,
      confidence: clamp(raw.confidence ?? raw.conf ?? 0, 0, 100),
      rsi: clamp(raw.rsi ?? 50, 0, 100),
      entryPrice: entry, price: entry, dp,
      candleTime, timestamp: ts, createdAt: ts,
      expireAt: ts + candleTime * 1000,
      phase: 'active',
      result: raw.result
        || (/(^|\W)WIN/.test(status) ? 'WIN' : /(^|\W)LOSS|LOST/.test(status) ? 'LOSS' : null),
      source: raw.source || 'engine',
      meta: raw.meta || {},
    };
  }

  // upsert (add or update). Returns {signal, created} or null if not a valid signal.
  upsert(raw, dt = Date.now()) {
    const n = this._normalize(raw, dt);
    if (!n) return null;
    const prev = this._map.get(n.id);
    const isNew = !prev;
    if (prev) Object.assign(prev, n);
    else { this._map.set(n.id, n); this._stats.total++; }
    const sig = prev || n;
    this.emit('change', { type: isNew ? 'add' : 'update', signal: sig, at: dt });
    return { signal: sig, created: isNew };
  }

  resolve(id, result) {
    const s = this._map.get(id);
    if (!s || s.phase === 'closed') return null;
    const r = /WIN|PROFIT/i.test(String(result)) ? 'WIN'
            : /LOSS|LOST|FAIL/i.test(String(result)) ? 'LOSS' : null;
    s.phase = 'closed'; s.result = r || null; s.closedAt = Date.now();
    if (r) this._record(r);
    this.emit('change', { type: 'close', signal: s, at: Date.now() });
    return s;
  }

  _record(r) {
    const st = this._stats;
    if (r === 'WIN') { st.wins++; st._cur = st._cur > 0 ? st._cur + 1 : 1; }
    else if (r === 'LOSS') { st.losses++; st._cur = st._cur < 0 ? st._cur - 1 : -1; }
    st.streak = st._cur;
    const done = st.wins + st.losses;
    st.winRate = done ? Math.round((st.wins / done) * 1000) / 10 : 0;
  }

  // ONLY still-open, not-yet-expired signals (what the terminal renders).
  getActive() {
    const now = Date.now();
    const out = [];
    this._map.forEach(s => { if (s.phase === 'active' && now < s.expireAt) out.push({ ...s }); });
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  stats() {
    return { ...this._stats, active: this.getActive().length, totalSignals: this._stats.total };
  }

  _prune() {
    const now = Date.now();
    this._map.forEach((s, id) => {
      const live = s.phase === 'active' && now < s.expireAt;
      const stamp = s.phase === 'closed' && (now - (s.closedAt || now)) < 45000; // 45s WIN/LOSS stamp
      if (!live && !stamp) this._map.delete(id);
    });
  }

  get size() { return this._map.size; }
}
module.exports = { SignalStore, clamp, DEFAULT_DP };
