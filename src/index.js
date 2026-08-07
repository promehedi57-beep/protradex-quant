const http = require('http');
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ProTradeX Bot Running');
}).listen(PORT, () => console.log(`[server] Web server live on port ${PORT}`));

'use strict';
const cfg = require('./config');
const { SignalBus } = require('./signals');
const { QuantEngine } = require('./engine');
const { Metrics } = require('./metrics');
const { TelegramNotifier } = require('./telegram');
const { Executor } = require('./executor');

async function main() {
  const metrics = new Metrics();
  const bus = new SignalBus({ cooldownMs: cfg.SIGNAL_COOLDOWN_MS });
  const engine = new QuantEngine({ signalBus: bus, metrics });

  const telegram = new TelegramNotifier({ token: cfg.TELEGRAM_BOT_TOKEN, chatId: cfg.TELEGRAM_CHAT_ID, enabled: cfg.TELEGRAM_ENABLED });
  const executor = new Executor({ onExecuted: () => { metrics.signals++; } });
  await executor.start();

  bus.onSignal(sig => {
    metrics.signals++;
    telegram.notify(sig);
    const res = executor.execute(sig);
    if (!res.ok) console.warn('[signal] exec fail', sig.pair, res.error || '');
  });

  // হিটবিট ট্র্যাকিং
  let lastCandle = Date.now();
  engine.onCandle = () => { lastCandle = Date.now(); };

  // ফিড
  const feed = cfg.FEED;
  const feeds = [];
  if (feed === 'binance' || feed === 'all') {
    const { BinanceFeed } = require('./feeds/binance');
    const f = new BinanceFeed({ engine });
    await f.start();
    feeds.push(f);
  }
  if (feed === 'oanda' || feed === 'all') {
    const { OandaFeed } = require('./feeds/oanda');
    const f = new OandaFeed({ engine });
    await f.start();
    feeds.push(f);
  }

  // TradingView ওয়েবহুক
  if (cfg.WEBHOOK_ENABLED) {
    const { createWebhookServer } = require('./webhook-server');
    createWebhookServer({ engine }).listen(cfg.WEBHOOK_PORT, () =>
      console.log('[webhook] 🟢 listening :' + cfg.WEBHOOK_PORT));
  }

  // পিরিয়ডিক স্ট্যাটস
  setInterval(() => {
    console.log('[stats]', JSON.stringify(Object.assign(metrics.snapshot(), engine.snapshot())));
  }, cfg.STATS_INTERVAL_S * 1000).unref?.();

  // হিটবিট অ্যালার্ট — নিঃশব্দ ফেলিউর নেই
  setInterval(() => {
    const idle = Date.now() - lastCandle;
    if (idle > cfg.HEARTBEAT_ALERT_S * 1000) {
      console.error('[heartbeat] ⚠️ কোনো ডেটা আসছে না ' + Math.round(idle / 1000) + 's — ফিড চেক করুন');
      telegram.notify({
        pair: 'SYSTEM', direction: 'ALERT', confidence: 0, timeframe: '-', levels: {},
        reason: 'No market data for ' + Math.round(idle / 1000) + 's — feed down?'
      });
    }
  }, cfg.HEARTBEAT_ALERT_S * 1000).unref?.();

  console.log('🚀 ProTradeX Quant Engine v2 · FEED=' + feed +
              ' · EXECUTION=' + cfg.EXECUTION_ENABLED + ' · TELEGRAM=' + cfg.TELEGRAM_ENABLED);

  // গ্রেসফুল শাটডাউন
  let down = false;
  const shutdown = async sig => {
    if (down) return;
    down = true;
    console.log('\n[' + sig + '] শাটডাউন…');
    try { bus.stop(); } catch (e) { }
    for (const f of feeds) { try { f.stop(); } catch (e) { } }
    try { await executor.stop(); } catch (e) { }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// গ্লোবাল গার্ড — আনহ্যান্ডেলড প্রমিজ/এক্সেপশন লিক হবে না
process.on('unhandledRejection', reason => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', err => console.error('[uncaughtException]', err.message, err.stack));

main().catch(e => {
  console.error('[fatal]', e);
  process.exit(1);
});
