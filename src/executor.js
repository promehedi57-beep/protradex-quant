'use strict';
const cfg = require('./config');

class Executor {
  constructor({ onExecuted }) {
    this.onExecuted = onExecuted || null;
    this.enabled = cfg.EXECUTION_ENABLED;   // .env-এ EXECUTION_ENABLED=true লাগবে
    this.mode = cfg.EXECUTOR;
    this.wss = null;
    this.clients = new Set();
    this.ready = false;
    this.browser = null;
    this.page = null;
    this.puppeteerQueue = [];
    this.draining = false;
  }

  async start() {
    if (!this.enabled) {
      console.log('[executor] EXECUTION_ENABLED=false → DRY-RUN মোড (সিগনাল শুধু লগ)');
      return;
    }
    if (this.mode === 'extension') await this._startExtension();
    else if (this.mode === 'puppeteer') await this._startPuppeteer();
    else throw new Error('অজানা EXECUTOR: ' + this.mode);
  }

  async _startExtension() {
    let WSS = null;
    try { ({ WebSocketServer: WSS } = require('ws')); } catch (e) { /* নিচে এরর */ }
    if (!WSS) throw new Error('ws প্যাকেজ নেই — npm install ws');
    this.wss = new WSS({ port: cfg.EXTENSION_WS_PORT });
    this.wss.on('connection', ws => {
      this.clients.add(ws);
      this.ready = true;
      console.log('[executor] ✅ Chrome Extension কানেক্টেড — এক্সিকিউশন রেডি');
      ws.on('close', () => { this.clients.delete(ws); this.ready = this.clients.size > 0; });
      ws.on('error', e => console.error('[executor] ws client error:', e.message));
      ws.on('message', raw => {
        let msg = null;
        try { msg = JSON.parse(String(raw)); } catch (e) { return; }
        if (msg.type === 'ack') console.log('[executor] ack', msg.id);
        else if (msg.type === 'executed') {
          console.log('[executor] ✅ Quotex-এ ট্রেড:', msg.symbol, msg.direction);
          if (this.onExecuted) this.onExecuted(msg);
        } else if (msg.type === 'error') {
          console.error('[executor] extension error:', msg.message);
        }
      });
    });
    this.wss.on('error', e => console.error('[executor] ws server error:', e.message));
    await new Promise(r => this.wss.once('listening', r));
    console.log('[executor] WS bridge listening on :' + cfg.EXTENSION_WS_PORT);
  }

  async _startPuppeteer() {
    let puppeteer = null;
    try { puppeteer = require('puppeteer'); } catch (e) { throw new Error('puppeteer নেই — npm install puppeteer'); }
    console.log('[executor] Puppeteer চালু হচ্ছে (প্রোফাইল: ' + cfg.QUOTEX_PROFILE_DIR + ')…');
    this.browser = await puppeteer.launch({
      headless: false,
      userDataDir: cfg.QUOTEX_PROFILE_DIR,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.page = await this.browser.newPage();
    await this.page.goto(cfg.QUOTEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('[executor] Puppeteer Quotex পেজে। প্রথমবার একবার ম্যানুয়ালি লগইন করুন — সেশন .quotex-profile-এ সেভ থাকবে।');
  }

  execute(sig) {
    if (!this.enabled) {
      console.log('[dry-run] ' + sig.pair + ' → ' + sig.direction + ' (' + sig.confidence + '%) · ' + JSON.stringify(sig.levels));
      return { ok: true, dryRun: true };
    }
    if (this.mode === 'extension') return this._extExecute(sig);
    if (this.mode === 'puppeteer') { this.puppeteerQueue.push(sig); this._drainPuppeteer(); return { ok: true, queued: true }; }
    return { ok: false, error: 'unknown mode' };
  }

  _extExecute(sig) {
    if (!this.ready || !this.clients.size) {
      console.warn('[executor] কোনো extension কানেক্টেড নেই — সিগনাল ড্রপ:', sig.pair);
      return { ok: false, error: 'no-client' };
    }
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const msg = JSON.stringify({
      type: 'execute', id,
      symbol: sig.pair, direction: sig.direction,
      confidence: sig.confidence, levels: sig.levels,
      symbolMap: cfg.QUOTEX_SYMBOL_MAP || {}
    });
    let sent = false;
    for (const ws of this.clients) {
      try { ws.send(msg); sent = true; } catch (e) { console.error('[executor] send fail:', e.message); }
    }
    return { ok: sent, id };
  }

  async _drainPuppeteer() {
    if (this.draining) return;
    this.draining = true;
    while (this.puppeteerQueue.length) {
      const sig = this.puppeteerQueue.shift();
      try { await this._puppeteerExecute(sig); }
      catch (e) { console.error('[executor] puppeteer fail:', sig.pair, e.message); }
    }
    this.draining = false;
  }

  async _puppeteerExecute(sig) {
    if (!this.page) throw new Error('page not ready');
    const symbol = (cfg.QUOTEX_SYMBOL_MAP && cfg.QUOTEX_SYMBOL_MAP[sig.pair]) || sig.pair;
    try {
      await this.page.bringToFront();
      const input = await this.page.$(cfg.QUOTEX_ASSET_INPUT);
      if (input) {
        await input.click({ clickCount: 3 });
        await input.type(symbol, { delay: 15 });
        await new Promise(r => setTimeout(r, 800));
        const item = await this.page.$(cfg.QUOTEX_ASSET_ITEM);
        if (item) await item.click();
        await new Promise(r => setTimeout(r, 900));
      }
      const sel = sig.direction === 'CALL' ? cfg.QUOTEX_CALL_BTN : cfg.QUOTEX_PUT_BTN;
      const el = await this.page.$(sel);
      if (!el) throw new Error('CALL/PUT button পাওয়া যায়নি — .env-এ selector আপডেট করুন');
      await el.click();
      console.log('[executor] ✅ puppeteer clicked', sig.direction, symbol);
      if (this.onExecuted) this.onExecuted({ type: 'executed', symbol: sig.pair, direction: sig.direction });
    } catch (e) {
      console.error('[executor] puppeteer error:', e.message);
      if (this.onExecuted) this.onExecuted({ type: 'error', symbol: sig.pair, message: e.message });
    }
  }

  async stop() {
    if (this.wss) { try { this.wss.close(); } catch (e) { } this.wss = null; }
    if (this.browser) { try { await this.browser.close(); } catch (e) { } this.browser = null; }
  }
}

module.exports = { Executor };
