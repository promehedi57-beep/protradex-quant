'use strict';
/* telegram.js — secure Telegram bridge (defensive ID parsing, never throws).
   Env: TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_IDS, TELEGRAM_ADMIN_IDS,
        TELEGRAM_BROADCAST_TARGETS, TELEGRAM_ALERTS_ENABLED                */
const APIG = 'https://api.telegram.org';

function parseIds(raw) {
  const set = new Set();
  if (raw == null) return set;
  String(raw).split(/[\s,;|\/]+/).forEach(tok => {
    const t = tok.trim(); if (!t) return;
    const n = Number(t);
    set.add(Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? String(n) : t);
  });
  return set;
}
const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));

function createTelegram(opts = {}) {
  const token = opts.token || process.env.TELEGRAM_BOT_TOKEN || '';
  const ALLOWED = parseIds(opts.allowed ?? process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  const ADMINS  = parseIds(opts.admins  ?? process.env.TELEGRAM_ADMIN_IDS);
  const TARGETS = parseIds(opts.targets ?? process.env.TELEGRAM_BROADCAST_TARGETS);
  let alerts   = (opts.alertsEnabled ?? process.env.TELEGRAM_ALERTS_ENABLED) === 'true';
  const timeout = opts.timeout || 9000;

  if (!token) return { enabled: false, error: 'TELEGRAM_BOT_TOKEN missing',
    sendMessage: async () => ({ ok:false }), shareSignal: async () => ({ ok:false }),
    testAlert: async () => ({ ok:false }), onUpdate: async () => ({ ok:false, handled:false }) };

  async function call(method, body) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(`${APIG}/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      return j.ok ? { ok: true, result: j.result } : { ok: false, code: j.error_code, desc: j.description };
    } finally { clearTimeout(t); }
  }

  async function sendMessage(chatId, text, extra = {}) {
    if (chatId == null || text == null) return { ok: false, sent: false, error: 'no chat/text' };
    const out = await call('sendMessage', {
      chat_id: Number(chatId) || chatId, text, parse_mode: 'HTML',
      disable_web_page_preview: true, ...extra });
    return { ok: out.ok, sent: out.ok, error: out.desc, ...out };
  }

  function fmtSignal(s) {
    const dir = String(s.direction || '').toUpperCase() === 'PUT' ? '▼ PUT' : '▲ CALL';
    const market = String(s.market || 'CRYPTO').toUpperCase();
    const pair = String(s.pair || s.symbol || '?');
    const conf = clamp(s.confidence ?? 0, 0, 100), rsi = clamp(s.rsi ?? 50, 0, 100);
    const sec = Math.max(5, Number(s.candleTime ?? s.timeframe_sec ?? 60) || 60);
    const price = Number(s.entryPrice ?? s.entry ?? s.price ?? 0);
    const dp = Number.isFinite(+s.dp) ? +s.dp : (/OTC/i.test(pair + market) ? 5 : 2);
    const when = s.timestamp ? new Date(s.timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '';
    const t = sec >= 3600 ? `${sec/3600}h` : sec >= 60 ? `${sec/60}m` : `${sec}s`;
    return ['⚡ APEX//QUANT SIGNAL', `${pair} · ${market} · ${t}`,
      `${dir} @ ${Number(price).toFixed(dp)}`, `Confidence ${conf}% · RSI ${rsi.toFixed(1)}`, when]
      .filter(Boolean).join('\n');
  }

  async function shareSignal(sig) {
    const to = parseIds(sig?.targets).size ? parseIds(sig.targets) : TARGETS;
    if (!to.size) return { ok:false, sent:false, error:'no broadcast targets (TELEGRAM_BROADCAST_TARGETS)' };
    if (!alerts) return { ok:false, sent:false, error:'TELEGRAM_ALERTS_ENABLED=false', skipped:true };
    const text = fmtSignal(sig), results = [];
    for (const chat of to) results.push(await sendMessage(chat, text));
    const ok = results.every(r => r.ok);
    return { ok, sent: ok, sentTo: to.size, results };
  }

  async function testAlert(msg) {
    const to = TARGETS.size ? TARGETS : ALLOWED;
    if (!to.size) return { ok:false, sent:false, error:'no targets' };
    return sendMessage([...to][0], msg || '✅ APEX//QUANT — test alert OK');
  }

  async function onUpdate(update) {
    const m = update?.message; if (!m) return { ok:false, handled:false };
    const chatId = String(m.chat?.id), fromId = String(m.from?.id);
    const allowed = ALLOWED.has(chatId) || ALLOWED.has(fromId);
    const admin   = ADMINS.has(chatId)  || ADMINS.has(fromId);
    if (!allowed) { await sendMessage(chatId, '⛔ Access denied.'); return { ok:false, handled:true, denied:true }; }
    const txt  = String(m.text || '').trim();
    const cmd  = (txt.split(/\s+/) || [''])[0];
    if (cmd === '/start')   { await sendMessage(chatId, '👋 APEX//QUANT online.'); return { ok:true, handled:true }; }
    if (cmd === '/health' || cmd === '/status') { await sendMessage(chatId, '✅ Engine OK'); return { ok:true, handled:true }; }
    if (cmd === '/alerts') {
      if (!admin) { await sendMessage(chatId, '⛔ Admin only.'); return { ok:false, handled:true }; }
      alerts = !alerts; await sendMessage(chatId, `🔔 Auto alerts: ${alerts ? 'ON' : 'OFF'}`);
      return { ok:true, handled:true };
    }
    if (cmd === '/broadcast') {
      if (!admin) { await sendMessage(chatId, '⛔ Admin only.'); return { ok:false, handled:true }; }
      const out = await testAlert('💬 Broadcast test'); await sendMessage(chatId, out.sent ? '📡 Broadcast OK' : '❌ Broadcast failed');
      return { ok:true, handled:true };
    }
    return { ok:true, handled:false };
  }

  let poll = null;
  function startPolling({ pollMs = 1500, useWebhook = false } = {}) {
    if (useWebhook || poll) return; let offset = 0;
    const tick = async () => {
      const r = await fetch(`${APIG}/bot${token}/getUpdates?timeout=25&offset=${offset}`).catch(() => null);
      if (!r) return; const j = await r.json().catch(() => ({}));
      if (!j.ok || !Array.isArray(j.result)) return;
      for (const u of j.result) { offset = u.update_id + 1; await onUpdate(u); }
    };
    poll = setInterval(async () => { try { await tick(); } catch (_) {} }, pollMs);
    if (poll.unref) poll.unref();
  }

  return { enabled: true, token, ALLOWED, ADMINS, TARGETS, alerts,
    sendMessage, shareSignal, testAlert, onUpdate, fmtSignal, startPolling };
}

module.exports = { createTelegram, parseIds };
