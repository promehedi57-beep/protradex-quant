'use strict';

/* ProTradeX · Phase 5 bootstrap — APEX//QUANT terminal wiring */
const cfg = require('./config');
const rt = require('./state');
const { SignalBus } = require('./signals');
const { Metrics } = require('./metrics');
const { Engine } = require('./engine');
const { BinanceFeed, TwelveDataFeed, OTCSimFeed } = require('./feed');
const { Executor } = require('./executor');
const { TelegramBot } = require('./telegram');
const { AIVision } = require('./aiVision');
const { createDashboard } = require('./dashboard');
const { attachWs } = require('./ws');

async function main() {
  console.log(`[qx] starting · node ${process.version} · port ${cfg.PORT}`);

  const signalBus = new SignalBus();
  const metrics = new Metrics();
  const engine = new Engine({ signalBus });
  const executor = new Executor({ enabled: rt.getExecution() });
  rt.onExecutionChange(v => executor.setEnabled(v));

  const bot = new TelegramBot({ metrics, engine, rt });

  /* critical signal path — numeric, guarded, never throws */
  signalBus.onSignal(async (sig) => {
    try { metrics.logSignal(sig); } catch (e) {}
    if (rt.getAlerts()) { try { await bot.notify(sig); } catch (e) {} }
    if (executor.enabled) { try { await executor.execute(sig); } catch (e) {} }
  });

  /* feeds → unified tick into engine aggregator */
  const onTick = (t) => engine.onTickFeed(t);
  const feeds = {
    binance: cfg.BINANCE_ENABLED
      ? new BinanceFeed({ onTick, onLivePrice: (s, p) => engine.onLivePrice(s, p),
          onClosedCandle: (s, bar) => engine.onClosedCandle && engine.onClosedCandle(s, bar),
          statusCb: () => {} }).start()
      : null,
    fx: cfg.TWELVEDATA_ENABLED
      ? new TwelveDataFeed({ onTick, onLivePrice: (s, p) => engine.onLivePrice(s, p) }).start()
      : null,
    otc: cfg.OTC_ENABLED
      ? new OTCSimFeed({ onTick }).start()
      : null,
  };
  const feedsStatus = () => ({
    binance: feeds.binance ? feeds.binance.isConnected() : false,
    oanda: feeds.fx ? feeds.fx.isConnected() : false,
    otc: feeds.otc ? feeds.otc.isConnected() : false,
  });

  if (cfg.TELEGRAM_ENABLED) await bot.start();
  rt.onAlertsChange(v => bot.setAlerts(v));

  /* isolated AI layer — never wired into the signal path */
  const ai = new AIVision();

  const hb = setInterval(() => { try { engine.pump && engine.pump(); } catch (e) {} }, 1);
  if (hb.unref) hb.unref();

  if (cfg.DASHBOARD_ENABLED) {
    const dash = createDashboard({ engine, ai, feedsStatus, rt, telegram: bot, metrics });
    const server = dash.listen(cfg.PORT, () =>
      console.log(`[qx] dashboard http://0.0.0.0:${cfg.PORT} (ws:/ws)`));
    const wsServer = attachWs(server, { engine, rt, telegram: bot, metrics, feedsStatus });
    global.__qxWs = wsServer;
  } else {
    console.warn('[qx] dashboard disabled');
  }

  setInterval(() => { try { metrics.snapshot && metrics.snapshot(engine.status()); } catch (e) {} }, 30000);

  let closing = false;
  const shutdown = async (code) => {
    if (closing) return;
    closing = true;
    console.log('[qx] shutdown');
    clearInterval(hb);
    feeds.binance && feeds.binance.stop && feeds.binance.stop();
    feeds.fx && feeds.fx.stop && feeds.fx.stop();
    feeds.otc && feeds.otc.stop && feeds.otc.stop();
    global.__qxWs && global.__qxWs.close();
    if (bot) await bot.stop();
    if (executor.stop) executor.stop();
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('unhandledRejection', r => console.error('[qx] unhandledRejection', r));
  process.on('uncaughtException', e => console.error('[qx] uncaughtException', e && e.stack));
}

main().catch(e => { console.error('[qx] fatal', e && e.stack); process.exit(1); });
