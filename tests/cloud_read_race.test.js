const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/app.js'), 'utf8').split("document.getElementById('tradeForm')")[0];
const storage = new Map();
const requests = [];
const query = () => ({
  select() { return this; },
  eq(field, value) { if (field === 'user_id') this.userId = value; return this; },
  order() { return this; },
  range() { return new Promise(resolve => requests.push({ userId: this.userId, resolve })); }
});
const context = vm.createContext({
  console,
  supabase: { createClient: () => ({ from: query }) },
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value))
  },
  document: { getElementById: () => ({ innerText: '' }) },
  window: { location: {} }
});
vm.runInContext(source, context);
vm.runInContext('resetTickerFilter = () => {}; applyGlobalFilter = () => {}', context);
const run = code => vm.runInContext(code, context);
const row = id => ({ id, trade_date: '2026-09-01', trade_timestamp: 1788220800000, ticker: 'SPY', pnl: 10, currency: 'USD' });

(async () => {
  run("cloudUser = { id: 'A' }; activeLocalKey = 'local-A'; activeUpdatedKey = 'updated-A'; activePendingKey = 'pending-A'");
  const oldRead = run('syncFromCloud()');
  assert.equal(requests[0].userId, 'A');
  run("cloudUser = { id: 'B' }; activeLocalKey = 'local-B'; activeUpdatedKey = 'updated-B'; activePendingKey = 'pending-B'; trades = [{ id: 'local-B' }]");
  requests[0].resolve({ data: [row('cloud-A')], error: null });
  await oldRead;
  assert.equal(run('trades[0].id'), 'local-B', 'old account read must not replace the current account');
  assert.equal(storage.has('local-B'), false, 'old account read must not write into the new account cache');

  const currentRead = run('syncFromCloud()');
  assert.equal(requests[1].userId, 'B');
  run("localMutationVersion += 1; trades = [{ id: 'new-B' }]; enqueuePendingOperation({ type: 'upsert', id: 'new-B', trade: { id: 'new-B', dateStr: '2026-09-01', ticker: 'SPY', pnl: 12, currency: 'USD' } })");
  requests[1].resolve({ data: [row('stale-B')], error: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run('trades[0].id'), 'new-B', 'an in-flight read must not overwrite a local edit');
  assert.equal(requests.length, 3, 'a local edit during the read triggers a fresh read');
  requests[2].resolve({ data: [], error: null });
  // Stop before pending writes: this fake client only models reads.
  run('cloudUser = null');
  await currentRead;
  console.log('cloud read race tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
