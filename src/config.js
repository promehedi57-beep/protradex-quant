'use strict';
require('dotenv').config();
const b  = (v, d) => (v === undefined || v === '' ? d : v);
const nb = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const num = (k, def, min = -Infinity, max = Infinity) => {
  const raw = process.env[k];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) { console.warn(`[config] ${k} invalid, using ${def}`); return def; }
  return Math.min(max, Math.max(min, v));
};
const str = (k, def) => { const v = process.env[k]; return v === undefined || v === '' ? def : String(v).trim(); };
const bool = (k, def) => {
  const raw = String(process.env[k] ?? '').toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return def;
};
let symbolMap = {};
try { const raw = str('QUOTEX_SYMBOL_MAP', ''); if (raw) symbolMap = JSON.parse(raw); } catch (e) { console.warn('[config] QUOTEX_SYMBOL_MAP invalid JSON'); }

const cfg = {
  // feed
  FEED: str('FEED', 'binance'),
  BINANCE_REST_URL: str('BINANCE_REST_URL', 'https://api.binance.com'),
  BINANCE_WS_URL: str('BINANCE_WS_URL', 'wss://stream.binance.com:9443'),
  QUOTE_ASSET: str('QUOTE_ASSET', 'USDT'),
  MIN_24H_QUOTE_VOLUME: num('MIN_24H_QUOTE_VOLUME', 10_000_000, 0),
  MAX_PAIRS: num('MAX_PAIRS', 200, 1, 1000),
  TIMEFRAME: str('TIMEFRAME', '1m'),
  BUFFER_CANDLES: num('BUFFER_CANDLES', 300, 60, 1440),
  MIN_CANDLES: num('MIN_CANDLES', 60, 30, 500),
  PAIR_REFRESH_HOURS: num('PAIR_REFRESH_HOURS', 12, 0, 168),

  // session
  FOREX_SESSION_ENABLED: bool('FOREX_SESSION_ENABLED', true),
  OTC_BLACKOUT: str('OTC_BLACKOUT', ''),

  // rules
  RSI_PERIOD: num('RSI_PERIOD', 14, 2, 100),
  RSI_OVERSOLD: num('RSI_OVERSOLD', 30, 5, 45),
  RSI_OVERBOUGHT: num('RSI_OVERBOUGHT', 70, 55, 95),
  ZSCORE_PERIOD: num('ZSCORE_PERIOD', 20, 5, 200),
  ZSCORE_ENTRY: num('ZSCORE_ENTRY', 2.0, 0.5, 5),
  LINREG_PERIOD: num('LINREG_PERIOD', 14, 3, 100),
  DONCHIAN_PERIOD: num('DONCHIAN_PERIOD', 20, 5, 200),
  ADX_PERIOD: num('ADX_PERIOD', 14, 2, 100),
  ADX_STRONG: num('ADX_STRONG', 25, 5, 60),
  ATR_PERIOD: num('ATR_PERIOD', 14, 2, 100),
  SL_ATR: num('SL_ATR', 1.2, 0.1, 10),
  TP_ATR: num('TP_ATR', 1.8, 0.1, 10),
  EMA_FAST: num('EMA_FAST', 20, 2, 100),
  EMA_SLOW: num('EMA_SLOW', 50, 3, 200),
  MACD_FAST: num('MACD_FAST', 12, 2, 50),
  MACD_SLOW: num('MACD_SLOW', 26, 3, 100),
  MACD_SIGNAL: num('MACD_SIGNAL', 9, 2, 50),

  // engine
  ENGINE_BUDGET_MS: num('ENGINE_BUDGET_MS', 50, 10, 500),
  MIN_CONFIDENCE: num('MIN_CONFIDENCE', 65, 0, 97),
  SIGNAL_COOLDOWN_MS: num('SIGNAL_COOLDOWN_MS', 300000, 10000, 86400000),
  MIN_INTERVAL_MS: num('MIN_INTERVAL_MS', 60000, 5000, 3600000),

  // telegram
  TELEGRAM_BOT_TOKEN: str('TELEGRAM_BOT_TOKEN', ''),
  TELEGRAM_CHAT_ID: str('TELEGRAM_CHAT_ID', ''),
  TELEGRAM_ENABLED: bool('TELEGRAM_ENABLED', Boolean(str('TELEGRAM_BOT_TOKEN', '') && str('TELEGRAM_CHAT_ID', ''))),

  // execution
  EXECUTION_ENABLED: bool('EXECUTION_ENABLED', false),
  EXECUTOR: str('EXECUTOR', 'extension'),
  EXTENSION_WS_PORT: num('EXTENSION_WS_PORT', 8787, 1024, 65535),
  QUOTEX_URL: str('QUOTEX_URL', 'https://quotex.io/'),
  QUOTEX_PROFILE_DIR: str('QUOTEX_PROFILE_DIR', './.quotex-profile'),
  QUOTEX_ASSET_INPUT: str('QUOTEX_ASSET_INPUT', 'input[placeholder*="Search"], input[placeholder*="Поиск"]'),
  QUOTEX_ASSET_ITEM: str('QUOTEX_ASSET_ITEM', '.asset-item, .search-result__item'),
  QUOTEX_CALL_BTN: str('QUOTEX_CALL_BTN', '[data-testid="call-button"], button[class*="call"]'),
  QUOTEX_PUT_BTN: str('QUOTEX_PUT_BTN', '[data-testid="put-button"], button[class*="put"]'),
  QUOTEX_SYMBOL_MAP: symbolMap,

  // webhook
  WEBHOOK_ENABLED: bool('WEBHOOK_ENABLED', false),
  WEBHOOK_PORT: num('WEBHOOK_PORT', 8788, 1024, 65535),
  WEBHOOK_SECRET: str('WEBHOOK_SECRET', ''),

  // oanda
  OANDA_API_KEY: str('OANDA_API_KEY', ''),
  OANDA_ACCOUNT_ID: str('OANDA_ACCOUNT_ID', ''),
  OANDA_ENV: str('OANDA_ENV', 'practice'),
  OANDA_INSTRUMENTS: str('OANDA_INSTRUMENTS', 'EUR_USD,GBP_USD,USD_JPY,XAU_USD').split(',').filter(Boolean),

  // ops
  STATS_INTERVAL_S: num('STATS_INTERVAL_S', 30, 5, 3600),
  HEARTBEAT_ALERT_S: num('HEARTBEAT_ALERT_S', 180, 30, 86400),

  // ---- Dashboard (Web UI) ----
  PORT: num('PORT', 10000, 1, 65535),
  DASHBOARD_ENABLED: bool('DASHBOARD_ENABLED', true),
  DASHBOARD_USER: str('DASHBOARD_USER', ''),
  DASHBOARD_PASS: str('DASHBOARD_PASS', ''),
  DASHBOARD_REFRESH_MS: num('DASHBOARD_REFRESH_MS', 2000, 500, 30000),

  // ---- Telegram 2-way bot ----
  TELEGRAM_POLL_TIMEOUT: num('TELEGRAM_POLL_TIMEOUT', 30, 5, 50),
  TELEGRAM_ALLOWED_CHAT_IDS: str('TELEGRAM_ALLOWED_CHAT_IDS', '')
};
/* ═══════════════ PHASE 4 · UPGRADE BLOCK (idempotent — safe to re-insert) ═══════════════ */

