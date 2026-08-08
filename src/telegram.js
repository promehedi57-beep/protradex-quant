'use strict';

/**
 * src/telegram.js
 * 2-way Telegram bot via long polling (fetch-based, Render-safe).
 * STRICT ACCESS: only cfg.TELEGRAM_ALLOWED_CHAT_IDS may issue commands.
 * Empty whitelist ⇒ every command refused (secure-by-default).
 * /alerts toggles notifications only — dashboard/signals keep running regardless.
 * /broadcast is admin-only (cfg.TELEGRAM_ADMIN_IDS).
 */

const cfg = require('./config');
const rt = require('./state');

const BASE = 'https://api.telegram.org/bot';

class TelegramBot {
  constructor({ metrics, engine, rt: runtime }) {
    this.metrics = metrics;
    this.engine = engine;
    this.rt = runtime;
    this.token = cfg.TELEGRAM_BOT_TOKEN;
    this.allowed = cfg.TELEGRAM_ALLOWED_CHAT_IDS;
    this.admins = cfg.TELEGRAM_ADMIN_IDS;
    this.targets = cfg.TELEGRAM_BROADCAST_TARGETS.length ? cfg.TELEGRAM_BROADCAST_TARGETS : this.allowed;
    this.alerts = rt.getAlerts();
    this._offset = 0;
    this._stop = false;
    this._pollTimer = null;
    this._me = null;
    this._abort = null;
  }

