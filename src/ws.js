'use strict';

/**
 * src/ws.js
 * WebSocket endpoint (/ws) for the APEX//QUANT terminal.
 * Pushes the exact same payload as GET /api/status every 1s,
 * plus an instant snapshot on connect. Zero blocking — if a client
 * is slow or dead, it is dropped without touching the engine.
 */

const { WebSocketServer } = require('ws');
const { buildStatusPayload } = require('./dashboard');

function attachWs(server, opts) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set();

  const send = (ws, payload) => {
    if (ws.readyState === 1) {
      try { ws.send(JSON.stringify(payload)); } catch (e) {}
    }
  };
  const broadcast = () => {
    if (!clients.size) return;
    let payload = null;
    try { payload = buildStatusPayload(opts); } catch (e) {
      console.error('[ws] payload build error:', e.message);
      return;
    }
    for (const ws of clients) send(ws, payload);
  };

  wss.on('connection', (ws) => {
    clients.add(ws);
    try { send(ws, buildStatusPayload(opts)); } catch (e) {}
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  const iv = setInterval(broadcast, 1000);
  if (iv.unref) iv.unref();

  return {
    wss,
    close() {
      clearInterval(iv);
      for (const ws of clients) { try { ws.close(); } catch (e) {} }
      clients.clear();
    },
  };
}

module.exports = { attachWs };
