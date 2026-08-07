'use strict';
require('dotenv').config();

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
  TELEGRAM_ENABLED: bool('TELEGRAM_ENABLED', false),
  TELEGRAM_BOT_TOKEN: str('TELEGRAM_BOT_TOKEN', ''),
  TELEGRAM_CHAT_ID: str('TELEGRAM_CHAT_ID', ''),

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
  HEARTBEAT_ALERT_S: num('HEARTBEAT_ALERT_S', 180, 30, 86400)
};
// ---- Dashboard (Web UI) ----
  PORT: num('PORT', 10000, 1, 65535),
  DASHBOARD_ENABLED: bool('DASHBOARD_ENABLED', true),
  DASHBOARD_USER: str('DASHBOARD_USER', ''),
  DASHBOARD_PASS: str('DASHBOARD_PASS', ''),
  DASHBOARD_REFRESH_MS: num('DASHBOARD_REFRESH_MS', 2000, 500, 30000),

  // ---- Telegram 2-way bot ----
  TELEGRAM_POLL_TIMEOUT: num('TELEGRAM_POLL_TIMEOUT', 30, 5, 50),
  TELEGRAM_ALLOWED_CHAT_IDS: str('TELEGRAM_ALLOWED_CHAT_IDS', '')
module.exports = cfg;