  api(method, payload = {}) {
    return fetch(`${BASE}${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(async (r) => ({ ok: r.ok, code: r.status, json: await r.json().catch(() => ({})) }));
  }

  hasToken() { return !!this.token; }

  async start() {
    if (!this.hasToken()) { console.warn('[tg] no TELEGRAM_BOT_TOKEN — bot disabled'); return; }
    try {
      const me = await this.api('getMe');
      if (!me.ok) throw new Error('getMe failed ' + me.code);
      this._me = me.json.result?.username;
      console.log(`[tg] bot @${this._me} · allowed=${this.allowed.length} · alerts=${this.alerts}`);
      this._poll();
    } catch (e) { console.error('[tg] start failed:', e.message); }
  }

  async _request(doAbort = true) {
    const ctrl = new AbortController();
    this._abort = ctrl;
    const to = new AbortController();
    const tId = setTimeout(() => { ctrl.abort(); }, (cfg.TELEGRAM_POLL_TIMEOUT || 30) * 1000 + 3000);
    try {
      const res = await fetch(`${BASE}${this.token}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: cfg.TELEGRAM_POLL_TIMEOUT || 30, offset: this._offset }),
        signal: ctrl.signal,
      });
      clearTimeout(tId);
      if (!res.ok) return { ok: false, code: res.status };
      return { ok: true, json: await res.json() };
    } catch (e) {
      clearTimeout(tId);
      return { ok: false, error: e, aborted: e?.name === 'AbortError' };
    }
  }

  async _poll() {
    while (!this._stop) {
      const res = await this._request();
      if (!res.ok) {
        if (res.aborted) { continue; }                    // timeout → loop forever (normal)
        console.error('[tg] poll err', res.code || (res.error && res.error.message));
        await new Promise(r => setTimeout(r, 5000));      // backoff, avoid hammering Telegram
        continue;
      }
      const updates = res.json?.result || [];
      for (const u of updates) {
        this._offset = u.update_id + 1;                    // ack
        try { await this._handleUpdate(u); } catch (e) { console.error('[tg] update', e.message); }
      }
    }
  }

  _handleUpdate(u) {
    if (u.callback_query)    return this._onCallback(u.callback_query);
    if (u.message?.text)     return this._onMessage(u.message);
  }

  _authorized(chatId) {
    if (!this.allowed.length) return false;               // secure-by-default
    return this.allowed.includes(String(chatId));
  }

  _send(chatId, text, keyboard) {
    const payload = { chat_id: chatId, text, parse_mode: 'Markdown' };
    if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
    return this.api('sendMessage', payload).then(r => { if (!r.ok) console.error('[tg] send', r.code, JSON.stringify(r.json).slice(0, 200)); });
  }

  _answer(qid, text) { return this.api('answerCallbackQuery', { callback_query_id: qid, text }); }

  _keyboard(chatId) {
    const isAdmin = this.admins.includes(String(chatId));
    const exec = this.rt.getExecution() ? 'LIVE' : 'PAPER';
    return [
      [{ text: '📊 Status', callback_data: 'status' }, { text: '🧾 Active Pairs', callback_data: 'pairs' }],
      [{ text: `⚡ Execution: ${exec} (toggle)`, callback_data: 'exec' }],
      [{ text: '✓ Alerts: ' + (this.alerts ? 'ON' : 'OFF'), callback_data: 'alerts' }],
      [{ text: 'Conf −5', callback_data: 'conf:-5' }, { text: 'Conf +5', callback_data: 'conf:+5' }],
      ...(isAdmin ? [[{ text: '📢 Broadcast…', callback_data: 'broadcast' }]] : []),
    ];
  }

  _statusText() {
    const s = this.engine.status();
    return [
      '*ProTradeX · Live*',
      '',
      `⏱ Uptime: ${Math.floor(s.uptime / 60)}m ${s.uptime % 60}s`,
      `🟢 Pairs: ${s.pairs}`,
      `🟢 Signals: ${s.signals_total ?? 0}`,
      `⚙ Mode: ${this.rt.getExecution() ? 'LIVE (REAL)' : 'PAPER (DRY-RUN)'}`,
      `🎚 Confidence floor: ${this.rt.getConfidence()}%`,
      `🔔 Alerts: ${this.alerts ? 'ON' : 'OFF'}`,
      `🕒 TF active: ${s.timeframe}m · tfs: ${(s.tfs||[]).join('/')}`,
    ].join('\n');
  }

  _pairsText() {
    const rows = this.engine.getPairsSnapshot(12)
      .map((p, i) => `${i + 1}. ${p.symbol} · ${p.price} · ${p.zscore}σ · ${p.confidence}% · ${p.signal}`)
      .join('\n');
    return rows || '_no pairs yet_';
  }

  async _onMessage(m) {
    const from = m.chat?.id?.toString();
    if (typeof from === 'undefined') return;
    if (!this._authorized(from)) { this._send(from, '⛔ Unauthorized — this bot is restricted.'); return; }
    const t = (m.text || '').trim();

    if (t === '/start') return this._send(from, 'Welcome. Tap a button or use a command.', this._keyboard(from));
    if (t === '/status') return this._send(from, this._statusText());
    if (t === '/pairs')  return this._send(from, this._pairsText());
    if (t === '/exec')   { const n = !this.rt.getExecution(); this.rt.setExecution(n); return this._send(from, `Execution → ${n ? 'LIVE' : 'PAPER'}`); }
    if (t.startsWith('/conf')) {
      const v = parseInt(t.replace(/[^0-9-]/g, ''), 10);
      if (Number.isFinite(v)) this.rt.setConfidence(this.rt.getConfidence() + v);
      return this._send(from, `Confidence floor → ${this.rt.getConfidence()}%`);
    }
    if (t === '/alerts') {
      if (!this.admins.includes(from)) return this._send(from, '⛔ Admins only.');
      const n = !this.alerts; this.alerts = n; this.rt.setAlerts(n);
      return this._send(from, `Alerts → ${n ? 'ON' : 'OFF'} · dashboard signals unaffected.`);
    }
    if (t.startsWith('/broadcast ')) {
      if (!this.admins.includes(from)) return this._send(from, '⛔ Admins only.');
      const msg = t.slice('/broadcast '.length).trim();
      if (!msg) return this._send(from, 'Usage: /broadcast <text>');
      for (const c of this.targets) await this._send(c, msg).catch(()=>{});
      return this._send(from, `Broadcast sent to ${this.targets.length} target(s).`);
    }
    return this._send(from, 'Unknown command.', this._keyboard(from));
  }

  async _onCallback(cq) {
    const from = cq.message?.chat?.id?.toString();
    const data = cq.data || '';
    if (!from || !this._authorized(from)) { await this._answer(cq.id, '⛔ unauthorized'); return; }
    await this._answer(cq.id, '');

    if (data === 'status') return this._edit(cq, this._statusText());
    if (data === 'pairs')  return this._edit(cq, this._pairsText());
    if (data === 'exec')   { const n = !this.rt.getExecution(); this.rt.setExecution(n); return this._edit(cq, this._statusText()); }
    if (data === 'alerts') {
      if (!this.admins.includes(from)) return this._send(from, '⛔ Admins only.');
      this.alerts = !this.alerts; this.rt.setAlerts(this.alerts);
      return this._edit(cq, this._statusText());
    }
    if (data.startsWith('conf:')) {
      const d = parseInt(data.slice(5), 10);
      if (Number.isFinite(d)) this.rt.setConfidence(this.rt.getConfidence() + d);
      return this._edit(cq, this._statusText());
    }
    if (data === 'broadcast') return this._send(from, 'Use /broadcast <text> (admins only).');
  }

  _edit(cq, text) {
    return this.api('editMessageText', {
      chat_id: cq.message.chat.id, message_id: cq.message.message_id,
      text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: this._keyboard(cq.message.chat.id) },
    });
  }

  /* signal notification — runs ONLY when alerts enabled */
  async notify(sig) {
    if (!this.alerts || !this.targets.length) return;
    const dir = sig.sig === 'CALL' ? '📈' : sig.sig === 'PUT' ? '📉' : '➡';
    const msg = `${dir} *${sig.symbol}*\nSignal: ${sig.sig} · ${sig.confidence}%\nZ ${sig.zscore} · RSI ${sig.rsi}\n@ ${sig.price}`;
    for (const c of this.targets) await this._send(c, msg).catch(()=>{});
  }

  setAlerts(v) { this.alerts = !!v; }

  async stop() { this._stop = true; if (this._abort) this._abort.abort(); if (this._pollTimer) clearTimeout(this._pollTimer); }
}

module.exports = { TelegramBot };
