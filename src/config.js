'use strict';
/* ProTradeX · Phase 5 · consolidated runtime config */
const b  = (v, d) => (v === undefined || v === '' ? d : v);
const nb = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const splitList = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);

const cfg = {
  /* HTTP */
  PORT: nb(process.env.PORT, 10000),
  DASHBOARD_ENABLED: b(process.env.DASHBOARD_ENABLED, 'true') !== 'false',
  DASHBOARD_USER: b(process.env.DASHBOARD_USER, ''),
  DASHBOARD_PASS: b(process.env.DASHBOARD_PASS, ''),
  DASHBOARD_REFRESH_MS: nb(process.env.DASHBOARD_REFRESH_MS, 2000),
  PAIR_LIMIT: nb(process.env.PAIR_LIMIT, 24),

  /* Engine */
  ENGINE_BUDGET_MS: nb(process.env.ENGINE_BUDGET_MS, 50),
  MIN_INTERVAL_MS: nb(process.env.MIN_INTERVAL_MS, 60000),
  SIGNAL_COOLDOWN_MS: nb(process.env.SIGNAL_COOLDOWN_MS, 300000),
  ACTIVE_TIMEFRAME: nb(process.env.ACTIVE_TIMEFRAME, 15),
  TIMEFRAMES: splitList(process.env.TIMEFRAMES || '1,5,10,15').map(nb).filter(n => n >= 1) || [15],
  TF_KEEP_CANDLES: nb(process.env.TF_KEEP_CANDLES, 260),

  /* Indicators / Strategy (mutable via UI — Strategy panel) */
  RULES: {
    RSI_LOW: nb(process.env.RSI_LOW, 30),
    RSI_HIGH: nb(process.env.RSI_HIGH, 70),
    RSIPERIOD: nb(process.env.RSIPERIOD, 14),
    ZPERIOD: nb(process.env.ZPERIOD, 50),
    ZSCORE_MIN: nb(process.env.ZSCORE_MIN, 2.0),
    ADX_MIN: nb(process.env.ADX_MIN, 25),
    ADXPERIOD: nb(process.env.ADXPERIOD, 14),
    DC_PERIOD: nb(process.env.DC_PERIOD, 20),
    EMA_FAST: nb(process.env.EMA_FAST, 9),
    EMA_SLOW: nb(process.env.EMA_SLOW, 21),
    MACD_FAST: nb(process.env.MACD_FAST, 12),
    MACD_SLOW: nb(process.env.MACD_SLOW, 26),
    MACD_SIGNAL: nb(process.env.MACD_SIGNAL, 9),
    SR_BREAKOUT_PCT: nb(process.env.SR_BREAKOUT_PCT, 0.15),
    SR_LOOKBACK: nb(process.env.SR_LOOKBACK, 48),
  },

  /* Confidence weights */
  CONF_W_RSI: nb(process.env.CONF_W_RSI, 0.25),
  CONF_W_ZSCORE: nb(process.env.CONF_W_ZSCORE, 0.25),
  CONF_W_SR: nb(process.env.CONF_W_SR, 0.25),
  CONF_W_TF: nb(process.env.CONF_W_TF, 0.25),

  /* Execution */
  EXECUTION_ENABLED: b(process.env.EXECUTION_ENABLED, 'false') === 'true',
  EXTENSION_WS_PORT: nb(process.env.EXTENSION_WS_PORT, 8787),

  /* Feeds */
  BINANCE_ENABLED: b(process.env.BINANCE_ENABLED, 'true') !== 'false',
  BINANCE_WS_URL: b(process.env.BINANCE_WS_URL, 'wss://stream.binance.com:9443/ws'),
  BINANCE_SYMBOLS: splitList(process.env.BINANCE_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,DOGEUSDT,AVAXUSDT,LINKUSDT,DOTUSDT,LTCUSDT,UNIUSDT,ATOMUSDT,NEARUSDT,SUIUSDT'),
  TWELVEDATA_ENABLED: b(process.env.TWELVEDATA_ENABLED, 'true') !== 'false',
  TWELVEDATA_KEY: b(process.env.TWELVEDATA_KEY, ''),
  TWELVEDATA_SYMBOLS: splitList(process.env.TWELVEDATA_SYMBOLS || 'EUR/USD,GBP/USD,USD/JPY,AUD/USD,XAU/USD'),

  /* OTC simulated feed (24/7) */
  OTC_ENABLED: b(process.env.OTC_ENABLED, 'true') !== 'false',
  OTC_TICK_MS: nb(process.env.OTC_TICK_MS, 1000),
  OTC_SYMBOLS: splitList(process.env.OTC_SYMBOLS || 'EURUSD_otc,GBPUSD_otc,USDJPY_otc,AUDUSD_otc,XAUUSD_otc,BTCUSD_otc,ETHUSD_otc,SOLUSD_otc'),

  /* Gemini — dynamic key managed via UI modal (persisted to memory + optional env). */
  GEMINI_ENABLED: b(process.env.GEMINI_ENABLED, 'true') !== 'false',
  GEMINI_API_KEY: b(process.env.GEMINI_API_KEY, ''),
  GEMINI_MODEL: b(process.env.GEMINI_MODEL, 'gemini-2.0-flash'),
  GEMINI_TIMEOUT_MS: nb(process.env.GEMINI_TIMEOUT_MS, 8000),
  GEMINI_MAX_TOKENS: nb(process.env.GEMINI_MAX_TOKENS, 512),
  GEMINI_DATA_CANDLES: nb(process.env.GEMINI_DATA_CANDLES, 50),

  /* Telegram — STRICT access */
  TELEGRAM_ENABLED: b(process.env.TELEGRAM_ENABLED, 'true') !== 'false',
  TELEGRAM_BOT_TOKEN: b(process.env.TELEGRAM_BOT_TOKEN, ''),
  TELEGRAM_POLL_TIMEOUT: nb(process.env.TELEGRAM_POLL_TIMEOUT, 30),
  TELEGRAM_ALERTS_ENABLED: b(process.env.TELEGRAM_ALERTS_ENABLED, 'true') !== 'false',
  TELEGRAM_ALLOWED_CHAT_IDS: splitList(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
  TELEGRAM_ADMIN_IDS: splitList(process.env.TELEGRAM_ADMIN_IDS),
  TELEGRAM_BROADCAST_TARGETS: splitList(process.env.TELEGRAM_BROADCAST_TARGETS),

  /* Quotex / Pocket Option browser automation */
  BROKER: {
    quotex: {
      enabled: b(process.env.QUOTEX_ENABLED, 'false') === 'true',
      assetInput: b(process.env.QUOTEX_ASSET_INPUT, 'input[type="search"]'),
      assetItem: b(process.env.QUOTEX_ASSET_ITEM, 'div[class*="asset"]'),
      callBtn: b(process.env.QUOTEX_CALL_BTN, 'button[class*="call"]'),
      putBtn: b(process.env.QUOTEX_PUT_BTN, 'button[class*="put"]'),
      symbolMap: (() => { try { return process.env.QUOTEX_SYMBOL_MAP ? JSON.parse(process.env.QUOTEX_SYMBOL_MAP) : {}; } catch { return {}; } })(),
    },
    pocketOption: {
      enabled: b(process.env.PO_ENABLED, 'false') === 'true',
      symbolMap: (() => { try { return process.env.PO_SYMBOL_MAP ? JSON.parse(process.env.PO_SYMBOL_MAP) : {}; } catch { return {}; } })(),
    },
  },

  /* Risk */
  RISK_PERCENT: nb(process.env.RISK_PERCENT, 0.75),
  MAX_DRAWDOWN: nb(process.env.MAX_DRAWDOWN, 15),
  KILL_SWITCH_ARMED: b(process.env.KILL_SWITCH_ARMED, 'true') !== 'false',
};
module.exports = cfg;
