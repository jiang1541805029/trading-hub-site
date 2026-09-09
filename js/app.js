const KEY_V34 = 'tradingJournal_v34';
const LOCAL_UPDATED_KEY = 'tradingJournal_v34_updated_at';
const CLOUD_TABLE = 'trade_journal';
const LOGIN_URL = 'index.html';
const REQUIRE_AUTH = true;

const SUPABASE_URL = 'https://wqqpyozrvstrzarzjsru.supabase.co';
const SUPABASE_KEY = 'sb_publishable__5kVr0Gmnw3tVVv4e0Noyg_RRBexQ6c';
const supabaseClient = typeof supabase !== 'undefined'
  ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const TRADE_TAXONOMY = {
  '趋势交易': ['高1/低1', '高2/低2', '高3/低3', '均线回踩', '50%回调', '突破后回测'],
  '区间交易': ['区间高抛低吸', '区间边界反转', '区间内二次入场', '区间假突破'],
  '反转交易': ['双顶/双底', '三推反转', '楔形反转', '高潮反转'],
  '突破交易': ['区间突破', '趋势线突破', '旗形突破', '开盘区间突破'],
  '缺口交易': ['缺口回补', '缺口延续', '缺口反转']
};

const CURRENCIES = {
  USD: { symbol: '$', label: '美元' },
  CNY: { symbol: '¥', label: '人民币' },
  SGD: { symbol: 'S$', label: '新加坡元' }
};

let cloudUser = null;
let cloudSyncTimer = null;
let cloudSyncInFlight = false;
let chartInstance = null;
let chartMode = 'both';
let calDate = new Date();

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function inferCategory(pattern) {
  const value = String(pattern || '');
  for (const [category, patterns] of Object.entries(TRADE_TAXONOMY)) {
    if (patterns.includes(value)) return category;
  }
  if (/DT|DB|Wedge|Climax|REV/i.test(value)) return '反转交易';
  if (/FBO|TR/i.test(value)) return '区间交易';
  if (/BO|BP/i.test(value)) return '突破交易';
  return '趋势交易';
}

function normalizeTrade(t) {
  const dateStr = t.dateStr || (t.timestamp ? localDateString(new Date(t.timestamp)) : '');
  const pattern = t.tradePattern || t.strategy || '';
  return {
    ...t,
    id: t.id ? String(t.id) : uuidv4(),
    timestamp: Number.isFinite(Number(t.timestamp)) ? Number(t.timestamp) : (dateStr ? new Date(`${dateStr}T12:00:00`).getTime() : Date.now()),
    dateStr,
    ticker: String(t.ticker || '').toUpperCase(),
    orderType: t.orderType || '未记录',
    tradeCategory: t.tradeCategory || inferCategory(pattern),
    tradePattern: pattern || '未记录',
    currency: CURRENCIES[t.currency] ? t.currency : 'USD',
    pnl: Number.parseFloat(t.pnl) || 0,
    review: t.review || ''
  };
}

function loadLocalTrades() {
  const keys = [KEY_V34, 'tradingJournal_v33', 'tradingJournal_v32', 'tradingJournal_v31', 'tradingJournal_v27'];
  for (const key of keys) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      if (Array.isArray(value)) return value.map(normalizeTrade);
    } catch (_) { /* continue to older version */ }
  }
  return [];
}

let trades = loadLocalTrades();

function setAuthStatus(message) {
  const el = document.getElementById('authStatus');
  if (el) el.innerText = message || '';
}

function setSyncStatus(message) {
  const el = document.getElementById('syncStatus');
  if (el) el.innerText = message || '';
}

function updateAuthUI(user) {
  const button = document.getElementById('authLogoutBtn');
  if (user) {
    setAuthStatus(`已登录：${user.email || '用户'}`);
    button.classList.remove('hidden');
  } else {
    setAuthStatus('未登录');
    button.classList.add('hidden');
  }
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  window.location.href = LOGIN_URL;
}

async function fetchCloudData() {
  if (!cloudUser || !supabaseClient) return null;
  const { data, error } = await supabaseClient.from(CLOUD_TABLE)
    .select('data, updated_at').eq('user_id', cloudUser.id).maybeSingle();
  if (error) throw error;
  if (!data || !Array.isArray(data.data)) return null;
  return { trades: data.data.map(normalizeTrade), updatedAt: data.updated_at };
}

