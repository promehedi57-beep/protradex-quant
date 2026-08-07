'use strict';
const cfg = require('./config');
const rt = require('./state');
const { SignalBus } = require('./signals');
const { QuantEngine } = require('./engine');
const { Metrics } = require('./metrics');
const { TelegramBot } = require('./telegram');
const { Executor } = require('./executor');
const { createDashboard } = require('./dashboard');

async function main() {
  const metrics = new Metrics();
  const bus = new SignalBus({ cooldownMs: cfg.SIGNAL_COOLDOWN_MS });
  const engine = new QuantEngine({ signalBus: bus, metrics });
  const feedsStatus = { binance: false, oanda: false };

  // হিটবিট ট্র্যাকিং + runtime state
  engine.onCandle = () => { rt.state.lastCandleAt = Date.now(); };

  const telegram = new TelegramBot({ metrics, engine });
  const executor = new Executor({ onExecuted: () => { /* ack থেকে signals কাউন্ট হবে নিচে */ } });
  await executor.start();

  // runtime toggle → executor sync (dashboard/Telegram থেকে)
  rt.onExecutionChange(v => executor.setEnabled(v));

  bus.onSignal(sig => {
    metrics.signals++;
    telegram.notify(sig);
    const res = executor.execute(sig);
    if (!res.ok && !res.dryRun) console.warn('[signal] exec fail', sig.pair, res.error || '');
  });

  // ফিড
  const feed = cfg.FEED;
  const feeds = [];
  if (feed === 'binance' || feed === 'all') {
    const { BinanceFeed } = require('./feeds/binance');
    const f = new BinanceFeed({ engine, statusCb: v => { feedsStatus.binance = v; } });
    await f.start();
    feeds.push(f);
  }
  if (feed === 'oanda' || feed === 'all') {
    const { OandaFeed } = require('./feeds/oanda');
    const f = new OandaFeed({ engine });
    await f.start();
    feeds.push(f);
  }

  // Web Dashboard — process.env.PORT || 10000 (Render কম্প্যাটিবল)
  if (cfg.DASHBOARD_ENABLED) {
    const app = createDashboard({ engine, metrics, feedsStatus });
    app.listen(cfg.PORT, () => console.log('[dashboard] 🟢 http://0.0.0.0:' + cfg.PORT + ' (Dashboard + Webhook + API)'));
  } else {
    console.log('[dashboard] DASHBOARD_ENABLED=false — HTTP সার্ভার বন্ধ');
  }

  // Telegram 2-way bot
  telegram.start();

  // পিরিয়ডিক স্ট্যাটস
  setInterval(() => {
    console.log('[stats]', JSON.stringify(Object.assign(metrics.snapshot(), engine.status())));
  }, cfg.STATS_INTERVAL_S * 1000).unref?.();

  // হিটবিট অ্যালার্ট — নিঃশব্দ ফেলিউর নেই
  setInterval(() => {
    const idle = Date.now() - rt.state.lastCandleAt;
    if (rt.state.lastCandleAt && idle > cfg.HEARTBEAT_ALERT_S * 1000) {
      console.error('[heartbeat] ⚠️ কোনো ডেটা আসছে না ' + Math.round(idle / 1000) + 's — ফিড চেক করুন');
      telegram.notify({ pair: 'SYSTEM', direction: 'ALERT', confidence: 0, timeframe: '-', levels: {}, reason: 'No market data for ' + Math.round(idle / 1000) + 's — feed down?' });
    }
  }, cfg.HEARTBEAT_ALERT_S * 1000).unref?.();

  console.log('🚀 ProTradeX Quant Engine v2.1 · FEED=' + feed +
              ' · EXECUTION=' + cfg.EXECUTION_ENABLED +
              ' · TELEGRAM=' + cfg.TELEGRAM_ENABLED +
              ' · DASHBOARD=:' + cfg.PORT);

  // গ্রেসফুল শাটডাউন
  let down = false;
  const shutdown = async sig => {
    if (down) return;
    down = true;
    console.log('\n[' + sig + '] শাটডাউন…');
    try { bus.stop(); } catch (e) { }
    try { telegram.stop(); } catch (e) { }
    for (const f of feeds) { try { f.stop(); } catch (e) { } }
    try { await executor.stop(); } catch (e) { }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', reason => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', err => console.error('[uncaughtException]', err.message, err.stack));

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
