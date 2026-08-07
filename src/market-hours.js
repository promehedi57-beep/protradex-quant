'use strict';
const cfg = require('./config');

// "21:55-22:05,12:30-12:45" → [{start,end,wraps}]
function parseWindows(raw) {
  const out = [];
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const start = (+m[1] * 60 + +m[2]) % 1440;
    const end = (+m[3] * 60 + +m[4]) % 1440;
    out.push({ start, end, wraps: end < start });
  }
  return out;
}
const BLACKOUT = parseWindows(cfg.OTC_BLACKOUT);

const minutesOfDay = d => d.getUTCHours() * 60 + d.getUTCMinutes();

function inBlackout(d) {
  const m = minutesOfDay(d);
  for (const w of BLACKOUT) {
    if (w.wraps ? (m >= w.start || m <= w.end) : (m >= w.start && m <= w.end)) return true;
  }
  return false;
}

// 0=রবি … 6=শনি (UTC)
const isForexSession = d => { const day = d.getUTCDay(); return day >= 1 && day <= 5; };

function isTradingTime(now = new Date()) {
  if (!cfg.FOREX_SESSION_ENABLED) return true;
  return isForexSession(now) && !inBlackout(now);
}

module.exports = { isTradingTime, isForexSession, inBlackout, minutesOfDay };