/* HTTP server — Render binds only PORT */
cfg.PORT                 = nb(process.env.PORT, 10000);
cfg.DASHBOARD_ENABLED    = b(process.env.DASHBOARD_ENABLED, 'true') !== 'false';
cfg.DASHBOARD_USER       = b(process.env.DASHBOARD_USER, '');
cfg.DASHBOARD_PASS       = b(process.env.DASHBOARD_PASS, '');
cfg.DASHBOARD_REFRESH_MS = nb(process.env.DASHBOARD_REFRESH_MS, 2000);
cfg.PAIR_LIMIT           = nb(process.env.PAIR_LIMIT, 24);   /* matches new HTML universe size */

/* Multi-timeframe analysis — minutes per candle */
cfg.TIMEFRAMES         = (process.env.TIMEFRAMES || '5,10,15,20')
                           .split(',').map(s => Math.max(1, nb(s.trim(), 15)));
cfg.ACTIVE_TIMEFRAME   = nb(process.env.ACTIVE_TIMEFRAME, 15); /* primary TF → rules fire on this */
cfg.TF_KEEP_CANDLES    = nb(process.env.TF_KEEP_CANDLES, 260);
cfg.BAR_INTERVAL       = '1m';   /* base bar folded from raw ticks */

/* Support & Resistance */
cfg.SR_ENABLED         = b(process.env.SR_ENABLED, 'true') !== 'false';
cfg.SR_LOOKBACK        = nb(process.env.SR_LOOKBACK, 48);      /* swing window per side */
cfg.SR_BREAKOUT_PCT    = nb(process.env.SR_BREAKOUT_PCT, 0.15);/* % past level = confirmed breakout */

