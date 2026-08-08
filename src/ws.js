'use strict';
/* ws.js — optional WebSocket layer. Each WS message mirrors GET /api/status so the
   frontend's existing ingest() code path works unchanged. */
let WSS = null;
try { ({ WebSocketServer: WSS } = require('ws')); } catch (_) { WSS = null; }

function attachWS(server, deps = {}) {
  if (!server || typeof server.on !== 'function' || !WSS) return null;
  const { store, statusPayload } = deps;
  const wss = new WSS({ server, path: deps.path || '/ws' });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => clients.delete(ws));
    ws.on('close', () => clients.delete(ws));
    try { ws.send(JSON.stringify({ type: 'ready', at: Date.now() })); } catch (_) {}
    try { if (statusPayload) ws.send(JSON.stringify({ type: 'snapshot', ...statusPayload() })); } catch (_) {}
  });

  if (store) store.on('change', ({ type, signal }) => {
    broadcast({ type: `signal.${type}`, signal, at: Date.now() });
    // also push a full snapshot so the UI stays consistent
    try { if (statusPayload) broadcast({ type: 'snapshot', ...statusPayload() }); } catch (_) {}
  });

  function send(ws, obj) { if (ws.readyState === 1) try { ws.send(JSON.stringify(obj)); } catch (_) {} }
  function broadcast(obj) { for (const ws of clients) send(ws, obj); }

  const beat = setInterval(() => {
    for (const ws of clients) {
      if (ws.readyState !== 1) continue;
      if (!ws.isAlive) { try { ws.terminate(); } catch (_) {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) {}
      try { if (statusPayload) send(ws, { type: 'snapshot', ...statusPayload() }); } catch (_) {}
    }
  }, deps.heartbeatMs || 3000);
  if (beat.unref) beat.unref();

  return wss;
}

module.exports = { attachWS };
