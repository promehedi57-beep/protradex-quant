'use strict';

/* ProTradeX Quant Engine — Phase 4 bootstrap */
const cfg = require('./config');
const rt = require('./state');
const { QuantEngine } = require('./engine');
const { SignalBus } = require('./signals');
const { Metrics } = require('./metrics');
const { BinanceFeed } = require('./feeds/binance');
const { OTCSimFeed } = require('./feeds/otc-sim');
const { Executor } = require('./executor');
const { TelegramBot } = require('./telegram');
const { createDashboard } = require('./dashboard');

async function main() {
  console.log(`[qx] starting · node ${process.version} · env=${process.env.NODE_ENV || 'dev'}`);

  const signalBus = new SignalBus();
  const metrics = new Metrics();
  const engine = new QuantEngine({ signalBus });
  const executor = new Executor({ enabled: rt.getExecution() });

  /* wire execution + confidence + alerts runtime → executor/telegram */
  rt.onExecutionChange(v => executor.setEnabled(v));
  rt.onAlertsChange(() => {});                       // telegram subscribes itself
  rt.onConfidenceChange(() => {});

  /* signal → metrics + telegram + executor */
  signalBus.on('signal', async (sig) => {
    metrics.logSignal(sig);
    engine.signalsTotal++; if (executor.enabled) await executor.execute(sig);
    if (rt.getAlerts()) { try { await bot.notify(sig); } catch (e) { /* non-fatal */ } }
  });

  /* engine heartbeat (keep raising pair evaluation) */
  const hb = setInterval(() => engine.pump(), 1);

  /* feeds */
  engine.agg.bars;   // (touch)
  const onTick = (t) => engine.onTickFeed(t);
  const feeds = {
    binance: cfg.BINANCE_ENABLED ? new BinanceFeed({ onTick, onLivePrice: (s,p)=>engine.handleLivePrice(s,p) }).start() : null,
    oanda:   cfg.OANDA_ENABLED ? null : null,
    otc:     cfg.OTC_ENABLED ? new OTCSimFeed({ onTick }).start() : null,
  };
  const feedsStatus = () => ({
    binance: feeds.binance ? feeds.binance.isConnected() : false,
    oanda:   feeds.oanda ? feeds.oanda.connected : false,
    otc:     !!feeds.otc,
  });

  /* telegram (strict access) */
  const bot = new TelegramBot({ metrics, engine, rt });
  if (cfg.TELEGRAM_ENABLED) { await bot.start(); }
  rt.onAlertsChange(v => bot.setAlerts(v));          // single source of truth
  signalBus.publish.name;                            // no-op guard

  /* dashboard / API server on cfg.PORT */
  if (cfg.DASHBOARD_ENABLED) {
    const dash = createDashboard({ engine, metrics, feedsStatus, bot, rt });
    dash.listen(cfg.PORT, () => console.log(`[qx] dashboard http://0.0.0.0:${cfg.PORT}`));
  } else {
    console.warn('[qx] dashboard disabled');
  }

  /* stats interval */
  setInterval(() => metrics.snapshot(engine.status()), 30_000);

  /* graceful shutdown */
  let closing = false;
  const shutdown = async (code) => {
    if (closing) return; closing = true;
    console.log('[qx] shutting down…');
    clearInterval(hb);
    if (feeds.otc) feeds.otc.stop();
    if (bot) await bot.stop();
    executor.stop && executor.stop();
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('unhandledRejection', (r) => console.error('[qx] unhandledRejection', r));
  process.on('uncaughtException',  (e) => console.error('[qx] uncaughtException', e && e.stack));
}

main().catch(e => { console.error('[qx] fatal', e && e.stack); process.exit(1); });