async function pushToCloud(reason = '正在同步……') {
  if (!cloudUser || !supabaseClient || cloudSyncInFlight) return false;
  cloudSyncInFlight = true;
  setSyncStatus(reason);
  try {
    const { error } = await supabaseClient.from(CLOUD_TABLE).upsert({
      user_id: cloudUser.id,
      data: trades,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw error;
    setSyncStatus(`已同步 ${new Date().toLocaleTimeString()}`);
    return true;
  } catch (error) {
    setSyncStatus(`同步失败：${error.message || '未知错误'}`);
    return false;
  } finally {
    cloudSyncInFlight = false;
  }
}

function parseTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

async function syncFromCloud() {
  if (!cloudUser || !supabaseClient) return;
  setSyncStatus('正在检查云端数据……');
  try {
    const cloud = await fetchCloudData();
    if (cloud && cloud.trades.length) {
      const cloudTime = parseTime(cloud.updatedAt);
      const localTime = parseTime(localStorage.getItem(LOCAL_UPDATED_KEY));
      if (!trades.length || cloudTime >= localTime) {
        trades = cloud.trades;
        localStorage.setItem(KEY_V34, JSON.stringify(trades));
        localStorage.setItem(LOCAL_UPDATED_KEY, cloud.updatedAt || new Date().toISOString());
        resetTickerFilter();
        applyGlobalFilter();
        setSyncStatus('已载入云端数据');
      } else {
        await pushToCloud('正在上传本地数据……');
      }
    } else if (trades.length) {
      await pushToCloud('正在上传本地数据……');
    } else {
      setSyncStatus('暂无云端数据');
    }
  } catch (error) {
    setSyncStatus(`同步失败：${error.message || '未知错误'}`);
  }
}

function scheduleCloudSync() {
  if (!cloudUser) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => pushToCloud(), 800);
}

async function initCloud() {
  if (!supabaseClient) {
    setAuthStatus('云端不可用');
    return;
  }
  const { data } = await supabaseClient.auth.getSession();
  cloudUser = data?.session?.user || null;
  updateAuthUI(cloudUser);
  if (cloudUser) await syncFromCloud();
  else if (REQUIRE_AUTH) return window.location.replace(LOGIN_URL);

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    cloudUser = session?.user || null;
    updateAuthUI(cloudUser);
    if (cloudUser) syncFromCloud();
    else if (REQUIRE_AUTH) window.location.replace(LOGIN_URL);
  });
}

function updatePatternOptions(selectedPattern = '') {
  const categoryEl = document.getElementById('tradeCategory');
  const patternEl = document.getElementById('tradePattern');
  const patterns = TRADE_TAXONOMY[categoryEl.value] || [];
  patternEl.innerHTML = patterns.map(p => `<option value="${p}">${p}</option>`).join('');
  if (selectedPattern && !patterns.includes(selectedPattern)) {
    const option = document.createElement('option');
    option.value = selectedPattern;
    option.textContent = `${selectedPattern}（旧记录）`;
    patternEl.appendChild(option);
  }
  if (selectedPattern) patternEl.value = selectedPattern;
}

function initTaxonomy() {
  const categoryEl = document.getElementById('tradeCategory');
  categoryEl.innerHTML = Object.keys(TRADE_TAXONOMY).map(c => `<option value="${c}">${c}</option>`).join('');
  updatePatternOptions();
}

function saveData() {
  localStorage.setItem(KEY_V34, JSON.stringify(trades));
  localStorage.setItem(LOCAL_UPDATED_KEY, new Date().toISOString());
  applyGlobalFilter();
  scheduleCloudSync();
}

document.getElementById('tradeForm').addEventListener('submit', event => {
  event.preventDefault();
  const editId = document.getElementById('editId').value.trim();
  const dateStr = document.getElementById('tradeDate').value;
  const trade = {
    id: editId || uuidv4(),
    timestamp: new Date(`${dateStr}T12:00:00`).getTime(),
    dateStr,
    ticker: document.getElementById('ticker').value.trim().toUpperCase(),
    orderType: document.getElementById('orderType').value,
    tradeCategory: document.getElementById('tradeCategory').value,
    tradePattern: document.getElementById('tradePattern').value,
    pnl: Number.parseFloat(document.getElementById('manualPnL').value) || 0,
    currency: document.getElementById('currency').value,
    review: document.getElementById('review').value.trim()
  };

  if (editId) {
    const index = trades.findIndex(t => t.id === editId);
    if (index >= 0) trades[index] = trade;
    else trades.unshift(trade);
    resetForm();
  } else {
    trades.unshift(trade);
    document.getElementById('manualPnL').value = '';
    document.getElementById('review').value = '';
  }
  saveData();
});

