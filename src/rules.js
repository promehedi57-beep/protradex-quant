'use strict';
const cfg = require('./config');

/* ---------- সিগনাল অবজেক্ট বিল্ডার (ATR-ভিত্তিক SL/TP) ---------- */
function buildSignal(snapshot, direction, confidence, reason, ruleId) {
  const price = snapshot.lastClose;
  const atr = snapshot.atr || price * 0.002;
  const up = direction === 'CALL';
  return {
    pair: snapshot.symbol,
    direction,                                   // 'CALL' | 'PUT'
    confidence: Math.min(97, Math.max(50, Math.round(confidence))),
    reason,
    rule: ruleId,
    levels: {
      entry: price,
      stopLoss: up ? price - atr * cfg.SL_ATR : price + atr * cfg.SL_ATR,
      takeProfit: up ? price + atr * cfg.TP_ATR : price - atr * cfg.TP_ATR,
      support: snapshot.donchian ? snapshot.donchian.lower : null,
      resistance: snapshot.donchian ? snapshot.donchian.upper : null
    },
    timeframe: cfg.TIMEFRAME,
    ts: Date.now()
  };
}

/* ---------- ★ রুল ডেফিনিশন — নতুন রুল যোগ করতে এখানে push করুন ----------
 * কন্ট্রাক্ট: check(snapshot, cfg) → {direction, confidence, reason, rule} | null
 */
const RULES = [
  {
    id: 'zscore_mean_reversion',
    desc: 'Z-Score ±2.0 + Linear-Regression slope confirm → mean-reversion',
    check(s) {
      const z = s.zscore;
      if (z === null) return null;
      if (z < -cfg.ZSCORE_ENTRY && s.slope > 0) {
        return buildSignal(s, 'CALL', 70 + Math.min(20, Math.abs(z) * 5),
          `Z-Score ${z.toFixed(2)} (oversold) + uptrend slope ${s.slope.toFixed(5)}`, 'zscore_mean_reversion');
      }
      if (z > cfg.ZSCORE_ENTRY && s.slope < 0) {
        return buildSignal(s, 'PUT', 70 + Math.min(20, Math.abs(z) * 5),
          `Z-Score ${z.toFixed(2)} (overbought) + downtrend slope ${s.slope.toFixed(5)}`, 'zscore_mean_reversion');
      }
      return null;
    }
  },
  {
    id: 'donchian_breakout',
    desc: 'Close > Donchian upper + ADX>25 → breakout; mirror below',
    check(s) {
      const dc = s.donchian;
      if (!dc || !s.adx) return null;
      if (s.adx.adx > cfg.ADX_STRONG) {
        if (s.lastClose > dc.upper) {
          return buildSignal(s, 'CALL', 75 + Math.min(15, s.adx.adx - cfg.ADX_STRONG),
            `Breakout above Donchian upper ${dc.upper.toFixed(6)} · ADX ${s.adx.adx.toFixed(1)}`, 'donchian_breakout');
        }
        if (s.lastClose < dc.lower) {
          return buildSignal(s, 'PUT', 75 + Math.min(15, s.adx.adx - cfg.ADX_STRONG),
            `Breakout below Donchian lower ${dc.lower.toFixed(6)} · ADX ${s.adx.adx.toFixed(1)}`, 'donchian_breakout');
        }
      }
      return null;
    }
  },
  {
    id: 'rsi_extreme',
    desc: 'RSI oversold + EMAfast>EMAslow → CALL; overbought + reverse → PUT',
    check(s) {
      if (s.rsi === null || s.emaFast === null || s.emaSlow === null) return null;
      if (s.rsi <= cfg.RSI_OVERSOLD && s.emaFast > s.emaSlow) {
        return buildSignal(s, 'CALL', 62 + (cfg.RSI_OVERSOLD - s.rsi),
          `RSI ${s.rsi.toFixed(1)} oversold · EMA${cfg.EMA_FAST} > EMA${cfg.EMA_SLOW}`, 'rsi_extreme');
      }
      if (s.rsi >= cfg.RSI_OVERBOUGHT && s.emaFast < s.emaSlow) {
        return buildSignal(s, 'PUT', 62 + (s.rsi - cfg.RSI_OVERBOUGHT),
          `RSI ${s.rsi.toFixed(1)} overbought · EMA${cfg.EMA_FAST} < EMA${cfg.EMA_SLOW}`, 'rsi_extreme');
      }
      return null;
    }
  },
  {
    id: 'macd_ema_follow',
    desc: 'Trend-follow: EMA cross + MACD histogram sign',
    check(s) {
      if (!s.macd || s.macd.signal === null) return null;
      if (s.emaFast > s.emaSlow && s.macd.histogram > 0) {
        return buildSignal(s, 'CALL', 60,
          `EMA${cfg.EMA_FAST} > EMA${cfg.EMA_SLOW} · MACD hist +`, 'macd_ema_follow');
      }
      if (s.emaFast < s.emaSlow && s.macd.histogram < 0) {
        return buildSignal(s, 'PUT', 60,
          `EMA${cfg.EMA_FAST} < EMA${cfg.EMA_SLOW} · MACD hist −`, 'macd_ema_follow');
      }
      return null;
    }
  }
  // ➕ আপনার এক্সাক্ট রুল: { id, desc, check(s){ ... return buildSignal(...) } }
];

/* ---------- ইভ্যালুয়েটর: সব রুল চালিয়ে সবচেয়ে শক্তিশালী সিগনাল ---------- */
function evaluate(snapshot) {
  if (!snapshot || !snapshot.ready) return null; // warm-up শেষ না হলে কোনো সিগনাল নয়
  let best = null;
  for (const rule of RULES) {
    try {
      const r = rule.check(snapshot);
      if (r && r.confidence >= cfg.MIN_CONFIDENCE && (!best || r.confidence > best.confidence)) best = r;
    } catch (e) {
      console.error(`[rules] ${rule.id} error:`, e.message); // সাইলেন্ট ফেলিউর নেই
    }
  }
  return best;
}

module.exports = { evaluate, RULES };
