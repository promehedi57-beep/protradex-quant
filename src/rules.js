'use strict';

const cfg = require('./config');
const rt = require('./state');
const { computeConfidence } = require('./confidence');

/* ---------- সিগনাল অবজেক্ট বিল্ডার (ATR-ভিত্তিক SL/TP) ---------- */
function buildSignal(snapshot, direction, rawConfidence, reason, ruleId) {
  const price = snapshot.price ?? snapshot.lastClose ?? 0;
  const atr = snapshot.atr || (price ? price * 0.002 : 1);
  const isCall = direction === 'CALL';

  // computeConfidence কম্পোজার হুক ব্যবহার করা হচ্ছে
  const dynamicConfidence = computeConfidence({
    ...snapshot,
    direction: direction.toLowerCase() === 'call' ? 'up' : 'down'
  });

  // রুল নির্দিষ্ট স্কোর এবং কম্পোজার স্কোরের মধ্যে সামঞ্জস্য
  const finalConfidence = Math.min(97, Math.max(50, Math.round(dynamicConfidence || rawConfidence)));

  return {
    pair: snapshot.symbol,
    sig: direction,                              // Engine compatibility (CALL / PUT)
    direction,                                   // 'CALL' | 'PUT'
    confidence: finalConfidence,
    reason,
    rule: ruleId,
    levels: {
      entry: price,
      stopLoss: isCall ? price - atr * (cfg.SL_ATR || 1.5) : price + atr * (cfg.SL_ATR || 1.5),
      takeProfit: isCall ? price + atr * (cfg.TP_ATR || 2.0) : price - atr * (cfg.TP_ATR || 2.0),
      support: snapshot.donchian ? snapshot.donchian.lower : null,
      resistance: snapshot.donchian ? snapshot.donchian.upper : null
    },
    timeframe: cfg.ACTIVE_TIMEFRAME || cfg.TIMEFRAME || '1m',
    ts: Date.now()
  };
}

/* ---------- ★ রুল ডেফিনিশন ---------- */
const RULES = [
  {
    id: 'zscore_mean_reversion',
    desc: 'Z-Score ±2.0 + Linear-Regression slope confirm → mean-reversion',
    check(s) {
      const z = s.zscore;
      if (z === null || z === undefined) return null;
      const slopeVal = typeof s.slope === 'number' ? s.slope : (s.slope === 'up' ? 1 : -1);
      const zMin = cfg.ZSCORE_ENTRY || cfg.RULES?.ZSCORE_MIN || 2.0;

      if (z < -zMin && slopeVal > 0) {
        return buildSignal(s, 'CALL', 70 + Math.min(20, Math.abs(z) * 5),
          `Z-Score ${z.toFixed(2)} (oversold) + uptrend slope`, 'zscore_mean_reversion');
      }
      if (z > zMin && slopeVal < 0) {
        return buildSignal(s, 'PUT', 70 + Math.min(20, Math.abs(z) * 5),
          `Z-Score ${z.toFixed(2)} (overbought) + downtrend slope`, 'zscore_mean_reversion');
      }
      return null;
    }
  },
  {
    id: 'donchian_breakout',
    desc: 'Close > Donchian upper + ADX>25 → breakout; mirror below',
    check(s) {
      const dc = s.donchian;
      const currentPrice = s.price ?? s.lastClose;
      if (!dc || !s.adx || !currentPrice) return null;
      const adxThreshold = cfg.ADX_STRONG || 25;

      if (s.adx.adx > adxThreshold) {
        if (currentPrice > dc.upper) {
          return buildSignal(s, 'CALL', 75 + Math.min(15, s.adx.adx - adxThreshold),
            `Breakout above Donchian upper ${dc.upper.toFixed(6)} · ADX ${s.adx.adx.toFixed(1)}`, 'donchian_breakout');
        }
        if (currentPrice < dc.lower) {
          return buildSignal(s, 'PUT', 75 + Math.min(15, s.adx.adx - adxThreshold),
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
      if (s.rsi === null || s.rsi === undefined || s.emaFast === null || s.emaSlow === null) return null;
      const lowRsi = cfg.RSI_OVERSOLD || cfg.RULES?.RSI_LOW || 30;
      const highRsi = cfg.RSI_OVERBOUGHT || cfg.RULES?.RSI_HIGH || 70;

      if (s.rsi <= lowRsi && s.emaFast > s.emaSlow) {
        return buildSignal(s, 'CALL', 62 + (lowRsi - s.rsi),
          `RSI ${s.rsi.toFixed(1)} oversold · EMA Fast > EMA Slow`, 'rsi_extreme');
      }
      if (s.rsi >= highRsi && s.emaFast < s.emaSlow) {
        return buildSignal(s, 'PUT', 62 + (s.rsi - highRsi),
          `RSI ${s.rsi.toFixed(1)} overbought · EMA Fast < EMA Slow`, 'rsi_extreme');
      }
      return null;
    }
  },
  {
    id: 'macd_ema_follow',
    desc: 'Trend-follow: EMA cross + MACD histogram sign',
    check(s) {
      if (!s.macd || s.macd.histogram === undefined || s.emaFast === null || s.emaSlow === null) return null;
      if (s.emaFast > s.emaSlow && s.macd.histogram > 0) {
        return buildSignal(s, 'CALL', 60,
          `EMA Fast > EMA Slow · MACD hist +`, 'macd_ema_follow');
      }
      if (s.emaFast < s.emaSlow && s.macd.histogram < 0) {
        return buildSignal(s, 'PUT', 60,
          `EMA Fast < EMA Slow · MACD hist −`, 'macd_ema_follow');
      }
      return null;
    }
  }
];

/* ---------- ইভ্যালুয়েটর: সব রুল চালিয়ে সবচেয়ে শক্তিশালী সিগনাল ---------- */
function evaluate(symbolOrSnapshot, snapParam) {
  // QuantEngine থেকে evaluate(symbol, snapshot) অথবা evaluate(snapshot) উভয় স্টাইলেই কল হ্যান্ডেল করবে
  const snapshot = snapParam || symbolOrSnapshot;
  if (!snapshot || (snapshot.ready === false)) return null;

  let best = null;
  const minConfidenceThreshold = rt.getConfidence();

  for (const rule of RULES) {
    try {
      const r = rule.check(snapshot);
      if (r && r.confidence >= minConfidenceThreshold && (!best || r.confidence > best.confidence)) {
        best = r;
      }
    } catch (e) {
      console.error(`[rules] ${rule.id} error:`, e.message);
    }
  }

  return best;
}

module.exports = { evaluate, RULES };
