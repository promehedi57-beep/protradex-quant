'use strict';

/**
 * src/math.js
 * Tiny shared math/utility helpers used by confidence.js and indicators.js.
 * Pure functions only — no IO, no timers, no dependencies.
 */

/** Clamp to [0, 1]. */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Clamp to any [a, b] range. */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Arithmetic mean of a numeric array (empty → 0). */
const mean = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
};

/** Population standard deviation (empty/single → 0). */
const std = (arr) => {
  if (!Array.isArray(arr) || arr.length < 2) return 0;
  const m = mean(arr);
  let sq = 0;
  for (const x of arr) sq += (x - m) * (x - m);
  return Math.sqrt(sq / arr.length);
};

/** Z-score of `value` relative to a window. */
const zscore = (value, arr) => {
  const s = std(arr);
  if (!s) return 0;
  return (value - mean(arr)) / s;
};

/** Simple moving average of last N of an array. */
const sma = (arr, n) => {
  if (!Array.isArray(arr) || !n || arr.length === 0) return 0;
  const slice = arr.slice(-n);
  return mean(slice);
};

/** Exponential moving average. `prev` is null on first call → returns price. */
const ema = (price, prev, period) => {
  const k = 2 / (period + 1);
  return prev == null ? price : price * k + prev * (1 - k);
};

/** Wilder-style smoothing used by RSI/ATR. */
const wilder = (prevAvg, cur, period) =>
  prevAvg == null ? cur : (prevAvg * (period - 1) + cur) / period;

/** Highest value in an array (empty → -Infinity). */
const hmax = (arr) => (Array.isArray(arr) && arr.length ? Math.max(...arr) : -Infinity);

/** Lowest value in an array (empty → Infinity). */
const hmin = (arr) => (Array.isArray(arr) && arr.length ? Math.min(...arr) : Infinity);

/** Round to `dp` decimal places, safely (0 → integer). */
const round = (v, dp = 0) => {
  const f = Math.pow(10, dp);
  return Math.round((Number(v) || 0) * f) / f;
};

module.exports = {
  clamp01,
  clamp,
  mean,
  std,
  zscore,
  sma,
  ema,
  wilder,
  hmax,
  hmin,
  round,
};
