'use strict';
const path = require('path');
const express = require('express');
const cfg = require('./config');
const rt = require('./state');

const human = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s/86400)+'d '+Math.floor(s%86400/3600)+'h '+Math.floor(s%3600/60)+'m '+(s%60)+'s'; };

function createDashboard({ engine, metrics, feedsStatus }) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Optional Basic Auth
  if (cfg.DASHBOARD_USER && cfg.DASHBOARD_PASS) {
    app.use((req, res, next) => {
      const b64 = (req.headers.authorization || '').replace(/^Basic\s+/i, '');
      const buf = Buffer.from(b64, 'base64').toString('utf8');
      const [u, p] = buf.split(':');
      if (u === cfg.DASHBOARD_USER && p === cfg.DASHBOARD_PASS) return next();
      res.set('WWW-Authenticate', 'Basic realm="ProTradeX"');
      return res.status(401).end();
    });
  }

  // কাস্টম ইন্টারঅ্যাক্টিভ ড্যাশবোর্ড UI (সার্চ, ওয়াচলিস্ট এবং পার্মানেন্ট সিগন্যাল হিস্ট্রি সহ)
  app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ProTradeX Quant Terminal</title>
  <script src="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.js"></script>
  <style>
    body { background-color: #0f172a; color: #f8fafc; font-family: sans-serif; }
    .card { background-color: #1e293b; border: 1px solid #334155; }
  </style>
</head>
<body class="p-4 max-w-7xl mx-auto">
  <header class="flex flex-col md:flex-row justify-between items-center mb-6 border-b border-gray-700 pb-4">
    <h1 class="text-2xl font-bold text-green-400">🚀 ProTradeX Quant Terminal</h1>
    <div id="status-bar" class="text-sm text-gray-400 mt-2 md:mt-0">Loading status...</div>
  </header>

  <!-- কন্ট্রোল প্যানেল -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
    <div class="card p-4 rounded-lg shadow">
      <h2 class="font-semibold text-gray-300 mb-2">Execution Mode</h2>
      <button id="exec-btn" onclick="toggleExecution()" class="px-4 py-2 rounded font-bold w-full">Loading...</button>
    </div>
    <div class="card p-4 rounded-lg shadow">
      <h2 class="font-semibold text-gray-300 mb-2">Confidence Threshold (%)</h2>
      <div class="flex gap-2">
        <input type="number" id="conf-input" class="bg-gray-700 p-2 rounded w-full text-white" value="65">
        <button onclick="updateConfidence()" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-bold">সেভ</button>
      </div>
    </div>
    <div class="card p-4 rounded-lg shadow">
      <h2 class="font-semibold text-gray-300 mb-2">Quick Search & Add Watchlist</h2>
      <input type="text" id="search-box" placeholder="Search Pair (e.g. BTCUSDT)..." oninput="filterPairs()" class="bg-gray-700 p-2 rounded w-full text-white">
    </div>
  </div>

  <!-- কাস্টম ওয়াচলিস্ট / চার্ট বোর্ড (আপনার সিলেক্ট করা পেয়ারগুলো এখানে পার্মানেন্ট থাকবে) -->
  <div class="mb-8">
    <h2 class="text-xl font-bold text-yellow-400 mb-3">⭐ My Watchlist / Selected Charts</h2>
    <div id="watchlist-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <p class="text-gray-500">কোনো পেয়ার সিলেক্ট করা নেই। নিচের মার্কেট টেবিল থেকে '+' এ ক্লিক করে এড করুন।</p>
    </div>
  </div>

  <!-- ফুল মার্কেট টেবিল -->
  <div class="card rounded-lg shadow overflow-hidden mb-8">
    <div class="p-4 bg-gray-800 font-bold border-b border-gray-700">Market Table (Top Pairs)</div>
    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-gray-900 text-gray-400 text-sm">
            <th class="p-3">PAIR</th>
            <th class="p-3">PRICE</th>
            <th class="p-3">RSI(14)</th>
            <th class="p-3">Z-SCORE</th>
            <th class="p-3">CONFIDENCE</th>
            <th class="p-3">ACTION</th>
          </tr>
        </thead>
        <tbody id="market-tbody">
          <tr><td colspan="6" class="p-4 text-center text-gray-500">Loading data...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- পার্মানেন্ট সিগন্যাল হিস্ট্রি লগ -->
  <div class="card rounded-lg shadow p-4">
    <h2 class="text-xl font-bold text-blue-400 mb-3">📋 Persistent Signal History Log</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="text-gray-400 border-b border-gray-700">
            <th class="p-2">TIME</th>
            <th class="p-2">PAIR</th>
            <th class="p-2">DIRECTION</th>
            <th class="p-2">CONFIDENCE</th>
          </tr>
        </thead>
        <tbody id="signal-history-tbody">
          <tr><td colspan="4" class="p-2 text-gray-500">No signals recorded yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    let watchlist = JSON.parse(localStorage.getItem('my_watchlist') || '[]');
    let allPairsData = [];
    let signalHistory = [];

    async function fetchData() {
      try {
        const resStatus = await fetch('/api/status');
        const status = await resStatus.json();
        document.getElementById('status-bar').innerHTML = \`Uptime: \${status.uptimeHuman} | Binance: \${status.binanceConnected ? '🟢 Connected' : '🔴 Disconnected'} | Signals: \${status.signals}\`;
        
        const execBtn = document.getElementById('exec-btn');
        execBtn.className = status.executionEnabled ? 'bg-green-600 hover:bg-green-700 px-4 py-2 rounded font-bold w-full text-white' : 'bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded font-bold w-full text-white';
        execBtn.innerText = status.executionEnabled ? '🟢 REAL EXECUTION (ON)' : '🟡 DRY-RUN (OFF)';

        const resPairs = await fetch('/api/pairs?limit=50');
        allPairsData = await resPairs.json();
        renderMarketTable(allPairsData);
        renderWatchlist();
      } catch (e) { console.error(e); }
    }

    function renderMarketTable(data) {
      const tbody = document.getElementById('market-tbody');
      const query = document.getElementById('search-box').value.toLowerCase();
      tbody.innerHTML = '';
      
      const filtered = data.filter(p => p.symbol.toLowerCase().includes(query));
      if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-500">No pairs found</td></tr>';
        return;
      }

      filtered.forEach(p => {
        const isWatched = watchlist.includes(p.symbol);
        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-800 hover:bg-gray-750';
        tr.innerHTML = \`
          <td class="p-3 font-bold">\${p.symbol}</td>
          <td class="p-3">\${p.price.toFixed(4)}</td>
          <td class="p-3">\${p.rsi ? p.rsi.toFixed(1) : '-'}</td>
          <td class="p-3">\${p.zscore ? p.zscore.toFixed(2) : '-'}</td>
          <td class="p-3">\${p.confidence}%</td>
          <td class="p-3">
            <button onclick="toggleWatchlist('\${p.symbol}')" class="\${isWatched ? 'bg-red-600' : 'bg-green-600'} px-3 py-1 rounded text-xs font-bold text-white">
              \${isWatched ? 'Remove ❌' : 'Add Watchlist ➕'}
            </button>
          </td>
        \`;
        tbody.appendChild(tr);
      });
    }

    function filterPairs() {
      renderMarketTable(allPairsData);
    }

    function toggleWatchlist(symbol) {
      if (watchlist.includes(symbol)) {
        watchlist = watchlist.filter(s => s !== symbol);
      } else {
        watchlist.push(symbol);
      }
      localStorage.setItem('my_watchlist', JSON.stringify(watchlist));
      renderWatchlist();
      renderMarketTable(allPairsData);
    }

    function renderWatchlist() {
      const container = document.getElementById('watchlist-grid');
      container.innerHTML = '';
      if (!watchlist.length) {
        container.innerHTML = '<p class="text-gray-500 col-span-3">আপনার পছন্দমতো পেয়ার এড করতে নিচের টেবিল থেকে '+' এ ক্লিক করুন।</p>';
        return;
      }

      watchlist.forEach(sym => {
        const p = allPairsData.find(x => x.symbol === sym) || { symbol: sym, price: 0, rsi: 50, zscore: 0, confidence: 0, direction: 'WAITING' };
        const dirColor = p.direction === 'CALL' ? 'text-green-400' : (p.direction === 'PUT' ? 'text-red-400' : 'text-yellow-400');
        
        const card = document.createElement('div');
        card.className = 'card p-4 rounded-lg shadow relative border-l-4 border-blue-500';
        card.innerHTML = \`
          <button onclick="toggleWatchlist('\${sym}')" class="absolute top-2 right-2 text-gray-400 hover:text-red-500 font-bold">✖</button>
          <h3 class="font-bold text-lg text-white mb-1">\${p.symbol}</h3>
          <p class="text-2xl font-semibold mb-2">\${p.price ? p.price.toFixed(4) : '0.0000'}</p>
          <div class="flex justify-between text-sm text-gray-300 mb-1">
            <span>RSI: \${p.rsi ? p.rsi.toFixed(1) : '-'}</span>
            <span>Z-Score: \${p.zscore ? p.zscore.toFixed(2) : '-'}</span>
          </div>
          <div class="flex justify-between items-center mt-3 pt-2 border-t border-gray-700">
            <span class="font-bold \${dirColor}">Signal: \${p.direction || 'WAITING'}</span>
            <span class="bg-gray-800 px-2 py-1 rounded text-xs">Conf: \${p.confidence}%</span>
          </div>
        \`;
        container.appendChild(card);
      });
    }

    async function toggleExecution() {
      const res = await fetch('/api/execution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !document.getElementById('exec-btn').innerText.includes('ON') })
      });
      fetchData();
    }

    async function updateConfidence() {
      const val = parseFloat(document.getElementById('conf-input').value);
      await fetch('/api/confidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: val })
      });
      alert('Confidence updated!');
    }

    setInterval(fetchData, 2000);
    fetchData();
  </script>
</body>
</html>`);
  });

  app.use(express.static(path.join(__dirname, 'public')));

  /* ---------- REST API ---------- */
  app.get('/api/status', (req, res) => {
    res.json({
      uptimeS: Math.round((Date.now() - metrics.startedAt) / 1000),
      uptimeHuman: human((Date.now() - metrics.startedAt) / 1000),
      binanceConnected: !!feedsStatus.binance,
      oandaConnected: !!feedsStatus.oanda,
      wsConnected: !!(feedsStatus.binance || feedsStatus.oanda),
      pairs: engine.states.size,
      signals: metrics.signals,
      candles: engine.stats.candles,
      latencyP95Ms: metrics.p95(),
      executionEnabled: rt.getExecution(),
      minConfidence: rt.getConfidence(),
      lastCandleAgo: rt.state.lastCandleAt ? Math.round((Date.now() - rt.state.lastCandleAt) / 1000) : null
    });
  });

  app.get('/api/pairs', (req, res) => {
    const n = Math.min(50, parseInt(req.query.limit, 10) || 20);
    res.json(engine.getPairsSnapshot(n));
  });

  app.post('/api/execution', (req, res) => {
    const v = !!(req.body && req.body.enabled);
    rt.setExecution(v);
    res.json({ ok: true, executionEnabled: rt.getExecution() });
  });

  app.post('/api/confidence', (req, res) => {
    const v = Number(req.body && req.body.value);
    if (!Number.isFinite(v)) return res.status(400).json({ ok: false, error: 'value: number দরকার' });
    res.json({ ok: true, minConfidence: rt.setConfidence(v) });
  });

  app.post('/api/confidence/adjust', (req, res) => {
    const d = Number(req.body && req.body.delta) || 0;
    res.json({ ok: true, minConfidence: rt.setConfidence(rt.getConfidence() + d) });
  });

  /* TradingView webhook */
  if (cfg.WEBHOOK_ENABLED) {
    app.post('/webhook', (req, res) => {
      const secret = cfg.WEBHOOK_SECRET;
      if (secret && req.get('x-webhook-secret') !== secret && req.query.secret !== secret) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      }
      const body = req.body || {};
      const symbol = body.symbol || body.pair || body.ticker;
      if (!symbol) return res.status(400).json({ ok: false, error: 'missing symbol' });
      const candle = {
        open: Number(body.open ?? body.o),
        high: Number(body.high ?? body.h),
        low: Number(body.low ?? body.l),
        close: Number(body.close ?? body.c),
        volume: Number(body.volume ?? body.v ?? 0)
      };
      if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) {
        return res.status(400).json({ ok: false, error: 'invalid OHLC' });
      }
      engine.onClosedCandle(String(symbol).toUpperCase(), candle);
      res.json({ ok: true });
    });
  }
  app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now(), pairs: engine.states.size }));

  return app;
}

module.exports = { createDashboard };