function getFilteredTrades() {
  const ticker = document.getElementById('calFilter').value;
  let start = document.getElementById('filterStart').value;
  let end = document.getElementById('filterEnd').value;
  if (start && end && start > end) {
    [start, end] = [end, start];
    document.getElementById('filterStart').value = start;
    document.getElementById('filterEnd').value = end;
  }
  return trades.filter(t => {
    if (ticker !== 'ALL' && t.ticker !== ticker) return false;
    if (start && t.dateStr < start) return false;
    if (end && t.dateStr > end) return false;
    return true;
  });
}

function applyGlobalFilter() {
  const filtered = getFilteredTrades();
  const currency = document.getElementById('currencyFilter').value;
  const currencyTrades = filtered.filter(t => t.currency === currency);
  renderStats(currencyTrades, currency);
  renderCalendar(currencyTrades, currency);
  renderGallery(filtered, document.getElementById('galleryFilterDate').value);
  refreshTickerFilter();
}

function refreshTickerFilter() {
  const select = document.getElementById('calFilter');
  const selected = select.value;
  const tickers = [...new Set(trades.map(t => t.ticker).filter(Boolean))].sort();
  select.innerHTML = '<option value="ALL">全部标的</option>' + tickers.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  select.value = tickers.includes(selected) || selected === 'ALL' ? selected : 'ALL';
}

function resetTickerFilter() {
  document.getElementById('calFilter').innerHTML = '<option value="ALL">全部标的</option>';
}

function buildDailySeries(dataset) {
  const pnlByDay = new Map();
  dataset.forEach(t => pnlByDay.set(t.dateStr, (pnlByDay.get(t.dateStr) || 0) + t.pnl));
  const days = [...pnlByDay.keys()].filter(Boolean).sort();
  let equity = 0;
  let wins = 0;
  let count = 0;
  const tradesByDay = new Map();
  [...dataset].sort((a, b) => a.timestamp - b.timestamp).forEach(t => {
    count += 1;
    if (t.pnl > 0) wins += 1;
    tradesByDay.set(t.dateStr, count ? wins / count * 100 : 0);
  });
  return {
    labels: days.map(d => d.slice(5).replace('-', '/')),
    equity: days.map(d => equity += pnlByDay.get(d) || 0),
    winRate: days.map(d => tradesByDay.get(d) || 0)
  };
}

