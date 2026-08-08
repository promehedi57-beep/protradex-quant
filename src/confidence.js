'use strict';

/**
 * src/confidence.js
 * Composes a single signal confidence (0–100) from 4 orthogonal estimators:
 *   RSI (reversion/extension), Z-Score (statistical extremity),
 *   S/R (breakout/rejection alignment), TF confluence (multi-TF agreement).
 * Pure functions — no timers, no IO, no silent failures.
 */

const cfg = require('./config');
const { clamp01, clamp } = require('./math');

/* ── Component 1 · RSI ── */
function rsiScore(fastRsi, slowRsi) {
  // mean-revert bias: extreme RSI below 30 favours LONG, above 70 favours SHORT
  const f = fastRsi ?? 50, s = slowRsi ?? 50;
  const blend = (f + s) / 2;
  const distLow = (30 - blend);     // + if oversold side
  const distHi  = (blend - 70);     // + if overbought side
  let score = 0;

  if (distLow > 0) score += 50 * clamp01(distLow / 25);         // oversold → LONG strength
  else if (distHi > 0) score += 50 * clamp01(distHi / 25);      // overbought → SHORT strength
  else score += Math.abs(blend - 50) * 0.4;                     // mid-zone weak edge

  // momentum confirm: fast RSI direction agrees with extreme?
  const direction = (fastRsi - slowRsi);                        // + = momentum up
  if (distLow > 0 && direction < 0) score *= 1.10;              // long + falling = reversion better
  if (distHi  > 0 && direction > 0) score *= 1.10;              // short + rising = rejection better
  return clamp(score, 0, 100);
}

/* ── Component 2 · Z-Score ── */
function zScoreScore(z) {
  const a = Math.abs(z ?? 0);
  if (!Number.isFinite(a)) return 0;
  // |z|≥2 is the classic extreme (≈95% prob) → peak here
  const peak = 2.0;
  let score = 0;
  if (a <= peak) score = 50 * (a / peak);
  else           score = 50 + 50 * clamp01((a - peak) / 2.5);  // deeper = even stronger until µ±4.5σ
  return clamp(score, 0, 100);
}

/* ── Component 3 · Support/Resistance alignment ──
   srHit: {level, type:'support'|'resistance'|'none',
            kind:'breakout'|'bounce'|'inside', distPct} */
function srScore(srHit, direction /* 'up' | 'down' */) {
  if (!srHit || srHit.type === 'none' || srHit.kind === 'inside') return 35; // neutral baseline
  const strength = clamp01(1 - (srHit.distPct ?? 0.5) / 2);                  // closer → stronger
  if (srHit.kind === 'breakout') {
    // breakout in the trade direction is bullish momentum
    const aligned = (srHit.type === 'resistance' && direction === 'up') ||
                    (srHit.type === 'support'    && direction === 'down');
    return aligned ? clamp(55 + 45 * strength, 0, 100) : 50;
  }
  // bounce / rejection opposite the level = strong mean-revert trade
  const bounce = (srHit.type === 'support'    && direction === 'up') ||
                 (srHit.type === 'resistance' && direction === 'down');
  return bounce ? clamp(50 + 50 * strength, 0, 100) : 45;
}

/* ── Component 4 · Timeframe confluence ──
   tfSignals: array of {tf, direction:'up'|'down'|'flat', score} for 5/10/15/20m */
function tfConfluenceScore(tfSignals, primaryDir) {
  if (!Array.isArray(tfSignals) || !tfSignals.length) return 50;
  const votes = tfSignals.map(({ direction }) => {
    if (direction === primaryDir) return 1;
    if (direction === 'flat')     return 0.25;
    return -1;                                             // opposing TF
  });
  const raw = votes.reduce((a, b) => a + b, 0) / votes.length;   // −1 … +1
  return clamp(50 + raw * 50, 0, 100);                           // 0 at −1, 100 at +1
}

/* ── Composer ── */
function computeConfidence({ fastRsi, slowRsi, zscore, srHit, tfSignals, direction }) {
  const w = {
    rsi:    cfg.CONF_W_RSI    ?? 0.25,
    zscore: cfg.CONF_W_ZSCORE ?? 0.25,
    sr:     cfg.CONF_W_SR     ?? 0.25,
    tf:     cfg.CONF_W_TF     ?? 0.25,
  };
  const total = w.rsi + w.zscore + w.sr + w.tf || 1;
  const c =
    (w.rsi    * rsiScore(fastRsi, slowRsi) +
     w.zscore * zScoreScore(zscore) +
     w.sr     * srScore(srHit, direction) +
     w.tf     * tfConfluenceScore(tfSignals, direction)) / total;
  return Math.round(clamp(c, 0, 97));        // cap at 97 — never promise certainty
}

module.exports = {
  computeConfidence,
  rsiScore,
  zScoreScore,
  srScore,
  tfConfluenceScore,
};