/* Confidence composer weights (must sum ≈ 1.0) */
cfg.CONF_W_RSI    = nb(process.env.CONF_W_RSI, 0.25);
cfg.CONF_W_ZSCORE = nb(process.env.CONF_W_ZSCORE, 0.25);
cfg.CONF_W_SR     = nb(process.env.CONF_W_SR, 0.25);
cfg.CONF_W_TF     = nb(process.env.CONF_W_TF, 0.25);

/* OTC simulated feed — 24/7, works on weekends & holidays */
cfg.OTC_ENABLED   = b(process.env.OTC_ENABLED, 'true') !== 'false';
cfg.OTC_TICK_MS   = nb(process.env.OTC_TICK_MS, 1000);
cfg.OTC_SYMBOLS   = (process.env.OTC_SYMBOLS ||
  'EURUSD_otc,GBPUSD_otc,USDJPY_otc,AUDUSD_otc,XAUUSD_otc,BTCUSD_otc,ETHUSD_otc,SOLUSD_otc')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

/* Engine budget / batching (keep evaluation < 50ms per batch) */
cfg.ENGINE_BUDGET_MS = nb(process.env.ENGINE_BUDGET_MS, 50);

/* SignalBus safety */
cfg.SIGNAL_COOLDOWN_MS = nb(process.env.SIGNAL_COOLDOWN_MS, 300000);
cfg.MIN_INTERVAL_MS    = nb(process.env.MIN_INTERVAL_MS, 60000);

/* Execution — default DRY-RUN */
cfg.EXECUTION_ENABLED  = b(process.env.EXECUTION_ENABLED, 'false') === 'true';
cfg.EXTENSION_WS_PORT  = nb(process.env.EXTENSION_WS_PORT, 8787);

/* Quotex browser automation selectors */
cfg.QUOTEX_ASSET_INPUT = b(process.env.QUOTEX_ASSET_INPUT, 'input[type="search"]');
cfg.QUOTEX_ASSET_ITEM  = b(process.env.QUOTEX_ASSET_ITEM, 'div[class*="asset"]');
cfg.QUOTEX_CALL_BTN    = b(process.env.QUOTEX_CALL_BTN, 'button[class*="call"]');
cfg.QUOTEX_PUT_BTN     = b(process.env.QUOTEX_PUT_BTN, 'button[class*="put"]');
cfg.QUOTEX_SYMBOL_MAP  = (() => {
  try { return process.env.QUOTEX_SYMBOL_MAP ? JSON.parse(process.env.QUOTEX_SYMBOL_MAP) : {}; }
  catch (e) { return {}; }
})();

/* ═══ Telegram — STRICT access control ═══ */
cfg.TELEGRAM_ENABLED    = b(process.env.TELEGRAM_ENABLED, 'true') !== 'false';
cfg.TELEGRAM_BOT_TOKEN  = b(process.env.TELEGRAM_BOT_TOKEN, '');
cfg.TELEGRAM_POLL_TIMEOUT = nb(process.env.TELEGRAM_POLL_TIMEOUT, 30);
/* Master switch: OFF → bot still answers /status, but NO signal notifications go out.
   Dashboard signals keep running regardless. */