function formatMoney(value, currency, sign = false) {
  const symbol = CURRENCIES[currency]?.symbol || '';
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${symbol}${Number(value || 0).toFixed(2)}`;
}

function renderStats(dataset, currency) {
  const wins = dataset.filter(t => t.pnl > 0);
  const losses = dataset.filter(t => t.pnl < 0);
  const net = dataset.reduce((sum, t) => sum + t.pnl, 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const series = buildDailySeries(dataset);
  const equityData = series.equity.length ? series.equity : [0];
  const labels = series.labels.length ? series.labels : [''];
  const winRateData = series.winRate.length ? series.winRate : [0];
  const ctx = document.getElementById('equityChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  const dark = document.documentElement.classList.contains('dark');
  const tickColor = dark ? '#94a3b8' : '#64748b';
  const datasets = [];
  if (chartMode !== 'wr') datasets.push({ label: '盈利', data: equityData, borderColor: net >= 0 ? '#00C805' : '#FF5000', backgroundColor: net >= 0 ? 'rgba(0,200,5,.12)' : 'rgba(255,80,0,.12)', fill: true, pointRadius: 0, tension: .15, yAxisID: 'yEquity' });
  if (chartMode !== 'equity') datasets.push({ label: '胜率', data: winRateData, borderColor: '#c084fc', pointRadius: 0, tension: .25, yAxisID: 'yWR' });
  chartInstance = new Chart(ctx, {
    type: 'line', data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: {
      x: { grid: { display: false }, ticks: { color: tickColor, maxTicksLimit: 6 } },
      yEquity: { display: chartMode !== 'wr', position: 'left', grid: { display: false }, ticks: { color: tickColor, callback: v => `${CURRENCIES[currency].symbol}${v}` } },
      yWR: { display: chartMode !== 'equity', position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { color: tickColor, callback: v => `${v}%` } }
    } }
  });
  const totalEl = document.getElementById('totalPnL');
  totalEl.innerText = formatMoney(net, currency, true);
  totalEl.className = `text-xl font-black font-mono ${net >= 0 ? 'text-[#00C805]' : 'text-[#FF5000]'}`;
  document.getElementById('statWR').innerText = dataset.length ? `${(wins.length / dataset.length * 100).toFixed(1)}%` : '0.0%';
  document.getElementById('statCount').innerText = dataset.length;
  document.getElementById('statAvgWin').innerText = formatMoney(avgWin, currency);
  document.getElementById('statAvgLoss').innerText = formatMoney(avgLoss, currency);

  const patternMap = {};
  dataset.forEach(t => {
    const key = t.tradePattern || '未记录';
    patternMap[key] ||= { count: 0, wins: 0 };
    patternMap[key].count += 1;
    if (t.pnl > 0) patternMap[key].wins += 1;
  });
  document.getElementById('stratStats').innerHTML = Object.entries(patternMap).sort((a, b) => b[1].count - a[1].count).map(([name, s]) => `<div class="flex justify-between text-[10px] py-1 border-b border-gray-100 dark:border-slate-700"><span>${escapeHtml(name)}</span><span class="text-blue-500 font-bold">${(s.wins / s.count * 100).toFixed(1)}% <span class="text-gray-400">(${s.count})</span></span></div>`).join('') || '<div class="text-[10px] text-gray-400">暂无数据</div>';
}

function setChartMode(mode) {
  chartMode = mode;
  ['equity', 'wr', 'both'].forEach(m => document.getElementById(`btnShow${m === 'wr' ? 'WR' : m[0].toUpperCase() + m.slice(1)}`).classList.toggle('active', m === mode));
  applyGlobalFilter();
}

function changeMonth(delta) {
  calDate.setMonth(calDate.getMonth() + delta);
  applyGlobalFilter();
}

function renderCalendar(dataset, currency) {
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const dayPnl = {};
  dataset.filter(t => t.dateStr.startsWith(prefix)).forEach(t => {
    const day = Number(t.dateStr.slice(-2));
    dayPnl[day] = (dayPnl[day] || 0) + t.pnl;
  });
  const monthPnl = Object.values(dayPnl).reduce((a, b) => a + b, 0);
  document.getElementById('calMonth').innerText = `${year}年${month + 1}月`;
  document.getElementById('calMonthPnL').innerText = formatMoney(monthPnl, currency, true);
  document.getElementById('calMonthPnL').className = `text-[9px] font-mono font-bold ${monthPnl >= 0 ? 'text-green-500' : 'text-red-500'}`;
  const start = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < start; i++) grid.appendChild(document.createElement('div'));
  for (let day = 1; day <= days; day++) {
    const cell = document.createElement('button');
    const dateStr = `${prefix}-${String(day).padStart(2, '0')}`;
    const pnl = dayPnl[day];
    cell.className = 'cal-cell bg-gray-50 dark:bg-slate-800 text-gray-400';
    if (pnl !== undefined) {
      cell.className += pnl >= 0 ? ' text-green-500 bg-green-500/10 font-bold' : ' text-red-500 bg-red-500/10 font-bold';
      cell.innerHTML = `<span>${day}</span><span class="text-[7px] font-mono">${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}</span>`;
    } else cell.innerText = day;
    cell.onclick = () => syncFilter(dateStr);
    grid.appendChild(cell);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function renderGallery(dataset, dateFilter) {
  const container = document.getElementById('galleryContainer');
  const list = dataset.filter(t => !dateFilter || t.dateStr === dateFilter).sort((a, b) => b.timestamp - a.timestamp);
  document.getElementById('recordCount').innerText = list.length;
  const groups = {};
  list.forEach(t => (groups[t.dateStr || '未知日期'] ||= []).push(t));
  container.innerHTML = Object.keys(groups).sort().reverse().map(date => {
    const cards = groups[date].map(t => `<button class="trade-card text-left" data-id="${escapeHtml(t.id)}"><div class="flex justify-between items-start gap-3"><div><div class="font-black text-lg">${escapeHtml(t.ticker)}</div><div class="text-[10px] text-gray-400 mt-1">${escapeHtml(t.orderType)} · ${escapeHtml(t.tradeCategory)}</div></div><div class="font-mono font-black ${t.pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF5000]'}">${formatMoney(t.pnl, t.currency, true)}</div></div><div class="mt-3 text-xs font-bold text-indigo-500">${escapeHtml(t.tradePattern)}</div>${t.review ? `<div class="mt-2 text-[11px] text-gray-500 line-clamp-2">${escapeHtml(t.review)}</div>` : ''}</button>`).join('');
    return `<section><div class="sticky top-0 bg-gray-100/90 dark:bg-[#0b1120]/90 backdrop-blur z-10 py-2 text-xs font-bold text-gray-500">${escapeHtml(date)}</div><div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">${cards}</div></section>`;
  }).join('') || '<div class="text-center text-gray-400 py-16">暂无交易记录</div>';
  container.querySelectorAll('.trade-card').forEach(card => card.onclick = () => openDetail(card.dataset.id));
}

