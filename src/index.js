'use strict';

/* ProTradeX · Phase 5 bootstrap — APEX//QUANT terminal wiring */
const cfg = require('./config');
const rt = require('./state');
const { SignalBus } = require('./signals');
const { Metrics } = require('./metrics');
const { Engine } = require('./engine');
const { BinanceFeed, TwelveDataFeed, OTCSimFeed } = require('./feed');
const { Executor } = require('./executor');
const { createTelegram } = require('./telegram'); // ফিক্সড টেলিগ্রাম মডিউল
const { AIVision } = require('./aiVision');
const { SignalStore } = require('./signalStore'); // সিগন্যাল সিঙ্গেল সোর্স অব ট্রুথ
const { boot } = require('./dashboard');         // ফিক্সড ড্যাশবোর্ড ও API স্ট্যাটাস
const { attachWS } = require('./ws');            // ফিক্সড রিয়েল-টাইম WebSocket

async function main() {
  console.log(`[qx] starting · node ${process.version} · port ${cfg.PORT}`);

  const signalBus = new SignalBus();
  const metrics = new Metrics();
  const engine = new Engine({ signalBus });
  const executor = new Executor({ enabled: rt.getExecution() });
  rt.onExecutionChange(v => executor.setEnabled(v));

  // ফিক্সড টেলিগ্রাম ইনিশিয়ালাইজেশন
  const bot = createTelegram({
    token: cfg.TELEGRAM_BOT_TOKEN,
    allowed: cfg.TELEGRAM_ALLOWED_CHAT_IDS,
    admins: cfg.TELEGRAM_ADMIN_IDS,
    targets: cfg.TELEGRAM_BROADCAST_TARGETS,
    alertsEnabled: cfg.TELEGRAM_ALERTS_ENABLED ?? true
  });

  // সেন্ট্রাল সিগন্যাল স্টোর (যা ড্যাশবোর্ড ও ডব্লিউএস-এ ডেটা পাঠাবে)
  const signalStore = new SignalStore();

  /* critical signal path — numeric, guarded, never throws */
  signalBus.onSignal(async (sig) => {
    try { metrics.logSignal(sig); } catch (e) {}
    
    // সিগন্যাল স্টোরে সেভ করা (যাতে সাথে সাথে UI-তে শো করে)
    try { signalStore.upsert(sig); } catch (e) {}

    // টেলিগ্রাম অ্যালার্ট
    if (rt.getAlerts() && bot.enabled) { 
      try { await bot.shareSignal(sig); } catch (e) {} 
    }
    
    if (executor.enabled) { 
      try { await executor.execute(sig); } catch (e) {} 
    }
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

  // টেলিগ্রাম লং পোলিং স্টার্ট (যদি টোকেন থাকে)
  if (cfg.TELEGRAM_ENABLED && bot.enabled) {
    bot.startPolling();
  }
  rt.onAlertsChange(v => {
    // runtime alerts sync
  });

  /* isolated AI layer — never wired into the signal path */
  const ai = new AIVision();

  const hb = setInterval(() => { try { engine.pump && engine.pump(); } catch (e) {} }, 1);
  if (hb.unref) hb.unref();

  // ড্যাশবোর্ড এবং রিয়েল-টাইম WebSocket সার্ভার বুট করা
  if (cfg.DASHBOARD_ENABLED) {
    const dashBoot = boot({
      store: signalStore,
      telegram: bot,
      config: cfg,
      engineStatus: () => ({
        mode: rt.getExecution() ? 'live' : 'paper',
        engine: 'apex-quant',
        uptime_seconds: Math.round(process.uptime()),
        ...feedsStatus(),
        realtime: true,
        exec: rt.getExecution()
      }),
      getConfidence: () => rt.getConfidence(),
      setConfidence: (v) => rt.setConfidence(v),
    });

    const server = dashBoot.server;
    const PORT = Number(cfg.PORT) || 10000;
    
    server.listen(PORT, () =>
      console.log(`[qx] dashboard http://0.0.0.0:${PORT} (ws:/ws)`));
      
    // WebSocket এটাচ করা যা সরাসরি /api/status-এর ডেটা পুশ করবে
    const wsServer = attachWS(server, { store: signalStore, statusPayload: dashBoot.statusPayload });
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
    global.__qxWs && global.__qxWs.close && global.__qxWs.close();
    if (executor.stop) executor.stop();
    process.exit(code);
  };
  
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('unhandledRejection', r => console.error('[qx] unhandledRejection', r));
  process.on('uncaughtException', e => console.error('[qx] uncaughtException', e && e.stack));
}

main().catch(e => { console.error('[qx] fatal', e && e.stack); process.exit(1); });
