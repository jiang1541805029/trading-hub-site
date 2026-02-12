// UNIFIED KEY
    const KEY_V34 = 'tradingJournal_v34';
    const LOCAL_UPDATED_KEY = 'tradingJournal_v34_updated_at';
    const CLOUD_TABLE = 'trade_journal';
    const LOGIN_URL = 'index.html';
    const REQUIRE_AUTH = true;

    const SUPABASE_URL = 'https://wqqpyozrvstrzarzjsru.supabase.co';
    const SUPABASE_KEY = 'sb_publishable__5kVr0Gmnw3tVVv4e0Noyg_RRBexQ6c';
    const supabaseClient = (typeof supabase !== 'undefined')
      ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
      : null;

    let cloudUser = null;
    let cloudSyncTimer = null;
    let cloudSyncInFlight = false;

    // 1. DATA LOAD
    let trades = JSON.parse(localStorage.getItem(KEY_V34) || 'null');

    // COMPATIBILITY: If v34 missing, load v33/v32/v27 and SAVE immediately
    if (!Array.isArray(trades)) {
      const v33 = JSON.parse(localStorage.getItem('tradingJournal_v33') || 'null');
      const v32 = JSON.parse(localStorage.getItem('tradingJournal_v32') || 'null');
      const v31 = JSON.parse(localStorage.getItem('tradingJournal_v31') || 'null');
      const v27 = JSON.parse(localStorage.getItem('tradingJournal_v27') || 'null');

      // Fallback chain
      let raw = v33 || v32 || v31 || v27 || [];

      if (Array.isArray(raw)) {
        trades = raw.map(t => {
          if (!t.id || typeof t.id === 'number') t.id = uuidv4();
          else t.id = String(t.id);
          t.pnl = parseFloat(t.pnl) || 0;
          if (!t.tradeType) t.tradeType = '系统单';
          return t;
        });
        localStorage.setItem(KEY_V34, JSON.stringify(trades));
        if (!localStorage.getItem(LOCAL_UPDATED_KEY)) {
          localStorage.setItem(LOCAL_UPDATED_KEY, new Date().toISOString());
        }
      } else {
        trades = [];
      }
    }

    let isDarkMode = localStorage.getItem('theme') === 'dark';
    let chartInstance = null;
    let pastedImage = null;
    let calDate = new Date();
    let chartMode = 'both';

    function uuidv4() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    function toNum(v) {
      if (v === null || v === undefined) return NaN;
      const n = parseFloat(String(v).replace(/[, ]+/g, '').trim());
      return Number.isFinite(n) ? n : NaN;
    }

    function calcRR(entry, stop, target) {
      const e = toNum(entry), s = toNum(stop), t = toNum(target);
      if (![e, s, t].every(Number.isFinite)) return '-';
      const risk = Math.abs(e - s);
      const reward = Math.abs(t - e);
      if (risk <= 0) return '-';
      const rr = reward / risk;
      if (!Number.isFinite(rr)) return '-';
      return rr.toFixed(2);
    }

    const PROFIT_TARGET_OPTIONS = ['2倍盈亏比', '1倍盈亏比', '剥头皮', '其它'];

    function normalizeProfitTarget(value) {
      if (value === null || value === undefined || value === '') return '';
      const v = String(value).trim();
      if (PROFIT_TARGET_OPTIONS.includes(v)) return v;
      if (/scalp/i.test(v) || v.includes('剥头皮')) return '剥头皮';
      const num = parseFloat(v);
      if (Number.isFinite(num)) {
        if (Math.abs(num - 2) < 0.15) return '2倍盈亏比';
        if (Math.abs(num - 1) < 0.15) return '1倍盈亏比';
      }
      return '其它';
    }

    function normalizeManualExit(value, emptyFallback) {
      if (value === true) return '是';
      if (value === false) return '否';
      if (value === '是' || value === '否') return value;
      if (value === null || value === undefined || value === '') return emptyFallback;
      return String(value);
    }

    function setAuthStatus(msg) {
      const el = document.getElementById('authStatus');
      if (el) el.innerText = msg || '';
    }

    function setSyncStatus(msg) {
      const el = document.getElementById('syncStatus');
      if (el) el.innerText = msg || '';
    }

    function updateAuthUI(user) {
      const logoutBtn = document.getElementById('authLogoutBtn');
      if (!logoutBtn) return;

      if (user) {
        setAuthStatus(`Signed in: ${user.email || 'user'}`);
        logoutBtn.classList.remove('hidden');
      } else {
        setAuthStatus('Not signed in');
        logoutBtn.classList.add('hidden');
      }
    }

    function resetTickerFilter() {
      const sel = document.getElementById('calFilter');
      if (sel) sel.innerHTML = '<option value="ALL">All Tickers</option>';
    }

    async function signOut() {
      if (!supabaseClient) return;
      await supabaseClient.auth.signOut();
      window.location.href = LOGIN_URL;
    }

    async function fetchCloudData() {
      if (!cloudUser || !supabaseClient) return null;
      const { data, error } = await supabaseClient
        .from(CLOUD_TABLE)
        .select('data, updated_at')
        .eq('user_id', cloudUser.id)
        .maybeSingle();
      if (error) throw error;
      if (!data || !Array.isArray(data.data)) return null;
      return { trades: data.data, updatedAt: data.updated_at };
    }

    async function pushToCloud(reason) {
      if (!cloudUser || !supabaseClient) return false;
      if (cloudSyncInFlight) return false;
      cloudSyncInFlight = true;
      setSyncStatus(reason || 'Syncing...');
      const payload = {
        user_id: cloudUser.id,
        data: trades,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabaseClient
        .from(CLOUD_TABLE)
        .upsert(payload, { onConflict: 'user_id' });
      cloudSyncInFlight = false;
      if (error) {
        setSyncStatus('Sync failed: ' + error.message);
        return false;
      }
      setSyncStatus('Synced at ' + new Date().toLocaleTimeString());
      return true;
    }

    function parseTime(value) {
      const t = Date.parse(value || '');
      return Number.isFinite(t) ? t : 0;
    }

    async function syncFromCloud() {
      if (!cloudUser || !supabaseClient) return;
      setSyncStatus('Checking cloud...');
      try {
        const cloud = await fetchCloudData();
        const cloudTrades = cloud ? cloud.trades : null;
        if (cloudTrades && cloudTrades.length) {
          const cloudUpdated = parseTime(cloud.updatedAt);
          const localUpdated = parseTime(localStorage.getItem(LOCAL_UPDATED_KEY));

          if (!trades.length || cloudUpdated >= localUpdated) {
            trades = cloudTrades;
            localStorage.setItem(KEY_V34, JSON.stringify(trades));
            localStorage.setItem(LOCAL_UPDATED_KEY, cloud.updatedAt || new Date().toISOString());
            resetTickerFilter();
            applyGlobalFilter();
            setSyncStatus('Loaded from cloud.');
          } else {
            await pushToCloud('Uploading local data...');
          }
        } else {
          if (trades.length) await pushToCloud('Uploading local data...');
          else setSyncStatus('No cloud data.');
        }
      } catch (err) {
        setSyncStatus('Sync failed: ' + (err && err.message ? err.message : 'unknown error'));
      }
    }

    function scheduleCloudSync() {
      if (!cloudUser) return;
      if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
      cloudSyncTimer = setTimeout(() => {
        pushToCloud('Syncing...');
      }, 800);
    }

    async function initCloud() {
      if (!supabaseClient) {
        setAuthStatus('Cloud disabled');
        return;
      }
      const { data } = await supabaseClient.auth.getSession();
      cloudUser = data && data.session ? data.session.user : null;
      updateAuthUI(cloudUser);
      if (cloudUser) {
        await syncFromCloud();
      } else if (REQUIRE_AUTH) {
        window.location.replace(LOGIN_URL);
        return;
      }

      supabaseClient.auth.onAuthStateChange((_event, session) => {
        cloudUser = session ? session.user : null;
        updateAuthUI(cloudUser);
        if (cloudUser) syncFromCloud();
        else {
          setSyncStatus('Signed out.');
          if (REQUIRE_AUTH) window.location.replace(LOGIN_URL);
        }
      });
    }

    document.getElementById('tradeDate').valueAsDate = new Date();
    applyTheme();
    applyGlobalFilter();
    setupPaste();
    initCloud();

    function setChartMode(mode) {
      chartMode = mode;
      document.getElementById('btnShowEquity').classList.toggle('active', mode === 'equity');
      document.getElementById('btnShowWR').classList.toggle('active', mode === 'wr');
      document.getElementById('btnShowBoth').classList.toggle('active', mode === 'both');
      applyGlobalFilter();
    }

    function getTradeDateStr(t) {
      if (t.dateStr) return t.dateStr;
      if (typeof t.timestamp === 'number' && !Number.isNaN(t.timestamp)) {
        const d = new Date(t.timestamp);
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
      }
      return '';
    }

    function applyGlobalFilter() {
      const filterTicker = document.getElementById('calFilter').value;
      const filterTarget = document.getElementById('targetFilter').value;
      const filterDate = document.getElementById('galleryFilterDate').value;
      const filterStartRaw = document.getElementById('filterStart').value;
      const filterEndRaw = document.getElementById('filterEnd').value;
      let filterStart = filterStartRaw;
      let filterEnd = filterEndRaw;
      if (filterStart && filterEnd && filterStart > filterEnd) {
        const tmp = filterStart;
        filterStart = filterEnd;
        filterEnd = tmp;
        document.getElementById('filterStart').value = filterStart;
        document.getElementById('filterEnd').value = filterEnd;
      }

      let statsTrades = trades.filter(t => {
        const tradeDate = getTradeDateStr(t);
        if ((filterStart || filterEnd) && !tradeDate) return false;
        if (filterStart && tradeDate < filterStart) return false;
        if (filterEnd && tradeDate > filterEnd) return false;
        if (filterTicker !== 'ALL' && t.ticker !== filterTicker) return false;
        if (filterTarget !== 'ALL') {
          const target = normalizeProfitTarget(t.profitTarget || t.rrTarget || t.rr || '');
          if (target !== filterTarget) return false;
        }
        return true;
      });

      renderStats(statsTrades);
      renderCalendar(statsTrades);
      renderGallery(statsTrades, filterDate);

      const tickers = [...new Set(trades.map(t => t.ticker).filter(Boolean))].sort();
      const sel = document.getElementById('calFilter');
      if (sel.options.length <= 1) {
        sel.innerHTML = '<option value="ALL">All Tickers</option>' + tickers.map(t => `<option value="${t}">${t}</option>`).join('');
        sel.value = filterTicker;
      }
    }

    // --- SUBMIT LOGIC ---
    document.getElementById('tradeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const editIdVal = document.getElementById('editId').value;
      const isEditing = editIdVal && editIdVal.trim() !== "";
      const tvLink = document.getElementById('tvLink').value;

      // IMAGE PERSISTENCE
      let img = pastedImage;
      if (isEditing && !img) {
        const old = trades.find(t => t.id === editIdVal);
        if (old && old.image) img = old.image;
      }
      // Fallback to TV Link as image if no paste
      if (!img && tvLink && tvLink.includes('http')) {
        img = tvLink;
      }

      const rEl = document.querySelector('input[name="r"]:checked');
      const profitTarget = document.getElementById('profitTarget').value;
      const manualExit = document.getElementById('manualExit').value;

      const oldTrade = isEditing ? trades.find(t => t.id === editIdVal) : null;
      const legacyEntry = oldTrade ? (oldTrade.entry || '') : '';
      const legacyStop = oldTrade ? (oldTrade.stop || '') : '';
      const legacyTarget = oldTrade ? (oldTrade.target || '') : '';
      const legacyRR = (oldTrade && oldTrade.rr && oldTrade.rr !== '-') ? oldTrade.rr : calcRR(legacyEntry, legacyStop, legacyTarget);

      const trade = {
        id: isEditing ? editIdVal : uuidv4(),
        timestamp: new Date(document.getElementById('tradeDate').value).getTime(),
        dateStr: document.getElementById('tradeDate').value,
        ticker: (document.getElementById('ticker').value || '').toUpperCase(),
        direction: document.getElementById('direction').value,
        strategy: document.getElementById('strategy').value,
        entry: legacyEntry,
        stop: legacyStop,
        target: legacyTarget,
        profitTarget: profitTarget,
        manualExit: manualExit,
        tradeType: document.getElementById('tradeType').value,
        pnl: parseFloat(document.getElementById('manualPnL').value) || 0,
        setup: document.getElementById('setup').value,
        review: document.getElementById('review').value,
        rating: rEl ? parseInt(rEl.value) : 0,
        tvLink: tvLink,
        image: img,
        rr: legacyRR
      };

      if (isEditing) {
        const idx = trades.findIndex(t => t.id === editIdVal);
        if (idx !== -1) trades[idx] = trade;
        else trades.unshift(trade);

        document.getElementById('galleryFilterDate').value = '';
        document.getElementById('currentFilterDisplay').innerText = '';
        resetForm();
      } else {
        trades.unshift(trade);
        // Keep date/ticker for ease of use? No, reset logic requested.
        document.getElementById('manualPnL').value = '';
        document.getElementById('setup').value = '';
        document.getElementById('review').value = '';
        document.getElementById('imgMsg').innerText = "📸 粘贴 (Ctrl+V)";
        document.getElementById('imgMsg').className = "text-[10px] text-gray-400 group-hover:text-blue-500 font-bold";
        pastedImage = null;
      }
      saveData();
    });

    function buildDailySeries(dataset) {
      const pnlByDay = new Map();
      dataset.forEach(t => {
        if (!t.dateStr) return;
        pnlByDay.set(t.dateStr, (pnlByDay.get(t.dateStr) || 0) + (parseFloat(t.pnl) || 0));
      });
      const days = Array.from(pnlByDay.keys()).sort();
      let equityAcc = 0;
      const equity = days.map(d => (equityAcc += (pnlByDay.get(d) || 0)));

      // WR
      const tradesSorted = [...dataset].sort((a, b) => a.timestamp - b.timestamp);
      let wins = 0, total = 0;
      const endWRByDay = new Map();
      tradesSorted.forEach(t => {
        total++;
        if ((parseFloat(t.pnl) || 0) > 0) wins++;
        if (t.dateStr) endWRByDay.set(t.dateStr, (wins / total) * 100);
      });
      let lastWR = 0;
      const wr = days.map(d => {
        if (endWRByDay.has(d)) lastWR = endWRByDay.get(d);
        return Number.isFinite(lastWR) ? lastWR : 0;
      });

      const labels = days.map(d => d.slice(5).replace('-', '/'));
      return { labels, equity, wr, days };
    }

    function renderStats(dataset) {
      const totalWins = dataset.filter(t => (parseFloat(t.pnl) || 0) > 0).length;
      const sumWins = dataset.filter(t => (parseFloat(t.pnl) || 0) > 0).reduce((a, b) => a + parseFloat(b.pnl), 0);
      const sumLosses = dataset.filter(t => (parseFloat(t.pnl) || 0) < 0).reduce((a, b) => a + parseFloat(b.pnl), 0);
      const totalLosses = dataset.filter(t => (parseFloat(t.pnl) || 0) < 0).length;

      const net = sumWins + sumLosses;
      const avgWin = totalWins > 0 ? (sumWins / totalWins) : 0;
      const avgLoss = totalLosses > 0 ? (sumLosses / totalLosses) : 0;

      const { labels, equity, wr } = buildDailySeries(dataset);

      let safeEquity = (equity && equity.length) ? equity : [0];
      const minEq = Math.min(...safeEquity);
      const maxEq = Math.max(...safeEquity);

      // SMART Y-AXIS (Multiples of 5/10/25/50...)
      let range = maxEq - minEq;
      if (range === 0) range = 100;

      // Nice steps logic
      let stepSize = 5;
      if (range > 50) stepSize = 10;
      if (range > 100) stepSize = 25;
      if (range > 250) stepSize = 50;
      if (range > 500) stepSize = 100;
      if (range > 1000) stepSize = 250;
      if (range > 2500) stepSize = 500;

      // Expand to nearest step
      const yMin = Math.floor(minEq / stepSize) * stepSize - stepSize;
      const yMax = Math.ceil(maxEq / stepSize) * stepSize + stepSize;

      const ctx = document.getElementById('equityChart').getContext('2d');
      if (chartInstance) chartInstance.destroy();

      const dark = document.documentElement.classList.contains('dark');
      const tickColor = dark ? 'rgba(203,213,225,0.75)' : 'rgba(71,85,105,0.75)';
      const lineColor = net >= 0 ? '#00C805' : '#FF5000';
      const gradEquity = ctx.createLinearGradient(0, 0, 0, 260);
      if (net >= 0) {
        gradEquity.addColorStop(0, 'rgba(0, 200, 5, 0.25)');
        gradEquity.addColorStop(1, 'rgba(0, 200, 5, 0.0)');
      } else {
        gradEquity.addColorStop(0, 'rgba(255, 80, 0, 0.25)');
        gradEquity.addColorStop(1, 'rgba(255, 80, 0, 0.0)');
      }

      const dsEquity = {
        label: 'Equity',
        data: safeEquity,
        borderColor: lineColor,
        backgroundColor: gradEquity,
        borderWidth: 2,
        fill: 'start',
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.1,
        yAxisID: 'yEquity'
      };
      const dsWR = {
        label: 'WinRate',
        data: wr,
        borderColor: '#c084fc',
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.35,
        borderDash: [],
        yAxisID: 'yWR'
      };

      let datasets = [];
      if (chartMode === 'equity') datasets = [dsEquity];
      else if (chartMode === 'wr') datasets = [dsWR];
      else datasets = [dsEquity, dsWR];

      chartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { left: 6, right: 10, top: 4, bottom: 2 } },
          plugins: { legend: { display: false } },
          scales: {
            x: { display: true, grid: { display: false }, ticks: { color: tickColor, maxTicksLimit: 7 } },
            yEquity: {
              display: (chartMode !== 'wr'),
              position: 'left',
              grid: { display: false },
              border: { display: false },
              min: yMin, max: yMax,
              ticks: {
                stepSize: stepSize,
                maxTicksLimit: 10,
                color: tickColor,
                callback: (v) => '$' + Math.round(v)
              }
            },
            yWR: {
              display: (chartMode !== 'equity'),
              position: 'right',
              min: 0, max: 100,
              grid: { display: false },
              border: { display: false },
              ticks: { stepSize: 20, color: tickColor, callback: (v) => v + '%' }
            }
          }
        }
      });

      document.getElementById('totalPnL').innerText = (net >= 0 ? '+' : '') + '$' + net.toFixed(2);
      document.getElementById('totalPnL').className = `text-lg font-black font-mono ${net >= 0 ? 'text-[#00C805]' : 'text-[#FF5000]'}`;
      document.getElementById('statWR').innerText = dataset.length ? ((totalWins / dataset.length) * 100).toFixed(2) + '%' : '0.00%';
      document.getElementById('statCount').innerText = dataset.length;
      document.getElementById('statAvgWin').innerText = '$' + avgWin.toFixed(2);
      document.getElementById('statAvgLoss').innerText = '$' + avgLoss.toFixed(2);

      const stratMap = {};
      dataset.forEach(t => {
        const s = t.strategy || 'Unset';
        if (!stratMap[s]) stratMap[s] = { c: 0, w: 0 };
        stratMap[s].c++;
        if ((parseFloat(t.pnl) || 0) > 0) stratMap[s].w++;
      });
      const stratHtml = Object.keys(stratMap).sort((a, b) => stratMap[b].c - stratMap[a].c).map(k => {
        const wrp = ((stratMap[k].w / stratMap[k].c) * 100).toFixed(1);
        return `<div class="flex justify-between text-[10px] py-1 border-b border-gray-100 dark:border-slate-700">
        <span class="text-gray-500 font-medium truncate max-w-[120px]">${k}</span>
        <span><span class="font-bold text-blue-500">${wrp}%</span> <span class="text-gray-400 ml-1">(${stratMap[k].c})</span></span>
      </div>`;
      }).join('');
      document.getElementById('stratStats').innerHTML = stratHtml || '<div class="text-[10px] text-gray-400">No data</div>';
    }

    function changeMonth(delta) {
      calDate.setMonth(calDate.getMonth() + delta);
      applyGlobalFilter();
    }

    function renderCalendar(dataset) {
      const grid = document.getElementById('calGrid');
      grid.innerHTML = '';
      const currentSelectedDate = document.getElementById('galleryFilterDate').value;
      const m = calDate.getMonth();
      const y = calDate.getFullYear();
      const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

      let monthPnL = 0;
      dataset.forEach(t => {
        const d = new Date(t.timestamp);
        if (d.getMonth() === m && d.getFullYear() === y) monthPnL += (parseFloat(t.pnl) || 0);
      });

      document.getElementById('calMonth').innerText = `${monthNames[m]} ${y}`;
      document.getElementById('calMonthPnL').innerText = `(${(monthPnL >= 0 ? '+' : '')}$${monthPnL.toFixed(2)})`;
      document.getElementById('calMonthPnL').className = `text-[9px] font-mono font-bold ${monthPnL >= 0 ? 'text-green-500' : 'text-red-500'}`;

      const days = new Date(y, m + 1, 0).getDate();
      const start = new Date(y, m, 1).getDay();
      const map = {};
      dataset.forEach(t => {
        const d = new Date(t.timestamp);
        if (d.getMonth() === m && d.getFullYear() === y) {
          const day = d.getDate();
          map[day] = (map[day] || 0) + (parseFloat(t.pnl) || 0);
        }
      });

      for (let i = 0; i < start; i++) grid.appendChild(document.createElement('div'));
      for (let i = 1; i <= days; i++) {
        const cell = document.createElement('div');
        const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        let base = "cal-cell bg-gray-50 dark:bg-slate-800 text-gray-400 border border-transparent";
        if (dateStr === currentSelectedDate) base += " selected";
        if (map[i] !== undefined) {
          const pnl = map[i];
          cell.className = base + (pnl >= 0 ? " bg-green-500/10 text-green-500 font-bold border-green-500/20" : " bg-red-500/10 text-red-500 font-bold border-red-500/20");
          cell.title = `${dateStr}\nPnL: ${(pnl >= 0 ? '+' : '')}${pnl.toFixed(2)}`;
          // Fix: Show 2 decimals on calendar
          cell.innerHTML = `<span>${i}</span><span class="text-[7px] opacity-90 font-mono">${(pnl >= 0 ? '+' : '')}${pnl.toFixed(2)}</span>`;
        } else {
          cell.className = base;
          cell.innerText = i;
        }
        cell.onclick = () => syncFilter(dateStr);
        grid.appendChild(cell);
      }
    }

    function syncFilter(dateStr) {
      const picker = document.getElementById('galleryFilterDate');
      picker.value = (picker.value === dateStr) ? '' : dateStr;
      document.getElementById('currentFilterDisplay').innerText = picker.value;
      applyGlobalFilter();
    }

    function renderGallery(dataset, dateFilter) {
      const container = document.getElementById('galleryContainer');
      container.innerHTML = '';
      let list = dataset.filter(t => {
        if (dateFilter && t.dateStr !== dateFilter) return false;
        return true;
      });
      list.sort((a, b) => b.timestamp - a.timestamp);
      document.getElementById('recordCount').innerText = list.length;

      const groups = {};
      list.forEach(t => {
        const d = t.dateStr || 'Unknown Date';
        if (!groups[d]) groups[d] = [];
        groups[d].push(t);
      });
      const sortedDates = Object.keys(groups).sort().reverse();

      sortedDates.forEach(date => {
        const header = document.createElement('div');
        header.className = "sticky top-0 bg-gray-100/90 dark:bg-[#0b1120]/90 backdrop-blur z-10 py-2 px-1 border-b border-gray-200 dark:border-slate-800 mb-2";
        let label = (date === new Date().toISOString().slice(0, 10)) ? "Today" : date;
        header.innerHTML = `<h3 class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">${label}</h3>`;
        container.appendChild(header);
        const grid = document.createElement('div');
        grid.className = "grid grid-cols-3 gap-4 mb-6";
        groups[date].forEach(t => {
          const pnl = parseFloat(t.pnl) || 0;
          const pnlClass = pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF5000]';
          const img = t.image || 'https://via.placeholder.com/400x200/1e293b/334155?text=No+Preview';
          const hasReview = (t.review && t.review.length > 0) ? '📝' : '';
          const card = document.createElement('div');
          card.className = "bg-white dark:bg-[#151e32] rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden cursor-pointer card-hover shadow-sm flex flex-col";

          // --- SAFE CLICK HANDLER ---
          card.dataset.id = t.id;
          card.onclick = function () { openDetail(this.dataset.id); };

          card.innerHTML = `
          <div class="h-24 bg-gray-100 relative overflow-hidden group shrink-0">
            <img src="${img}" class="w-full h-full object-cover opacity-90 group-hover:scale-105 transition duration-500">
            <div class="absolute top-1 right-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">${t.ticker || ''}</div>
          </div>
          <div class="p-3 flex flex-col flex-1 gap-1">
            <div class="flex justify-between items-center">
              <span class="text-[10px] font-bold uppercase text-gray-500 tracking-wider truncate w-24">${t.strategy || 'UNK'}</span>
              <div class="flex gap-1 items-center"><span class="text-[10px]">${hasReview}</span></div>
            </div>
            <div class="flex justify-between items-end mt-1">
              <span class="font-mono font-black text-sm ${pnlClass}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
              <div class="text-[9px] text-yellow-500 tracking-widest">${'★'.repeat(t.rating || 0)}</div>
            </div>
          </div>`;
          grid.appendChild(card);
        });
        container.appendChild(grid);
      });
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
      const t = trades.find(i => String(i.id) === String(id));
      if (!t) return;
      const pnl = parseFloat(t.pnl) || 0;
      document.getElementById('mTicker').innerText = t.ticker || '';
      document.getElementById('mDate').innerText = t.dateStr || '';
      document.getElementById('mDir').innerText = t.direction || '';
      document.getElementById('mStrat').innerText = t.strategy || '';
      document.getElementById('mType').innerText = t.tradeType || '系统单';
      document.getElementById('mPnL').innerText = (pnl >= 0 ? '+' : '') + pnl.toFixed(2);
      document.getElementById('mPnL').className = `font-mono font-black text-2xl ${pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF5000]'}`;
      const displayTarget = t.profitTarget || ((t.rr && t.rr !== '-') ? t.rr : calcRR(t.entry, t.stop, t.target));
      document.getElementById('mProfitTarget').innerText = displayTarget || '-';
      document.getElementById('mManualExit').innerText = normalizeManualExit(t.manualExit, '-');
      document.getElementById('mSetup').innerText = t.setup || '';
      document.getElementById('mReview').innerText = t.review || '';
      document.getElementById('mImg').src = t.image || '';
      const l = document.getElementById('mTvLink');
      if (t.tvLink && t.tvLink.includes('http')) { l.href = t.tvLink; l.classList.remove('hidden'); } else l.classList.add('hidden');

      document.getElementById('btnEdit').dataset.id = t.id;
      document.getElementById('btnEdit').onclick = function () { closeModal(); loadEdit(this.dataset.id); };

      document.getElementById('btnDel').dataset.id = t.id;
      document.getElementById('btnDel').onclick = function () {
        if (confirm('Delete Permanently?')) {
          trades = trades.filter(x => String(x.id) !== String(this.dataset.id));
          saveData();
          closeModal();
        }
      };
      document.getElementById('detailModal').classList.remove('hidden');
    }

    // --- CRITICAL FIX: EDIT MODE POPULATION ---
    function loadEdit(id) {
      const t = trades.find(i => String(i.id) === String(id));
      if (!t) return;

      document.getElementById('editId').value = String(t.id);
      document.getElementById('formTitle').innerText = "✏️ EDITING MODE";
      document.getElementById('cancelEditBtn').classList.remove('hidden');
      document.getElementById('submitBtn').innerText = "UPDATE TRADE";
      document.getElementById('submitBtn').classList.add('bg-yellow-600', 'hover:bg-yellow-500');
      document.getElementById('submitBtn').classList.remove('bg-blue-600', 'hover:bg-blue-500');
      document.getElementById('formSection').classList.add('editing-active');

      // SAFE POPULATE (with fallbacks)
      document.getElementById('tradeDate').value = t.dateStr || '';
      document.getElementById('ticker').value = t.ticker || '';
      document.getElementById('direction').value = t.direction || 'Long';
      document.getElementById('strategy').value = t.strategy || '';
      const targetFromTrade = t.profitTarget || t.rrTarget || t.rr || '';
      document.getElementById('profitTarget').value = normalizeProfitTarget(targetFromTrade) || '其它';
      document.getElementById('manualExit').value = normalizeManualExit(t.manualExit, '否');

      // Removed QUANTITY population to prevent crash (element does not exist)

      document.getElementById('manualPnL').value = (parseFloat(t.pnl) || 0).toFixed(2);
      document.getElementById('tradeType').value = t.tradeType || '系统单';
      document.getElementById('setup').value = t.setup || '';
      document.getElementById('review').value = t.review || '';
      document.getElementById('tvLink').value = t.tvLink || '';

      const stars = Array.from(document.getElementsByName('r'));
      stars.forEach(s => { s.checked = (Number(s.value) === Number(t.rating || 0)); });

      if (t.image && !t.image.includes('http')) {
        pastedImage = t.image;
        document.getElementById('imgMsg').innerText = "Image Loaded (Ready)";
        document.getElementById('imgMsg').className = "text-[10px] text-green-500 font-bold";
      } else {
        pastedImage = null;
        document.getElementById('imgMsg').innerText = "📸 粘贴 (Ctrl+V)";
        document.getElementById('imgMsg').className = "text-[10px] text-gray-400 group-hover:text-blue-500 font-bold";
      }
    }

    function resetForm() {
      document.getElementById('tradeForm').reset();
      document.getElementById('editId').value = '';
      document.getElementById('formTitle').innerText = "✏️ LOG TRADE";
      document.getElementById('cancelEditBtn').classList.add('hidden');
      document.getElementById('submitBtn').innerText = "SAVE TRADE";
      document.getElementById('submitBtn').classList.remove('bg-yellow-600', 'hover:bg-yellow-500');
      document.getElementById('submitBtn').classList.add('bg-blue-600', 'hover:bg-blue-500');
      document.getElementById('formSection').classList.remove('editing-active');
      pastedImage = null;
      document.getElementById('imgMsg').innerText = "📸 粘贴 (Ctrl+V)";
      document.getElementById('imgMsg').className = "text-[10px] text-gray-400 font-bold";
      document.getElementById('tradeDate').valueAsDate = new Date();
    }

    function setupPaste() {
      const box = document.getElementById('pasteArea');
      const f = document.getElementById('imageFile');
      box.onclick = () => f.click();
      f.onchange = (e) => readImg(e.target.files[0]);
      window.onpaste = (e) => {
        if (!e.clipboardData || !e.clipboardData.items) return;
        const i = Array.from(e.clipboardData.items).find(x => x.type && x.type.includes('image'));
        if (i) readImg(i.getAsFile());
      };
    }

    function readImg(f) {
      if (!f) return;
      const r = new FileReader();
      r.onload = (e) => {
        pastedImage = e.target.result;
        document.getElementById('imgMsg').innerText = "图片已就绪 ✔";
        document.getElementById('imgMsg').className = "text-xs text-green-500 font-bold";
      };
      r.readAsDataURL(f);
    }

    function saveData() {
      localStorage.setItem(KEY_V34, JSON.stringify(trades));
      localStorage.setItem(LOCAL_UPDATED_KEY, new Date().toISOString());
      applyGlobalFilter();
      scheduleCloudSync();
    }

    function renderAll() { applyGlobalFilter(); }
    function closeModal() { document.getElementById('detailModal').classList.add('hidden'); }
    function clearAllData() {
      const msg = cloudUser ? 'Clear ALL? This will also sync and clear cloud data.' : 'Clear ALL?';
      if (confirm(msg)) {
        localStorage.removeItem(KEY_V34);
        trades = [];
        saveData();
      }
    }
    function toggleTheme() { document.documentElement.classList.toggle('dark'); localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light'); applyGlobalFilter(); }
    function applyTheme() { if (isDarkMode) document.documentElement.classList.add('dark'); }

    function exportData() {
      const a = document.createElement('a');
      a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(trades));
      a.download = `Journal_v34_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    }

    function importData(i) {
      const f = i.files[0];
      const r = new FileReader();
      r.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          trades = (Array.isArray(json) ? json : []).map(t => {
            const entry = t.entry ?? '';
            const stop = t.stop ?? '';
            const target = t.target ?? '';
            const dir = t.direction ?? 'Long';
            const profitTarget = t.profitTarget || t.rrTarget || '';
            const manualExit = normalizeManualExit(t.manualExit, '');
            const fixed = {
              ...t,
              id: t.id ? String(t.id) : uuidv4(),
              pnl: parseFloat(t.pnl) || 0,
              dateStr: t.dateStr || (t.timestamp ? new Date(t.timestamp).toISOString().slice(0, 10) : ''),
              timestamp: (typeof t.timestamp === 'number' && !Number.isNaN(t.timestamp))
                ? t.timestamp
                : ((t.dateStr || '').trim() ? new Date(t.dateStr).getTime() : Date.now()),
              rr: t.rr && t.rr !== '-' ? t.rr : calcRR(entry, stop, target, dir),
              profitTarget: profitTarget,
              manualExit: manualExit,
              tradeType: t.tradeType || '系统单'
            };
            return fixed;
          });
          saveData();
          alert('Success! ' + trades.length + ' loaded.');
        } catch (x) { alert('Error'); }
      };
      if (f) r.readAsText(f);
    }
