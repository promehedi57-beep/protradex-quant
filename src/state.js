'use strict';
const cfg = require('./config');

class RuntimeState {
  constructor() {
    this.executionEnabled = cfg.EXECUTION_ENABLED === true;
    this.otcEnabled       = cfg.OTC_ENABLED !== false;
    this.alertsEnabled    = cfg.TELEGRAM_ALERTS_ENABLED !== false;
    this.minConfidence    = cfg.MIN_CONFIDENCE ?? 65;
    this.lastCandleAt     = 0;
    this._execCb = null; this._alertCb = null; this._otcCb = null; this._confCb = null;
  }

  /* execution */
  setExecution(v){ this.executionEnabled = !!v; if (this._execCb) this._execCb(this.executionEnabled); }
  onExecutionChange(fn){ this._execCb = fn; }
  getExecution(){ return this.executionEnabled; }

  /* otc */
  setOtc(v){ this.otcEnabled = !!v; if (this._otcCb) this._otcCb(this.otcEnabled); }
  onOtcChange(fn){ this._otcCb = fn; }
  getOtc(){ return this.otcEnabled; }

  /* telegram alerts master switch (NOT dashboard) */
  setAlerts(v){ this.alertsEnabled = !!v; if (this._alertCb) this._alertCb(this.alertsEnabled); }
  onAlertsChange(fn){ this._alertCb = fn; }
  getAlerts(){ return this.alertsEnabled; }

  /* confidence */
  setConfidence(v){
    this.minConfidence = Math.max(0, Math.min(97, Math.round(Number(v) || 65)));
    if (this._confCb) this._confCb(this.minConfidence);
  }
  onConfidenceChange(fn){ this._confCb = fn; }
  getConfidence(){ return this.minConfidence; }
}

module.exports = new RuntimeState();
