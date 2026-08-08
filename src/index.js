'use strict';
/* ProTradeX · Phase 5 bootstrap — critical path AI-free, AI layer isolated. */
const cfg = require('./config');
const rt = require('./state');
const { SignalBus } = require('./signals');
const { Metrics } = require('./metrics');
const { Aggregator } = require('./aggregator');
const { TFEngine } = require('./tf');
const { IndicatorHub } = require('./indicators');
const { computeConfidence } = require('./confidence');
const { BinanceFeed, TwelveDataFeed, OTCSimFeed } = require('./feed');
const { Executor } = require('./executor');
const { TelegramBot } = require('./telegram');
const { AIVision } = require('./aiVision');
const { createDashboard } = require('./dashboard');
const { Engine } = require('./engine');

async function main() {
  console.log(`[qx] starting · node ${process.version} · ${cfg.PORT}`);
  
  const signalBus = new SignalBus();
  const metrics = new Metrics();
  
  // ১. রেফারেন্স সমস্যা মেটাতে আগেই engine ভেরিয়েবল ডিক্লেয়ার করা হয়েছে
  let engine;

  // ২. Aggregator & TFEngine তৈরি
  const agg = new Aggregator({ onBar: (b) => engine && engine.on1mBar(b) });
  const tf = new TFEngine({ 
    onCandle: (s, t, c) => engine && engine.onTFCandle(s, t, c), 
    tfs: cfg.TIMEFRAMES, 
    keep: cfg.TF_KEEP_CANDLES 
  });
  
  const hub = new IndicatorHub();
  
  // ৩. এবার Engine ইনস্ট্যান্স নিরাপদে তৈরি হবে
  engine = new Engine({ signalBus, agg, tf, hub });

  const executor = new Executor({ enabled: rt.getExecution() });
  rt.onExecutionChange(v => executor.setEnabled(v));

  /* Critical signal path — numeric only, synchronous publish. */
  signalBus.onSignal(async (sig) => {
    metrics.logSignal(sig);
    if (rt.getAlerts()) { try { await bot.notify(sig); } catch (e) {} }   // alerts optional
    if (executor.enabled) { try { await executor.execute(sig); } catch (e) {} }
  });

  /* feeds → unified onTick into aggregator */
  const onTick = (t) => agg.push(t);
  const onLive = (s, p) => engine.onLivePrice(s, p);
  const onClosed = (s, bar) => agg.push({ symbol:s, price:bar.c, ts:bar.openAt + 60000 });
  const feeds = {
    binance: cfg.BINANCE_ENABLED ? new BinanceFeed({ onTick, onLivePrice:onLive, onClosedCandle:onClosed, statusCb:()=>{} }).start() : null,
    fx:      cfg.TWELVEDATA_ENABLED ? new TwelveDataFeed({ onTick, onLivePrice:onLive }).start() : null,
    otc:     cfg.OTC_ENABLED ? new OTCSimFeed({ onTick }).start() : null,
  };
  const feedsStatus = () => ({ binance: feeds.binance?.isConnected() ?? false, oanda: feeds.fx?.isConnected() ?? false, otc: feeds.otc?.isConnected() ?? false });

  /* Telegram (strict access) */
  const bot = new TelegramBot({ metrics, engine, rt });
  if (cfg.TELEGRAM_ENABLED) await bot.start();
  rt.onAlertsChange(v => bot.setAlerts(v));

  /* Isolated AI layer — never wired into signal path */
  const ai = new AIVision();

  const hb = setInterval(() => engine.pump(), 1); if (hb.unref) hb.unref();

  if (cfg.DASHBOARD_ENABLED) {
    const dash = createDashboard({ engine, ai, feedsStatus, rt, telegram: bot });
    dash.listen(cfg.PORT, () => console.log(`[qx] dashboard http://0.0.0.0:${cfg.PORT}`));
  }

  setInterval(() => metrics.snapshot(engine.status()), 30000);

  let closing = false;
  const shutdown = async (code) => {
    if (closing) return; closing = true; console.log('[qx] shutdown');
    clearInterval(hb); feeds.binance?.stop(); feeds.fx?.stop(); feeds.otc?.stop();
    if (bot) await bot.stop(); executor.stop?.(); process.exit(code);
  };
  process.on('SIGINT', () => shutdown(0)); process.on('SIGTERM', () => shutdown(0));
  process.on('unhandledRejection', r => console.error('[qx] unhandledRejection', r));
  process.on('uncaughtException', e => console.error('[qx] uncaughtException', e?.stack));
}

main().catch(e => { console.error('[qx] fatal', e?.stack); process.exit(1); });
