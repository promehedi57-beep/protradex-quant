'use strict';
const cfg = require('./config');
const rt = require('./state');

const esc = s => String(s ?? '').replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&#39;','"':'&quot;'}[c]));
const num = v => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '—' : Number(v).toPrecision(6);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const human = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s/86400)+'d '+Math.floor(s%86400/3600)+'h '+Math.floor(s%3600/60)+'m '+(s%60)+'s'; };

class TelegramBot {
  constructor({ metrics, engine }) {
    this.token = String(cfg.TELEGRAM_BOT_TOKEN || '');
    this.chatId = String(cfg.TELEGRAM_CHAT_ID || '');
    this.enabled = cfg.TELEGRAM_ENABLED;
    this.metrics = metrics;
    this.engine = engine;
    this.allowed = new Set(String(cfg.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
    this.offset = 0;
    this.stopped = false;
    this.queue = [];
    this.flushing = false;
    this.maxQueue = 300;
    if (this.enabled && (!this.token || !this.chatId)) {
      console.warn('[telegram] enabled কিন্তু token/chatId নেই — bot বন্ধ করা হলো');
      this.enabled = false;
    }
  }

  /* ---------- HTTP core ---------- */
  async _call(method, payload) {
    const res = await fetch('https://api.telegram.org/bot' + this.token + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const t = await res.text();
      const e = new Error(method + ' HTTP ' + res.status + ' ' + t.slice(0, 160));
      if (res.status === 409) e.conflict = true;
      throw e;
    }
    return res.json();
  }

  async _getUpdates() {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), (cfg.TELEGRAM_POLL_TIMEOUT + 5) * 1000);
    try {
      const url = 'https://api.telegram.org/bot' + this.token + '/getUpdates?timeout=' + cfg.TELEGRAM_POLL_TIMEOUT + '&offset=' + this.offset;
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status === 409) { const e = new Error('conflict'); e.conflict = true; throw e; }
      if (!res.ok) throw new Error('getUpdates HTTP ' + res.status);
      const d = await res.json();
      if (d.ok && Array.isArray(d.result)) {
        if (d.result.length) this.offset = d.result[d.result.length - 1].update_id + 1;
        return d.result;
      }
      return [];
    } finally { clearTimeout(to); }
  }

  /* ---------- সিগনাল অ্যালার্ট (বিদ্যমান notify — সেভ থাকে) ---------- */
  async _flush() {
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    while (this.queue.length) {
      const item = this.queue[0];
      try {
        await this._call('sendMessage', item);
        this.queue.shift();
        if (this.queue.length) await sleep(80);
      } catch (e) {
        console.error('[telegram] send fail:', e.message);
        this.queue.shift();
      }
    }
    this.flushing = false;
  }

  send(text, extra = {}) {
    if (!this.enabled) return;
    this.queue.push(Object.assign({ chat_id: this.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }, extra));
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
    this._flush();
  }

  notify(sig) {
    if (!this.enabled) return;
    const lv = sig.levels || {};
    const dirTxt = sig.direction === 'CALL' ? '🟢 CALL (UP)' : sig.direction === 'PUT' ? '🔴 PUT (DOWN)' : '⚠️ ' + esc(sig.direction);
    const lines = [
      '📊 <b>' + esc(sig.pair) + '</b> — ' + dirTxt,
      '🎯 Confidence: <b>' + sig.confidence + '%</b> · TF: <b>' + esc(sig.timeframe || cfg.TIMEFRAME) + '</b>',
      '📈 Entry: <b>' + num(lv.entry) + '</b>',
      '🛑 SL: ' + num(lv.stopLoss) + ' · 🎯 TP: ' + num(lv.takeProfit),
      'S/R: ' + num(lv.support) + ' / ' + num(lv.resistance),
      '🧠 ' + esc(sig.reason || '')
    ];
    this.send(lines.join('\n'));
  }

  /* ---------- Inline keyboard builders ---------- */
  _mainKeyboard() {
    return {
      inline_keyboard: [
        [{ text: '📊 Status', callback_data: 'status' }, { text: '📈 Active Pairs', callback_data: 'pairs' }],
        [{ text: '⚡ Execution: ' + (rt.getExecution() ? '🟢 ON' : '🟡 OFF'), callback_data: 'toggle_exec' }],
        [{ text: '🎯 Conf −5%', callback_data: 'conf_down' }, { text: '🎯 Conf +5%', callback_data: 'conf_up' }]
      ]
    };
  }

  _statusText() {
    const m = this.metrics.snapshot();
    const lastAgo = rt.state.lastCandleAt ? Math.round((Date.now() - rt.state.lastCandleAt) / 1000) : null;
    return [
      '📊 <b>ProTradeX Quant — Status</b>',
      '🕐 Uptime: <b>' + human(m.uptimeS || 0) + '</b>',
      '👥 Scanning: <b>' + (this.engine.states.size || 0) + '</b> pairs',
      '📈 Total signals: <b>' + (m.signals || 0) + '</b>',
      '⏱ p95 latency: <b>' + m.latencyP95Ms + 'ms</b>',
      '📡 Last candle: ' + (lastAgo === null ? '—' : '<b>' + lastAgo + 's</b> আগে'),
      '🎯 Min confidence: <b>' + rt.getConfidence() + '%</b>',
      '⚡ Execution: <b>' + (rt.getExecution() ? '🟢 REAL' : '🟡 DRY-RUN') + '</b>'
    ].join('\n');
  }

  _pairsText() {
    const list = this.engine.getPairsSnapshot(10);
    if (!list.length) return '📈 এখনো কোনো পেয়ার warm-up শেষ করেনি…';
    const lines = ['📈 <b>Active Pairs (near signal)</b>'];
    list.forEach((p, i) => {
      const dir = p.direction === 'CALL' ? '🟢 CALL' : p.direction === 'PUT' ? '🔴 PUT' : '—';
      lines.push(
        (i + 1) + '. <b>' + esc(p.symbol) + '</b> — ' + num(p.price) + '  ·  Conf <b>' + p.confidence + '%</b> ' + dir +
        '\n&nbsp;&nbsp;&nbsp;RSI ' + (p.rsi == null ? '—' : p.rsi.toFixed(1)) +
        ' · ADX ' + (p.adx == null ? '—' : p.adx.toFixed(1)) +
        ' · Z ' + (p.zscore == null ? '—' : p.zscore.toFixed(2))
      );
    });
    return lines.join('\n');
  }

  /* ---------- মেসেজ/কলব্যাক হ্যান্ডলিং ---------- */
  _authorized(chatId) { return this.allowed.size === 0 || this.allowed.has(String(chatId)); }

  async _handle(update) {
    if (update.callback_query) return this._handleCallback(update.callback_query);
    if (update.message) return this._handleMessage(update.message);
  }

  async _handleMessage(msg) {
    const chat = msg.chat ? msg.chat.id : null;
    if (chat === null || !this._authorized(chat)) {
      try { await this._call('sendMessage', { chat_id: chat, text: '⛔ এই chat-এ bot কন্ট্রোল অনুমোদিত নয়।' }); } catch (e) { }
      return;
    }
    const text = String(msg.text || '').trim();
    const kb = { reply_markup: this._mainKeyboard() };
    if (text === '/start') {
      await this._call('sendMessage', Object.assign({
        chat_id: chat,
        text: '👋 <b>ProTradeX Quant Control Panel</b>\n\nনিচের বাটন বা কমান্ড ব্যবহার করুন:\n/status · /pairs · /conf · /exec on|off',
        parse_mode: 'HTML'
      }, kb));
    } else if (text === '/status') {
      await this._call('sendMessage', Object.assign({ chat_id: chat, text: this._statusText(), parse_mode: 'HTML' }, kb));
    } else if (text === '/pairs') {
      await this._call('sendMessage', Object.assign({ chat_id: chat, text: this._pairsText(), parse_mode: 'HTML' }, kb));
    } else if (text === '/conf') {
      await this._call('sendMessage', Object.assign({ chat_id: chat, text: '🎯 বর্তমান min confidence: <b>' + rt.getConfidence() + '%</b>\nবদলাতে: <b>/conf 75</b>', parse_mode: 'HTML' }, kb));
    } else if (/^\/conf\s+\d{1,3}$/.test(text)) {
      const v = rt.setConfidence(parseInt(text.split(/\s+/)[1], 10));
      await this._call('sendMessage', Object.assign({ chat_id: chat, text: '🎯 Min confidence → <b>' + v + '%</b> ✅', parse_mode: 'HTML' }, kb));
    } else if (text === '/exec' || text === '/exec on' || text === '/exec off') {
      const v = text === '/exec off' ? false : !rt.getExecution();
      rt.setExecution(v);
      await this._call('sendMessage', Object.assign({ chat_id: chat, text: '⚡ Execution → <b>' + (v ? '🟢 REAL' : '🟡 DRY-RUN') + '</b> ✅', parse_mode: 'HTML' }, kb));
    } else if (text === '/exec on') { /* উপরের কভার করেছে */ }
    else {
      await this._call('sendMessage', Object.assign({ chat_id: chat, text: '❓ চিনতে পারিনি — /start দেখুন', parse_mode: 'HTML' }, kb));
    }
  }

  async _handleCallback(cb) {
    const chat = cb.message && cb.message.chat ? cb.message.chat.id : null;
    const mid = cb.message ? cb.message.message_id : null;
    const data = String(cb.data || '');
    try { await this._call('answerCallbackQuery', { callback_query_id: cb.id, text: '⏳…' }); } catch (e) { }
    if (chat === null || !this._authorized(chat)) return;
    let text = null;
    if (data === 'status') text = this._statusText();
    else if (data === 'pairs') text = this._pairsText();
    else if (data === 'toggle_exec') rt.setExecution(!rt.getExecution());
    else if (data === 'conf_up') rt.setConfidence(rt.getConfidence() + 5);
    else if (data === 'conf_down') rt.setConfidence(rt.getConfidence() - 5);
    if (text !== null) {
      try {
        await this._call('editMessageText', {
          chat_id: chat, message_id: mid,
          text, parse_mode: 'HTML',
          reply_markup: this._mainKeyboard()
        });
      } catch (e) { console.error('[telegram] edit fail:', e.message); }
    } else {
      // টগল/কনফিডেন্স — বাটনের লেবেল আপডেট
      try {
        await this._call('editMessageReplyMarkup', {
          chat_id: chat, message_id: mid,
          reply_markup: this._mainKeyboard()
        });
      } catch (e) { }
      try { await this._call('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ ' + (data === 'toggle_exec' ? 'Execution: ' + (rt.getExecution() ? 'REAL' : 'DRY-RUN') : 'Confidence: ' + rt.getConfidence() + '%') }); } catch (e) { }
    }
  }

  /* ---------- লাইফসাইকেল ---------- */
  start() {
    if (!this.enabled) return;
    console.log('[telegram] 🟢 long-polling শুরু — inline control panel চালু');
    this._poll();
  }

  async _poll() {
    while (!this.stopped) {
      try {
        const updates = await this._getUpdates();
        for (const u of updates) {
          try { await this._handle(u); } catch (e) { console.error('[telegram] handle error:', e.message); }
        }
      } catch (e) {
        if (e && e.conflict) { console.error('[telegram] 409 conflict — আরেকটি instance পোলিং করছে? ৫সে পরে আবার'); await sleep(5000); }
        else if (e && e.name === 'AbortError') { /* টাইমআউট — স্বাভাবিক, লুপ চালিয়ে যান */ }
        else { console.error('[telegram] poll error:', e.message); await sleep(3000); }
      }
    }
  }

  stop() { this.stopped = true; }
}

module.exports = { TelegramBot };