function syncFilter(dateStr) {
  const input = document.getElementById('galleryFilterDate');
  input.value = input.value === dateStr ? '' : dateStr;
  document.getElementById('currentFilterDisplay').innerText = input.value;
  applyGlobalFilter();
}

function clearDateFilter() {
  document.getElementById('galleryFilterDate').value = '';
  document.getElementById('currentFilterDisplay').innerText = '';
  applyGlobalFilter();
}

function clearRangeFilter() {
  document.getElementById('filterStart').value = '';
  document.getElementById('filterEnd').value = '';
  applyGlobalFilter();
}

function openDetail(id) {
  const t = trades.find(item => item.id === String(id));
  if (!t) return;
  document.getElementById('mDate').innerText = t.dateStr;
  document.getElementById('mTicker').innerText = t.ticker;
  document.getElementById('mOrderType').innerText = t.orderType;
  document.getElementById('mTradeCategory').innerText = t.tradeCategory;
  document.getElementById('mTradePattern').innerText = t.tradePattern;
  const pnl = document.getElementById('mPnL');
  pnl.innerText = formatMoney(t.pnl, t.currency, true);
  pnl.className = `font-mono font-black text-2xl ${t.pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF5000]'}`;
  document.getElementById('mReview').innerText = t.review || '暂无复盘内容';
  document.getElementById('btnEdit').onclick = () => { closeModal(); loadEdit(t.id); };
  document.getElementById('btnDel').onclick = () => {
    if (confirm('确定永久删除这条交易记录吗？')) {
      trades = trades.filter(item => item.id !== t.id);
      saveData();
      closeModal();
    }
  };
  document.getElementById('detailModal').classList.remove('hidden');
}

function loadEdit(id) {
  const t = trades.find(item => item.id === String(id));
  if (!t) return;
  document.getElementById('editId').value = t.id;
  document.getElementById('tradeDate').value = t.dateStr;
  document.getElementById('ticker').value = t.ticker;
  document.getElementById('orderType').value = ['止损单', '限价单', '市价单'].includes(t.orderType) ? t.orderType : '市价单';
  document.getElementById('tradeCategory').value = t.tradeCategory;
  updatePatternOptions(t.tradePattern);
  document.getElementById('manualPnL').value = t.pnl;
  document.getElementById('currency').value = t.currency;
  document.getElementById('review').value = t.review;
  document.getElementById('formTitle').innerText = '✏️ 编辑交易';
  document.getElementById('cancelEditBtn').classList.remove('hidden');
  document.getElementById('submitBtn').innerText = '更新交易';
  document.getElementById('formSection').classList.add('editing-active');
}

function resetForm() {
  document.getElementById('tradeForm').reset();
  document.getElementById('editId').value = '';
  document.getElementById('tradeDate').value = localDateString();
  document.getElementById('formTitle').innerText = '✏️ 记录交易';
  document.getElementById('cancelEditBtn').classList.add('hidden');
  document.getElementById('submitBtn').innerText = '保存交易';
  document.getElementById('formSection').classList.remove('editing-active');
  updatePatternOptions();
}

function closeModal() {
  document.getElementById('detailModal').classList.add('hidden');
}

function clearAllData() {
  if (!confirm(cloudUser ? '确定清空全部记录吗？云端数据也会同步清空。' : '确定清空全部记录吗？')) return;
  trades = [];
  saveData();
}

function toggleTheme() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  applyGlobalFilter();
}

function exportData() {
  const link = document.createElement('a');
  link.href = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(trades, null, 2))}`;
  link.download = `Trading_Hub_${localDateString()}.json`;
  link.click();
}

function importData(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const data = JSON.parse(event.target.result);
      if (!Array.isArray(data)) throw new Error('格式错误');
      trades = data.map(normalizeTrade);
      resetTickerFilter();
      saveData();
      alert(`成功恢复 ${trades.length} 条记录`);
    } catch (_) {
      alert('恢复失败：请选择正确的 JSON 备份文件');
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file);
}

if (localStorage.getItem('theme') !== 'light') document.documentElement.classList.add('dark');
else document.documentElement.classList.remove('dark');
initTaxonomy();
document.getElementById('tradeDate').value = localDateString();
applyGlobalFilter();
initCloud();
