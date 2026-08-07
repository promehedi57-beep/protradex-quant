# ProTradeX Quant Engine v2 — Zero-Latency Quantitative Signal Engine

Pure-math, multi-market scanning engine. **No AI / LLM / vision / image analysis.**
Data: Binance (all active USDT spot pairs) + OANDA Forex (M1) + TradingView webhooks.
Execution: Telegram alerts + Chrome Extension / Puppeteer → Quotex auto-click.

## Setup
1. `npm install`
2. `cp .env.example .env` — ভ্যালু সেট করুন
3. **DRY-RUN** দিয়ে টেস্ট: `npm run dry`  (এক্সিকিউশন ছাড়া — শুধু লগ)
4. সব ঠিক থাকলে: `npm start`

## Feed নির্বাচন (.env)
- `FEED=binance` → সব active USDT পেয়ার (quoteVolume অনুযায়ী top N)
- `FEED=oanda` → রিয়েল ফরেক্স (OANDA v20, practice/live)
- `FEED=all` → দুটোই + TradingView webhook
- `QUOTE_ASSET`, `MIN_24H_QUOTE_VOLUME`, `MAX_PAIRS` দিয়ে পেয়ার ফিল্টার

## ফরেক্স সেশন (অটো-পজ)
- `FOREX_SESSION_ENABLED=true` → **শুধু Mon–Fri (UTC)** — শনি/রবি সিগনাল suppressed
- `OTC_BLACKOUT="21:55-22:05"` → OTC উইন্ডোতে বন্ধ (কমা দিয়ে একাধিক)
- বন্ধ থাকলেও ডেটা স্ট্রিম হয় — শুধু সিগনাল বের হয় না (engine-এ session চেক optional)

## রুল
`src/rules.js` — `RULES` অ্যারেতে নতুন রুল push করুন:
`{ id, desc, check(snapshot) { ... return buildSignal(...) } }`
থ্রেশহোল্ড সব `.env`-এ (ZSCORE_ENTRY, ADX_STRONG, RSI_OVERSOLD …)

## Telegram
1. BotFather → `/newbot` → টোকেন নিন
2. `TELEGRAM_BOT_TOKEN=` + `TELEGRAM_CHAT_ID=` (getUpdates দিয়ে chat id)
3. `TELEGRAM_ENABLED=true`

## Chrome Extension (Quotex auto-click)
1. `chrome://extensions` → Developer mode → **Load unpacked** → `extension/` ফোল্ডার
2. Quotex ট্যাব খোলা + লগইন থাকতে হবে
3. `.env`: `EXECUTION_ENABLED=true`, `EXECUTOR=extension`
4. ইঞ্জিন চালু করলে এক্সটেনশন অটো-কানেক্ট হয় (`:8787`)
5. Quotex DOM বদলালে `.env`-এর `QUOTEX_*` selector আপডেট করুন
6. `QUOTEX_SYMBOL_MAP={"BTCUSDT":"Bitcoin","ETHUSDT":"Ethereum"}` — অ্যাসেট নাম ম্যাপিং

## Puppeteer ফলব্যাক
- `EXECUTOR=puppeteer`, `EXECUTION_ENABLED=true`
- প্রথমবার ম্যানুয়ালি লগইন করুন — সেশন `.quotex-profile/`-এ সেভ থাকবে
- হেডলেস নয় (ব্রাউজার উইন্ডো খুলবে) — Quotex অ্যান্টি-বটের জন্য

## TradingView Webhook
Alert → Webhook URL: `https://YOUR_SERVER:8788/webhook?secret=YOUR_SECRET`
JSON body: `{"symbol":"BTCUSDT","open":100,"high":102,"low":99,"close":101,"volume":1500}`

## OANDA
- practice key: oanda.com → My Account → Manage API Access
- `OANDA_ENV=practice`, `OANDA_INSTRUMENTS=EUR_USD,GBP_USD,USD_JPY,XAU_USD`

## Ops
- স্ট্যাটস প্রতি `STATS_INTERVAL_S` সেকেন্ড: p95 latency, signals, overBudget
- `HEARTBEAT_ALERT_S` সেকেন্ড ডেটা না এলে টেলিগ্রাম ALERT
- unhandledRejection / uncaughtException গ্লোবালি লগ হয় — সাইলেন্ট ফেলিউর নেই
- ব্যাকআপ: বাফার ১২ঘ+ পুরনো ডেটা অটো-প্রুন

## সতর্কতা
- **DRY-RUN দিয়ে শুরু করুন** — EXECUTION_ENABLED=false
- Binance বাংলাদেশে geo-block হতে পারে → VPS/প্রক্সি ব্যবহার করুন
- Quotex selector ঘন ঘন বদলায় — টেস্ট করে রাখুন
- সিগনাল নয়, সম্ভাবনা — নিজের রিস্ক ম্যানেজমেন্ট নিজে করুন
