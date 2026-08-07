// Content script — Quotex DOM অটোমেশন (জিরো-ল্যাটেন্সি ক্লিক)
const DEFAULTS = {
  assetInput: 'input[placeholder*="Search"], input[placeholder*="Поиск"], input[type="search"]',
  assetItem: '.asset-item, .search-result__item, div[class*="asset"]',
  callBtn: '[data-testid="call-button"], button[class*="call"], [class*="call-button"]',
  putBtn: '[data-testid="put-button"], button[class*="put"], [class*="put-button"]'
};

const q = (sel, root) => { try { return (root || document).querySelector(sel); } catch (e) { return null; } };
const qa = (sel, root) => { try { return Array.from((root || document).querySelectorAll(sel)); } catch (e) { return []; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findButton(direction) {
  const sel = direction === 'CALL' ? DEFAULTS.callBtn : DEFAULTS.putBtn;
  for (const s of sel.split(',')) {
    const el = q(s.trim());
    if (el) return el;
  }
  // টেক্সট-ভিত্তিক ফলব্যাক
  const text = direction === 'CALL' ? 'call' : 'put';
  return qa('button, [role="button"], div[class*="btn"]')
    .find(el => (el.textContent || '').toLowerCase().includes(text)) || null;
}

async function execute(msg) {
  const symbol = (msg.symbolMap && msg.symbolMap[msg.symbol]) || msg.symbol;
  if (!symbol) return { ok: false, error: 'no symbol' };

  // ১) অ্যাসেট সার্চ + সিলেক্ট
  const input = q(DEFAULTS.assetInput);
  if (input) {
    input.focus();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(50);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, symbol);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(700);
    const item = qa(DEFAULTS.assetItem)
      .find(el => (el.textContent || '').toLowerCase().includes(symbol.toLowerCase()));
    if (item) { item.click(); await sleep(900); }
  }

  // ২) CALL/PUT বাটনে ক্লিক
  const btn = findButton(msg.direction);
  if (!btn) return { ok: false, error: 'button not found: ' + msg.direction };
  btn.click();
  return { ok: true, symbol: msg.symbol, direction: msg.direction, clickedAt: Date.now() };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'execute') return false;
  execute(msg)
    .then(res => {
      if (res.ok) {
        sendResponse({ ok: true });
        chrome.runtime.sendMessage({ type: 'executed', id: msg.id, symbol: msg.symbol, direction: msg.direction, clickedAt: res.clickedAt });
      } else {
        sendResponse({ ok: false, error: res.error });
        chrome.runtime.sendMessage({ type: 'error', id: msg.id, symbol: msg.symbol, message: res.error });
      }
    })
    .catch(err => {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
      chrome.runtime.sendMessage({ type: 'error', id: msg.id, symbol: msg.symbol, message: String((err && err.message) || err) });
    });
  return true; // async response
});