cfg.TELEGRAM_ALERTS_ENABLED = b(process.env.TELEGRAM_ALERTS_ENABLED, 'true') !== 'false';
/* STRICT: empty list ⇒ every chat is refused (secure-by-default). Only these chats may issue commands. */
cfg.TELEGRAM_ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
/* Admin IDs — only they can toggle alerts + broadcast. Subset of ALLOWED. */
cfg.TELEGRAM_ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
/* Where notifications + /broadcast messages are delivered (group/channel/admin IDs).
   Defaults to ALLOWED when empty. */
cfg.TELEGRAM_BROADCAST_TARGETS = (process.env.TELEGRAM_BROADCAST_TARGETS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

/* Feeds */
cfg.BINANCE_ENABLED = b(process.env.BINANCE_ENABLED, 'true') !== 'false';
cfg.BINANCE_WS_URL  = b(process.env.BINANCE_WS_URL, 'wss://stream.binance.com:9443/ws');
cfg.BINANCE_SYMBOLS = (process.env.BINANCE_SYMBOLS ||
  'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,DOGEUSDT,AVAXUSDT,LINKUSDT,DOTUSDT,' +
  'TONUSDT,NEARUSDT,LTCUSDT,UNIUSDT,ATOMUSDT,APTUSDT,ARBUSDT,OPUSDT,INJUSDT,SUIUSDT,' +
  'TIAUSDT,PEPEUSDT,WIFUSDT,FETUSDT')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

cfg.OANDA_ENABLED     = b(process.env.OANDA_ENABLED, 'false') !== 'false';
cfg.OANDA_ENV         = b(process.env.OANDA_ENV, 'practice'); /* practice | live */
cfg.OANDA_TOKEN       = b(process.env.OANDA_TOKEN, '');
cfg.OANDA_ACCOUNT_ID  = b(process.env.OANDA_ACCOUNT_ID, '');
cfg.OANDA_SYMBOLS     = (process.env.OANDA_SYMBOLS || 'EUR_USD,GBP_USD,USD_JPY,AUD_USD,XAU_USD')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

/* Risk management */
cfg.RISK_PERCENT      = nb(process.env.RISK_PERCENT, 0.75);  /* % of equity per trade */
cfg.MAX_DRAWDOWN      = nb(process.env.MAX_DRAWDOWN, 15);     /* % → kill switch trips */
cfg.KILL_SWITCH_ARMED = b(process.env.KILL_SWITCH_ARMED, 'true') !== 'false';

/* Rule thresholds (your exact math plugs into src/rules.js) */
cfg.RULES = Object.assign({}, cfg.RULES, {
  ZSCORE_MIN:   nb(process.env.ZSCORE_MIN, 2.0),
  ADX_MIN:      nb(process.env.ADX_MIN, 25),
  RSI_LOW:      nb(process.env.RSI_LOW, 30),
  RSI_HIGH:     nb(process.env.RSI_HIGH, 70),
  DC_PERIOD:    nb(process.env.DC_PERIOD, 20),
  EMA_FAST:     nb(process.env.EMA_FAST, 9),
  EMA_SLOW:     nb(process.env.EMA_SLOW, 21),
  MACD_FAST:    nb(process.env.MACD_FAST, 12),
  MACD_SLOW:    nb(process.env.MACD_SLOW, 26),
  MACD_SIGNAL:  nb(process.env.MACD_SIGNAL, 9),
  RSIPERIOD:    nb(process.env.RSIPERIOD, 14),
  ADXPERIOD:    nb(process.env.ADXPERIOD, 14),
  ZPERIOD:      nb(process.env.ZPERIOD, 50)
});

/* Market hours (OANDA/forex — crypto + OTC ignore this) */
cfg.MARKET_OPEN_UTC    = nb(process.env.MARKET_OPEN_UTC, 0);
cfg.MARKET_CLOSE_UTC   = nb(process.env.MARKET_CLOSE_UTC, 24);
cfg.MARKET_TIMEZONE    = b(process.env.MARKET_TIMEZONE, 'UTC');
/* ═══════════════ END PHASE 4 BLOCK ═══════════════ */
module.exports = cfg;
