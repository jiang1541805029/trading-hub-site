const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');
const testableSource = source.split("document.getElementById('tradeForm')")[0];
const storage = new Map();
const context = vm.createContext({
  console,
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value))
  },
  document: { getElementById: () => ({ innerText: '', classList: { add() {}, remove() {} } }) },
  window: { location: { href: '' } },
  setTimeout,
  clearTimeout
});

vm.runInContext(testableSource, context);
vm.runInContext("activePendingKey = 'pending-test'", context);

vm.runInContext(`
  enqueuePendingOperation({ type: 'upsert', id: 'a', trade: { id: 'a', dateStr: '2026-09-01', ticker: 'SPY', pnl: 10, currency: 'USD' } });
  enqueuePendingOperation({ type: 'upsert', id: 'a', trade: { id: 'a', dateStr: '2026-09-01', ticker: 'SPY', pnl: 20, currency: 'USD' } });
`, context);
assert.equal(JSON.parse(storage.get('pending-test')).length, 1, 'latest operation for the same trade should replace the previous one');

const merged = vm.runInContext(`applyPendingOperations(
  [{ id: 'a', dateStr: '2026-09-01', ticker: 'SPY', pnl: 5, currency: 'USD' }],
  readPendingOperations()
)`, context);
assert.equal(merged.length, 1);
assert.equal(merged[0].pnl, 20, 'pending upsert should win over stale cloud data');

vm.runInContext("enqueuePendingOperation({ type: 'delete', id: 'a' })", context);
const deleted = vm.runInContext("applyPendingOperations([{ id: 'a', dateStr: '2026-09-01', ticker: 'SPY', pnl: 5 }], readPendingOperations())", context);
assert.equal(deleted.length, 0, 'pending delete should prevent a stale cloud row from reappearing');

vm.runInContext("enqueuePendingOperation({ type: 'replace', trades: [] })", context);
assert.equal(JSON.parse(storage.get('pending-test')).length, 1, 'replace should supersede all earlier operations');

const normalizedPnl = vm.runInContext("normalizeTrade({ pnl: 'Infinity' }).pnl", context);
assert.equal(normalizedPnl, 0, 'non-finite P&L should not enter calculations');

console.log('sync logic tests passed');
