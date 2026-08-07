'use strict';
const https = require('https');
const cfg = require('./config');

const esc = s => String(s ?? '').replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&#39;','"':'&quot;'}[c]));
const num = v => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '—' : Number(v).toPrecision(6);

class TelegramNotifier {
  constructor({ token, chatId, enabled }) {
    this.token = String(token || '');
    this.chatId = String(chatId || '');
    this.enabled = !!enabled;
    this.queue = [];
    this.flushing = false;
    this.maxQueue = 300;
    if (this.enabled && (!this.token || !this.chatId)) {
      console.warn('[telegram] enabled কিন্তু token/chatId নেই — alerts বন্ধ করা হলো');
      this.enabled = false;
    }
  }

  _post(payload) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const req = https.request({
        hostname: 'api.telegram.org',
        path: '/bot' + this.token + '/sendMessage',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode === 429) {
            const e = new Error('telegram 429');
            e.retryAfter = Number(res.headers['retry-after'] || 2) * 1000;
            return reject(e);
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error('telegram HTTP ' + res.statusCode + ' ' + data.slice(0, 160)));
          }
          try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
        });
      });
      req.on('error', reject);
      req.setTimeout(12000, () => req.destroy(new Error('telegram timeout')));
      req.end(body);
    });
  }

  async _flush() {
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    while (this.queue.length) {
      const payload = this.queue[0];
      try {
        await this._post(payload);
        this.queue.shift();
        if (this.queue.length) await new Promise(r => setTimeout(r, 80)); // ~12 msg/sec সেফ
      } catch (e) {
        if (e.retryAfter) await new Promise(r => setTimeout(r, e.retryAfter));
        else { console.error('[telegram] send fail:', e.message); this.queue.shift(); }
      }
    }
    this.flushing = false;
  }

  notify(sig) {
    if (!this.enabled) return;
    const lv = sig.levels || {};
    const dirTxt = sig.direction === 'CALL' ? '🟢 CALL (UP)' : sig.direction === 'PUT' ? '🔴 PUT (DOWN)' : '⚠️ ' + String(sig.direction);
    const lines = [
      '📊 <b>' + esc(sig.pair) + '</b> — ' + dirTxt,
      '🎯 Confidence: <b>' + sig.confidence + '%</b> · TF: <b>' + esc(sig.timeframe || cfg.TIMEFRAME) + '</b>',
      '📈 Entry: <b>' + num(lv.entry) + '</b>',
      '🛑 SL: ' + num(lv.stopLoss) + ' · 🎯 TP: ' + num(lv.takeProfit),
      'S/R: ' + num(lv.support) + ' / ' + num(lv.resistance),
      '🧠 ' + esc(sig.reason || '')
    ];
    this.queue.push({ chat_id: this.chatId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true });
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
    this._flush();
  }
}

module.exports = { TelegramNotifier };
