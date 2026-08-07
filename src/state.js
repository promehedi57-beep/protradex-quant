'use strict';
const cfg = require('./config');

// রিস্টার্ট ছাড়াই runtime-এ বদলযোগ্য স্টেট — dashboard + Telegram দুটোই এটাকে ব্যবহার করে
const state = {
  executionEnabled: cfg.EXECUTION_ENABLED,
  minConfidence: cfg.MIN_CONFIDENCE,
  lastCandleAt: 0,
  _execListeners: [],
  _confListeners: []
};

function setExecution(v) {
  v = !!v;
  const changed = v !== state.executionEnabled;
  state.executionEnabled = v;
  if (changed) for (const fn of state._execListeners) { try { fn(v); } catch (e) { console.error('[state] exec listener:', e.message); } }
  return v;
}
const onExecutionChange = fn => state._execListeners.push(fn);
const getExecution = () => state.executionEnabled;

function setConfidence(v) {
  v = Math.max(0, Math.min(97, Math.round(Number(v) || 0)));
  const changed = v !== state.minConfidence;
  state.minConfidence = v;
  if (changed) for (const fn of state._confListeners) { try { fn(v); } catch (e) { console.error('[state] conf listener:', e.message); } }
  return v;
}
const onConfidenceChange = fn => state._confListeners.push(fn);
const getConfidence = () => state.minConfidence;

module.exports = { state, setExecution, onExecutionChange, getExecution, setConfidence, onConfidenceChange, getConfidence };
