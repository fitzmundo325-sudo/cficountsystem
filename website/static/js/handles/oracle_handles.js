// ORACLE_HANDLES_VERSION 2026-10-05-fs3
// ---------------------------------------------------------------- Constants
let DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let DAYS_DISPLAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
let DISP_TO_JS = [1, 2, 3, 4, 5, 6, 0];
let CATEGORY_LIST = ['BREADS', 'TRAY PRODUCTS', 'ROLLS', 'GREETING CAKES', 'PREMIUM', 'CREMA DE FRUTA', 'GM PRODUCTS', 'CANDLES', 'ADD-ONS'];
let MODE_ON_CLASS = 'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white';
let MODE_OFF_CLASS = 'rounded-md px-3 py-1.5 text-xs font-semibold text-slate-600';
let WEEK_META = [
  { label: 'Week 1 (4 Weeks Ago)', hCls: 'bg-amber-800', iBg: '#FEF3C7', iBd: 'rgba(139,99,24,0.3)', iClr: '#78350F' },
  { label: 'Week 2 (3 Weeks Ago)', hCls: 'bg-sky-800', iBg: '#EFF6FF', iBd: 'rgba(29,95,168,0.3)', iClr: '#1e3a5f' },
  { label: 'Week 3 (2 Weeks Ago)', hCls: 'bg-emerald-800', iBg: '#ECFDF5', iBd: 'rgba(5,150,105,0.3)', iClr: '#064e3b' },
  { label: 'Week 4 (Last Week)', hCls: 'bg-rose-800', iBg: '#FFF1F2', iBd: 'rgba(225,29,72,0.3)', iClr: '#881337' }
];

// ---------------------------------------------------------------- State
let CLUSTER_VIEW = ORACLE_VIEW === 'cluster';
let STORE = { id: '', name: '', store_group: '' };
let PRODUCTS = [];
let STORE_SAVED_BUFFERS = {};
let INVENSYNC_DATA = {};
let PREV_INVENTORY_DATE = null;
let ORACLE_MEMORY_KEY = 'oracle-weekly-memory-';
let ORACLE_INCOMING_ORDERS = {};
let ORACLE_ORDER_HISTORY = [];
let POS_SALES_DATA = {};
let BULK_ORDER_WEEKS = [];
let BULK_ORDER_PRODUCT_DATA = {};
let salesData = {};
let DB = { inventory: [], orderHistory: [], pendingApprovals: [], settings: { leadTime: 1, buffer: 20 } };
let productBuffers = {};
let orderFinalQtys = {};
let weeklyFinalQtys = {};
let weeklyProductRows = [''];
let orderMode = CLUSTER_VIEW ? 'single' : 'weekly';
let activeCategory = 'all';
let productSearchQuery = '';
let HISTORY_GROUPS = [];

// ---------------------------------------------------------------- DOM helpers
function pad2(n) {
  return String(n).padStart(2, '0');
}

function fmt(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function cloneTemplate(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

function getCell(root, name) {
  return root.querySelector('[data-cell="' + name + '"]');
}

function setCell(root, name, value) {
  let el = getCell(root, name);
  if (el) el.textContent = value;
  return el;
}

function insertBeforeCell(parent, newEl, cellName) {
  parent.insertBefore(newEl, getCell(parent, cellName));
}

function addClasses(el, classString) {
  let list = String(classString || '').split(' ').filter(Boolean);
  if (list.length) el.classList.add(...list);
}

function removeElement(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function reloadPage() {
  window.location.reload();
}

function buildMessageRow(message, colspan) {
  let row = cloneTemplate('tmpl-message-row');
  let td = getCell(row, 'message');
  td.textContent = message;
  td.colSpan = colspan || 1;
  return row;
}

function fadeOutToast(toastEl) {
  toastEl.style.opacity = '0';
  toastEl.style.transform = 'translateX(12px)';
  toastEl.style.transition = 'all .25s';
  setTimeout(removeElement.bind(null, toastEl), 250);
}

function showToast(msg, type = 'info') {
  let container = document.getElementById('o-toast-container');
  let toastEl = cloneTemplate('tmpl-toast');
  let styles = { success: 'bg-emerald-700 border-emerald-500', error: 'bg-rose-700 border-rose-500', info: 'bg-slate-800 border-sky-500' };
  let icons = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', info: 'bi-info-circle-fill' };
  addClasses(toastEl, styles[type] || styles.info);
  getCell(toastEl, 'icon').classList.add(icons[type] || icons.info);
  setCell(toastEl, 'message', msg);
  container.appendChild(toastEl);
  setTimeout(fadeOutToast.bind(null, toastEl), 3000);
}

// ---------------------------------------------------------------- View visibility
function applyViewVisibility() {
  document.querySelectorAll('[data-show-in]').forEach(el => {
    let views = el.dataset.showIn.split(' ');
    el.classList.toggle('hidden', !views.includes(ORACLE_VIEW));
  });
  let back = document.getElementById('oracle-back-link');
  if (back) {
    back.href = ORACLE_BACK_URL || '#';
    back.title = ORACLE_VIEW === 'admin' ? back.dataset.titleAdmin : back.dataset.titleCluster;
  }
}

function applyOrderModePanels() {
  let weekly = orderMode === 'weekly';
  let singleView = document.getElementById('oracle-order-view');
  document.getElementById('weekly-order-panel').classList.toggle('hidden', !weekly);
  if (!singleView.classList.contains('oracle-fs')) singleView.classList.toggle('hidden', weekly);
  document.getElementById('mode-weekly').className = weekly ? MODE_ON_CLASS : MODE_OFF_CLASS;
  document.getElementById('mode-single').className = !weekly ? MODE_ON_CLASS : MODE_OFF_CLASS;
}

// ---------------------------------------------------------------- Data loading
function buildSales() {
  let d = {};
  PRODUCTS.forEach(p => {
    d[p.id] = [];
    for (let w = 0; w < 4; w++) {
      let wk = [];
      for (let day = 0; day < 7; day++) wk.push(0);
      d[p.id].push(wk);
    }
  });
  return d;
}

function applySalesData() {
  salesData = buildSales();
  Object.entries(POS_SALES_DATA || {}).forEach(([pid, weeks]) => {
    if (!salesData[pid] || !Array.isArray(weeks)) return;
    for (let w = 0; w < Math.min(4, weeks.length); w++) {
      if (!Array.isArray(weeks[w])) continue;
      for (let d = 0; d < Math.min(7, weeks[w].length); d++) {
        salesData[pid][w][d] = parseInt(weeks[w][d]) || 0;
      }
    }
  });
}

function normalizeProduct(p) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    category: p.category,
    unit: 'pc',
    plantPrice: Number(p.plantPrice) || 0,
    sellingPrice: Number(p.sellingPrice) || 0,
    buffer: 20,
    minOrder: 0
  };
}

function buildCategoryButtons() {
  let container = document.getElementById('category-filter-container');
  container.querySelectorAll('[data-category-filter]:not([data-category-filter="all"])').forEach(removeElement);
  CATEGORY_LIST.forEach(name => {
    let hasProducts = PRODUCTS.some(p => p.category === name);
    if (!hasProducts) return;
    let btn = cloneTemplate('tmpl-category-btn');
    btn.textContent = name;
    btn.dataset.categoryFilter = name.toLowerCase().replace(/[\s-]+/g, '');
    btn.addEventListener('click', onCategoryFilterClick);
    container.appendChild(btn);
  });
}

function applyOracleData(data) {
  STORE = data.store || STORE;
  PRODUCTS = (data.products || []).map(normalizeProduct);
  ORACLE_DATE = data.oracle_date || ORACLE_DATE;
  STORE_SAVED_BUFFERS = data.store_buffers || {};
  INVENSYNC_DATA = data.invensync_data || {};
  PREV_INVENTORY_DATE = data.prev_inventory_date || null;
  ORACLE_INCOMING_ORDERS = data.oracle_incoming_orders || {};
  ORACLE_ORDER_HISTORY = data.oracle_order_history || [];
  POS_SALES_DATA = data.pos_sales_data || {};
  BULK_ORDER_WEEKS = data.bulk_order_weeks || [];
  BULK_ORDER_PRODUCT_DATA = data.bulk_order_product_data || {};
  ORACLE_MEMORY_KEY = 'oracle-weekly-memory-' + STORE.id;
  applySalesData();
  DB.inventory = PRODUCTS.map(p => {
    let iv = INVENSYNC_DATA[String(p.id)];
    return { productId: p.id, productName: p.name, category: p.category, unit: p.unit, currentStock: iv ? iv.ending_stock : 0, reorderPoint: 0, lastUpdated: fmt(new Date()) };
  });
  DB.orderHistory = ORACLE_ORDER_HISTORY.filter(order => order.status === 'approved');
  DB.pendingApprovals = ORACLE_ORDER_HISTORY.filter(order => order.status === 'pending');
  productBuffers = {};
  PRODUCTS.forEach(p => {
    productBuffers[p.id] = (STORE_SAVED_BUFFERS && STORE_SAVED_BUFFERS[p.id] !== undefined) ? STORE_SAVED_BUFFERS[p.id] : p.buffer;
  });
  document.getElementById('oracle-store-name').textContent = STORE.name || '';
  document.getElementById('oracle-fs-store-name').textContent = STORE.name || '';
  document.getElementById('order-manager').value = ORACLE_USERNAME;
  document.title = 'Oracle — ' + (STORE.name || '');
  document.getElementById('topbar-date').textContent = (ORACLE_DATE ? new Date(ORACLE_DATE + 'T00:00:00') : new Date()).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  buildCategoryButtons();
  renderOrderForm();
}

function showLoadError(message) {
  let weeklyBody = document.getElementById('weekly-order-body');
  let orderBody = document.getElementById('order-table-body');
  weeklyBody.innerHTML = '';
  orderBody.innerHTML = '';
  weeklyBody.appendChild(buildMessageRow(message, 1));
  orderBody.appendChild(buildMessageRow(message, 15));
  showToast(message, 'error');
}

async function loadOracleData() {
  let params = new URLSearchParams();
  if (ORACLE_STORE_ID) params.set('store_id', ORACLE_STORE_ID);
  if (ORACLE_DATE) params.set('date', ORACLE_DATE);
  try {
    let response = await fetch('/apis/get_oracle_data?' + params.toString());
    let data = await response.json();
    if (data.type !== 'success') {
      showLoadError(data.message || 'Unable to load Oracle data');
      return;
    }
    applyOracleData(data);
  } catch (error) {
    showLoadError('Network error while loading Oracle data');
  }
}

// ---------------------------------------------------------------- Weekly memory
function saveWeeklyMemory() {
  try {
    localStorage.setItem(ORACLE_MEMORY_KEY, JSON.stringify({
      orderDate: document.getElementById('order-date')?.value || '',
      deliveryDate: document.getElementById('delivery-date')?.value || '',
      deliveryEndDate: document.getElementById('delivery-end-date')?.value || '',
      manager: document.getElementById('order-manager')?.value || '',
      forecast: document.getElementById('forecast-event')?.value || '1.00',
      targetSales: document.getElementById('target-sales-input')?.value || '',
      productRows: weeklyProductRows,
      finalQtys: weeklyFinalQtys
    }));
  } catch (error) {
    return false;
  }
}

function restoreWeeklyMemory() {
  try {
    let memory = JSON.parse(localStorage.getItem(ORACLE_MEMORY_KEY) || 'null');
    if (!memory) return false;
    if (memory.orderDate) document.getElementById('order-date').value = memory.orderDate;
    if (memory.deliveryDate) document.getElementById('delivery-date').value = memory.deliveryDate;
    if (memory.deliveryEndDate) document.getElementById('delivery-end-date').value = memory.deliveryEndDate;
    if (memory.manager) document.getElementById('order-manager').value = memory.manager;
    if (memory.forecast) document.getElementById('forecast-event').value = memory.forecast;
    if (memory.targetSales !== undefined) document.getElementById('target-sales-input').value = memory.targetSales;
    if (Array.isArray(memory.productRows) && memory.productRows.length) weeklyProductRows = memory.productRows.map(String);
    if (memory.finalQtys && typeof memory.finalQtys === 'object') weeklyFinalQtys = memory.finalQtys;
    return true;
  } catch (error) {
    return false;
  }
}

// ---------------------------------------------------------------- Calculations
function getCurStock(pid) {
  return (DB.inventory.find(x => x.productId === pid) || { currentStock: 0 }).currentStock;
}

function getOrganicSales(pid, weekIndex, dayIndex) {
  return Number(salesData[pid]?.[weekIndex]?.[dayIndex] || 0);
}

function getAvgDay(pid, dayName) {
  let di = DAYS.indexOf(dayName);
  if (di < 0) return 0;
  let w = salesData[pid];
  return w ? w.reduce((s, wk, weekIndex) => s + getOrganicSales(pid, weekIndex, di), 0) / 4 : 0;
}

function getAvgDayIdx(pid, di) {
  let w = salesData[pid];
  return w ? w.reduce((s, wk, weekIndex) => s + getOrganicSales(pid, weekIndex, di), 0) / 4 : 0;
}

function getAvgDaily(pid) {
  let w = salesData[pid];
  if (!w) return 0;
  let t = 0, c = 0;
  w.forEach((wk, weekIndex) => wk.forEach((v, dayIndex) => {
    t += getOrganicSales(pid, weekIndex, dayIndex);
    c++;
  }));
  return c ? t / c : 0;
}

function getSalesDataPointCount(pid) {
  let w = salesData[pid];
  if (!w) return 0;
  let c = 0;
  w.forEach((wk, weekIndex) => wk.forEach((v, dayIndex) => {
    if (getOrganicSales(pid, weekIndex, dayIndex) > 0) c++;
  }));
  return c;
}

function getIncoming(pid, od, dd) {
  return Number(ORACLE_INCOMING_ORDERS[String(pid)]?.[dd] || 0);
}

function getExpSales(pid, od, dd) {
  if (!od || !dd) return 0;
  let t = 0;
  let c = new Date(od + 'T00:00:00');
  c.setDate(c.getDate() + 1);
  let e = new Date(dd + 'T00:00:00');
  let canUseOverallFallback = getSalesDataPointCount(pid) > 1;
  let s = 0;
  while (c < e && s++ < 60) {
    let weekdayAvg = getAvgDay(pid, DAYS[c.getDay()]);
    t += weekdayAvg > 0 ? weekdayAvg : (canUseOverallFallback ? getAvgDaily(pid) : 0);
    c.setDate(c.getDate() + 1);
  }
  return Math.round(t);
}

function getTrans(pid, type, od, dd) {
  if (!od || !dd) return 0;
  let iv = INVENSYNC_DATA[String(pid)];
  if (!iv) return 0;
  return type === 'in' ? iv.trans_in : iv.trans_out;
}

function calcAvg(p, dayName, mult, ne, tIn, tOut) {
  let avg = getAvgDay(p.id, dayName);
  let buf = (productBuffers[p.id] ?? p.buffer) / 100;
  let days = DB.settings.leadTime || 1;
  let target = Math.ceil(avg * mult * days * (1 + buf));
  let raw = target - ne - tIn + tOut;
  let min = p.minOrder || 1;
  return Math.ceil(Math.max(0, raw) / min) * min;
}

function calcTarget(p, di, tSales, mult, ne, tIn, tOut) {
  let pAvg = getAvgDayIdx(p.id, di) * p.sellingPrice;
  let totRev = 0;
  PRODUCTS.forEach(q => { totRev += getAvgDayIdx(q.id, di) * q.sellingPrice; });
  if (!totRev) return 0;
  let qty = Math.ceil(tSales * (pAvg / totRev) / p.sellingPrice);
  let buf = (productBuffers[p.id] ?? p.buffer) / 100;
  let raw = Math.ceil(qty * mult * (1 + buf)) - ne - tIn + tOut;
  let min = p.minOrder || 1;
  return Math.ceil(Math.max(0, raw) / min) * min;
}

function minDeliv(od) {
  let d = new Date(od + 'T00:00:00');
  d.setDate(d.getDate() + 2);
  return fmt(d);
}

function getEffMult() {
  return parseFloat(document.getElementById('forecast-event').value) || 1;
}

function getDelivDayName() {
  let v = document.getElementById('delivery-date').value;
  return v ? DAYS[new Date(v + 'T00:00:00').getDay()] : DAYS[new Date().getDay()];
}

function getDelivDayIdx() {
  let v = document.getElementById('delivery-date').value;
  return v ? new Date(v + 'T00:00:00').getDay() : new Date().getDay();
}

function getPlanDates() {
  let start = document.getElementById('delivery-date').value;
  let end = document.getElementById('delivery-end-date').value;
  if (!start || !end || end < start) return [];
  let dates = [];
  let cursor = new Date(start + 'T00:00:00');
  let last = new Date(end + 'T00:00:00');
  while (cursor <= last && dates.length < 7) {
    dates.push(fmt(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function maxPlanEnd(start) {
  if (!start) return '';
  let date = new Date(start + 'T00:00:00');
  date.setDate(date.getDate() + 6);
  return fmt(date);
}

function formatPlanDate(value) {
  return new Date(value + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}

function expandDateRange(values) {
  let ordered = values.filter(Boolean).sort();
  if (ordered.length < 2) return ordered;
  let dates = [];
  let cursor = new Date(ordered[0] + 'T00:00:00');
  let last = new Date(ordered[ordered.length - 1] + 'T00:00:00');
  while (cursor <= last && dates.length < 7) {
    dates.push(fmt(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function getWeeklySuggestions(product, dates, mult) {
  let od = document.getElementById('order-date').value;
  let projected = Math.max(0, getCurStock(product.id) - getExpSales(product.id, od, dates[0]));
  let buffer = (productBuffers[product.id] ?? product.buffer) / 100;
  let minOrder = product.minOrder || 1;
  let targetSales = parseFloat(document.getElementById('target-sales-input').value) || 0;
  return dates.map((date, index) => {
    let dayIndex = new Date(date + 'T00:00:00').getDay();
    let totalRevenue = targetSales > 0 ? PRODUCTS.reduce((sum, item) => sum + getAvgDayIdx(item.id, dayIndex) * item.sellingPrice, 0) : 0;
    let targetUnits = totalRevenue > 0 ? (targetSales * ((getAvgDayIdx(product.id, dayIndex) * product.sellingPrice) / totalRevenue)) / product.sellingPrice : 0;
    let average = (targetSales > 0 && totalRevenue > 0 ? targetUnits : getAvgDayIdx(product.id, dayIndex)) * mult;
    let expected = Math.ceil(average);
    let transIn = index === 0 ? getTrans(product.id, 'in', od, date) : 0;
    let transOut = index === 0 ? getTrans(product.id, 'out', od, date) : 0;
    let beforeDelivery = Math.max(0, projected - expected) + transIn - transOut;
    let target = Math.ceil(average * (1 + buffer));
    let suggested = Math.ceil(Math.max(0, target - beforeDelivery) / minOrder) * minOrder;
    projected = beforeDelivery + suggested;
    return { date, suggested, min: Math.max(0, Math.floor(suggested * 0.8)), max: Math.ceil(suggested * 1.2), average };
  });
}

// ---------------------------------------------------------------- Navigation and filters
function navigate(id) {
  if (CLUSTER_VIEW && id !== 'order-form') id = 'order-form';
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.o-tab').forEach(t => t.classList.remove('active'));
  let view = document.getElementById('view-' + id);
  if (!view) return;
  view.classList.add('active', 'fade-up');
  setTimeout(removeFadeUp.bind(null, view), 300);
  let tab = document.getElementById('tab-' + id);
  if (tab) tab.classList.add('active');
  if (id !== 'order-form' && getActiveFullscreenPanel()) toggleOrderFullscreen();
  syncFullscreenButton(id);
  let renderers = { 'order-form': renderOrderForm, 'history': renderHistory, 'daily-averages': renderDailyAverages };
  let renderer = renderers[id];
  if (renderer) renderer();
}

function removeFadeUp(view) {
  view.classList.remove('fade-up');
}

function onNavClick(event) {
  navigate(event.currentTarget.dataset.nav);
}

function onNewOrderClick() {
  navigate('order-form');
}

function setOrderMode(mode) {
  orderMode = mode === 'single' ? 'single' : 'weekly';
  applyOrderModePanels();
  renderOrderTable();
  renderWeeklyOrderTable();
}

function onModeWeeklyClick() {
  setOrderMode('weekly');
}

function onModeSingleClick() {
  setOrderMode('single');
}

function filterInventoryCategory(category) {
  activeCategory = category;
  document.querySelectorAll('.category-filter-btn').forEach(btn => {
    let isActive = btn.dataset.categoryFilter === category;
    btn.classList.toggle('bg-slate-900', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('bg-white', !isActive);
    btn.classList.toggle('text-slate-700', !isActive);
  });
  renderOrderTable();
  renderWeeklyOrderTable();
}

function onCategoryFilterClick(event) {
  filterInventoryCategory(event.currentTarget.dataset.categoryFilter);
}

function onSearchInput() {
  productSearchQuery = document.getElementById('product-search-input').value.trim().toLowerCase();
  renderOrderTable();
  renderWeeklyOrderTable();
}

function categoryMatches(product) {
  if (activeCategory === 'all') return true;
  return (product.category || '').toLowerCase().replace(/[\s-]+/g, '') === activeCategory;
}

function searchMatches(product) {
  if (!productSearchQuery) return true;
  let code = String(product.code || product.id).toLowerCase();
  let name = String(product.name || '').toLowerCase();
  let price = String(product.sellingPrice || '').toLowerCase();
  return code.includes(productSearchQuery) || name.includes(productSearchQuery) || price.includes(productSearchQuery);
}

// ---------------------------------------------------------------- Date and forecast handlers
function onOrderDateChange() {
  let od = document.getElementById('order-date').value;
  if (!od) return;
  let min = minDeliv(od);
  let dd = document.getElementById('delivery-date');
  let end = document.getElementById('delivery-end-date');
  dd.min = min;
  end.min = min;
  if (!dd.value || dd.value < min) {
    dd.value = min;
    showToast('Delivery start auto-set: minimum is order + 2 days', 'info');
  }
  end.max = maxPlanEnd(dd.value);
  if (!end.value || end.value < dd.value) end.value = dd.value;
  if (end.value > end.max) end.value = end.max;
  saveWeeklyMemory();
  updateDelivDay();
}

function onDeliveryDateChange() {
  let od = document.getElementById('order-date').value;
  let dd = document.getElementById('delivery-date');
  let end = document.getElementById('delivery-end-date');
  if (od && dd.value && dd.value < minDeliv(od)) {
    dd.value = minDeliv(od);
    showToast('Delivery must be at least 2 days after order date', 'error');
  }
  end.max = maxPlanEnd(dd.value);
  if (!end.value || end.value < dd.value) end.value = dd.value;
  if (end.value > end.max) end.value = end.max;
  saveWeeklyMemory();
  updateDelivDay();
}

function onDeliveryEndChange() {
  let dd = document.getElementById('delivery-date');
  let end = document.getElementById('delivery-end-date');
  end.max = maxPlanEnd(dd.value);
  if (dd.value && end.value < dd.value) {
    end.value = dd.value;
    showToast('Delivery end cannot be before the start date', 'error');
  }
  if (end.max && end.value > end.max) {
    end.value = end.max;
    showToast('A weekly plan can include up to 7 delivery days', 'info');
  }
  saveWeeklyMemory();
  updateDelivDay();
}

function updateDelivDay() {
  let dates = getPlanDates();
  document.getElementById('delivery-day').value = dates.length ? `${formatPlanDate(dates[0])} – ${formatPlanDate(dates[dates.length - 1])} (${dates.length} ${dates.length === 1 ? 'day' : 'days'})` : '';
  renderOrderTable();
  renderWeeklyOrderTable();
}

function onTargetSalesChange() {
  saveWeeklyMemory();
  renderOrderTable();
  renderWeeklyOrderTable();
}

function updateMultiplier() {
  document.getElementById('eff-mult').textContent = (parseFloat(document.getElementById('forecast-event').value) || 1).toFixed(2) + '×';
  saveWeeklyMemory();
  renderOrderTable();
  renderWeeklyOrderTable();
}

function renderOrderForm() {
  let today = ORACLE_DATE ? new Date(ORACLE_DATE + 'T00:00:00') : new Date();
  let deliv = new Date(today);
  deliv.setDate(today.getDate() + 2);
  document.getElementById('order-date').value = fmt(today);
  document.getElementById('delivery-date').value = fmt(deliv);
  let end = new Date(deliv);
  end.setDate(deliv.getDate() + 5);
  document.getElementById('delivery-end-date').value = fmt(end);
  document.getElementById('delivery-date').min = minDeliv(fmt(today));
  document.getElementById('delivery-end-date').min = minDeliv(fmt(today));
  document.getElementById('delivery-end-date').max = maxPlanEnd(fmt(deliv));
  let restored = restoreWeeklyMemory();
  if (restored) {
    document.getElementById('delivery-date').min = minDeliv(document.getElementById('order-date').value);
    document.getElementById('delivery-end-date').min = document.getElementById('delivery-date').value;
  }
  updateDelivDay();
  updateMultiplier();
  setOrderMode(CLUSTER_VIEW ? 'single' : 'weekly');
}

// ---------------------------------------------------------------- Single-day order table
function updateModeIndicator(ctx) {
  let modeEl = document.getElementById('order-mode-indicator');
  modeEl.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ' + (ctx.useTarget ? 'bg-purple-900/50 border-purple-700 text-purple-300' : 'bg-emerald-900/50 border-emerald-700 text-emerald-300');
  modeEl.innerHTML = ctx.useTarget ? `<i class="bi bi-bullseye"></i> Target ₱${ctx.tSales.toLocaleString()}` : '<i class="bi bi-bar-chart-fill"></i> Avg Consumption';
}

function setOrderSummary(skus, suggested, final, cost) {
  document.getElementById('sum-skus').textContent = skus;
  document.getElementById('sum-suggested').textContent = suggested;
  document.getElementById('sum-final').textContent = final;
  document.getElementById('sum-cost').textContent = '₱' + Math.round(cost).toLocaleString();
}

function buildOrderRow(p, ctx) {
  let stock = getCurStock(p.id);
  let exp = getExpSales(p.id, ctx.od, ctx.dd);
  let tIn = getTrans(p.id, 'in', ctx.od, ctx.dd);
  let tOut = getTrans(p.id, 'out', ctx.od, ctx.dd);
  let ne = Math.max(0, stock - exp);
  let effStock = ne + tIn - tOut;
  let bufPct = productBuffers[p.id] ?? p.buffer;
  let avgMult = getAvgDay(p.id, ctx.dayName) * ctx.mult;
  let sug = ctx.useTarget ? calcTarget(p, ctx.dayIdx, ctx.tSales, ctx.mult, ne, tIn, tOut) : calcAvg(p, ctx.dayName, ctx.mult, ne, tIn, tOut);
  let minS = Math.max(0, Math.floor(sug * 0.8));
  let maxS = Math.ceil(sug * 1.2);
  let fv = orderFinalQtys[p.id] !== undefined ? orderFinalQtys[p.id] : '';
  let fo = fv !== '' ? (parseInt(fv) || 0) : sug;
  let inc = getIncoming(p.id, ctx.od, ctx.dd);
  let oor = fv !== '' && (fo < minS || fo > maxS);
  let estOH = effStock + fo;
  let ohCls = estOH <= 0 ? 'text-red-600 bg-red-50' : estOH < (p.minOrder || 1) * 2 ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50';
  let sCls = stock === 0 ? 'bg-red-100 text-red-700' : stock < (p.minOrder || 1) * 2 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
  let eCls = effStock < 0 ? 'text-red-600 font-bold' : effStock === 0 ? 'text-amber-600 font-semibold' : 'text-slate-500';
  let row = cloneTemplate('tmpl-order-row');
  setCell(row, 'name', p.name);
  setCell(row, 'code', p.code || p.id);
  addClasses(setCell(row, 'stock', `${stock} ${p.unit}s`), sCls);
  setCell(row, 'incoming', inc);
  setCell(row, 'expected', exp);
  setCell(row, 'trans_in', tIn > 0 ? '+' + tIn : '0');
  setCell(row, 'trans_out', tOut > 0 ? '−' + tOut : '0');
  addClasses(setCell(row, 'effective_stock', effStock), eCls);
  setCell(row, 'avg_sales', avgMult.toFixed(1));
  let bufferInput = getCell(row, 'buffer');
  bufferInput.value = bufPct;
  bufferInput.dataset.productId = p.id;
  if (CLUSTER_VIEW) {
    bufferInput.addEventListener('change', onBufferInputChange);
  } else {
    bufferInput.readOnly = true;
    bufferInput.tabIndex = -1;
    addClasses(bufferInput, 'bg-slate-50 text-slate-600 cursor-not-allowed');
  }
  setCell(row, 'min', minS);
  setCell(row, 'suggested', sug);
  setCell(row, 'max', maxS);
  let finalInput = getCell(row, 'final_input');
  let finalReadonly = getCell(row, 'final_readonly');
  if (CLUSTER_VIEW) {
    finalInput.classList.add('hidden');
    finalReadonly.classList.remove('hidden');
    finalReadonly.textContent = sug;
  } else {
    finalInput.value = fv;
    finalInput.placeholder = sug;
    finalInput.dataset.finalProductId = p.id;
    if (oor) addClasses(finalInput, 'border-red-400 bg-red-50 text-red-700');
    finalInput.addEventListener('change', onFinalInputChange);
    finalInput.addEventListener('keydown', onFinalKeyDown);
  }
  addClasses(getCell(row, 'est_box'), ohCls);
  setCell(row, 'est_value', estOH);
  setCell(row, 'est_unit', p.unit + 's');
  setCell(row, 'plant', '₱' + p.plantPrice.toLocaleString());
  setCell(row, 'srp', '₱' + p.sellingPrice.toLocaleString());
  setCell(row, 'total_cost', '₱' + (fo * p.plantPrice).toLocaleString());
  return { row, sug, fo };
}

function renderOrderTable() {
  let mult = getEffMult();
  let dayName = getDelivDayName();
  let dayIdx = getDelivDayIdx();
  let od = document.getElementById('order-date').value;
  let dd = document.getElementById('delivery-date').value;
  let tsRaw = document.getElementById('target-sales-input').value;
  let tSales = tsRaw !== '' ? parseFloat(tsRaw) : null;
  let useTarget = tSales !== null && tSales > 0;
  let ctx = { mult, dayName, dayIdx, od, dd, tSales, useTarget };
  updateModeIndicator(ctx);
  let filteredProducts = PRODUCTS.filter(p => categoryMatches(p) && searchMatches(p));
  let tbody = document.getElementById('order-table-body');
  let tfoot = document.getElementById('order-table-foot');
  let totSug = 0, totFinal = 0, totPlant = 0, totSell = 0;
  tbody.innerHTML = '';
  tfoot.innerHTML = '';
  if (!filteredProducts.length) {
    tbody.appendChild(buildMessageRow('No products match your search or filter.', 15));
    setOrderSummary(0, 0, 0, 0);
    return;
  }
  filteredProducts.forEach(p => {
    let built = buildOrderRow(p, ctx);
    tbody.appendChild(built.row);
    totSug += built.sug;
    totFinal += built.fo;
    totPlant += built.fo * p.plantPrice;
    totSell += built.fo * p.sellingPrice;
  });
  let foot = cloneTemplate('tmpl-order-foot');
  setCell(foot, 'tot_suggested', totSug);
  setCell(foot, 'tot_final', totFinal);
  setCell(foot, 'tot_srp', '₱' + Math.round(totSell).toLocaleString());
  setCell(foot, 'tot_cost', '₱' + Math.round(totPlant).toLocaleString());
  tfoot.appendChild(foot);
  setOrderSummary(filteredProducts.length, totSug, totFinal, totPlant);
}

function onFinalChange(pid, val) {
  orderFinalQtys[pid] = val === '' ? undefined : val;
  renderOrderTable();
}

function onFinalInputChange(event) {
  let input = event.currentTarget;
  onFinalChange(input.dataset.finalProductId, input.value);
}

function onFinalKeyDown(event) {
  let input = event.currentTarget;
  if (!['Enter', 'ArrowUp', 'ArrowDown', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  let fields = Array.from(document.querySelectorAll('#order-table-body .input-final'));
  let index = fields.indexOf(input);
  if (event.key === 'ArrowRight') input.value = input.placeholder;
  onFinalChange(input.dataset.finalProductId, input.value);
  let nextFields = Array.from(document.querySelectorAll('#order-table-body .input-final'));
  let nextIndex = event.key === 'ArrowDown' || event.key === 'Enter'
    ? Math.min(index + 1, nextFields.length - 1)
    : event.key === 'ArrowUp'
      ? Math.max(index - 1, 0)
      : index;
  let next = nextFields[nextIndex];
  if (next) {
    next.focus();
    next.select();
  }
}

function onBufferChange(pid, val) {
  productBuffers[pid] = parseFloat(val) || 0;
  renderOrderTable();
  renderWeeklyOrderTable();
}

function onBufferInputChange(event) {
  let input = event.currentTarget;
  onBufferChange(input.dataset.productId, input.value);
}

function clearFinalOrders() {
  orderFinalQtys = {};
  weeklyFinalQtys = {};
  weeklyProductRows = [''];
  saveWeeklyMemory();
  PRODUCTS.forEach(p => { productBuffers[p.id] = p.buffer; });
  renderOrderTable();
  renderWeeklyOrderTable();
  showToast('All overrides cleared', 'info');
}

function refreshSuggested() {
  renderOrderTable();
  renderWeeklyOrderTable();
  showToast('Quantities refreshed', 'success');
}

async function saveBuffersToCluster() {
  if (!CLUSTER_VIEW) return;
  let btn = document.getElementById('cluster-save-buffers');
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Saving…';
  try {
    let res = await fetch('/cluster-manager/oracle/save-buffers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: STORE.id, buffers: productBuffers })
    });
    let data = await res.json();
    if (data.ok) showToast('Buffers saved', 'success');
    else showToast('Save failed: ' + (data.error || 'Unknown'), 'error');
  } catch (e) {
    showToast('Network error while saving buffers', 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-floppy"></i> Save Buffers';
}

function getActiveFullscreenPanel() {
  return document.querySelector('#oracle-order-view.oracle-fs');
}

function syncFullscreenButton(viewId) {
  let btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  let allowed = btn.dataset.showIn.split(' ').includes(ORACLE_VIEW);
  btn.classList.toggle('hidden', !(allowed && viewId === 'order-form'));
}

let fullscreenPlaceholder = null;

function toggleOrderFullscreen() {
  let view = document.getElementById('oracle-order-view');
  let weeklyPanel = document.getElementById('weekly-order-panel');
  if (!view) return;
  if (view.classList.contains('oracle-fs')) {
    view.classList.remove('oracle-fs');
    view.style.cssText = '';
    if (fullscreenPlaceholder && fullscreenPlaceholder.parentNode) {
      fullscreenPlaceholder.parentNode.replaceChild(view, fullscreenPlaceholder);
    }
    fullscreenPlaceholder = null;
    view.classList.toggle('hidden', orderMode === 'weekly');
    if (weeklyPanel) weeklyPanel.classList.toggle('hidden', orderMode !== 'weekly');
    document.body.style.overflow = '';
    return;
  }
  let orderView = document.getElementById('view-order-form');
  if (!orderView || !orderView.classList.contains('active')) return;
  renderOrderTable();
  fullscreenPlaceholder = document.createComment('oracle-order-view');
  view.parentNode.replaceChild(fullscreenPlaceholder, view);
  document.body.appendChild(view);
  if (weeklyPanel) weeklyPanel.classList.add('hidden');
  view.classList.remove('hidden');
  view.classList.add('oracle-fs');
  view.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;background:#fff;';
  document.body.style.overflow = 'hidden';
}

function onDocumentKeyDown(event) {
  if (event.key !== 'Escape') return;
  if (getActiveFullscreenPanel()) toggleOrderFullscreen();
}

// ---------------------------------------------------------------- Weekly order planner
function onWeeklyFinalChange(key, value) {
  weeklyFinalQtys[key] = value === '' ? undefined : value;
  saveWeeklyMemory();
  renderWeeklyOrderTable();
}

function onWeeklyFinalInputChange(event) {
  let input = event.currentTarget;
  onWeeklyFinalChange(input.dataset.weeklyKey, input.value);
}

function onWeeklyProductChange(value, rowIndex) {
  let normalized = String(value || '').trim().toLowerCase();
  let product = PRODUCTS.find(p => String(p.name || '').trim().toLowerCase() === normalized || String(p.code || p.id).trim().toLowerCase() === normalized || String(p.id) === normalized);
  let nextRows = [...weeklyProductRows];
  nextRows[rowIndex] = product ? String(product.id) : '';
  if (product && rowIndex === nextRows.length - 1) nextRows.push('');
  if (!product && rowIndex < nextRows.length - 1) nextRows.splice(rowIndex, 1);
  weeklyProductRows = nextRows.length ? nextRows : [''];
  saveWeeklyMemory();
  renderWeeklyOrderTable();
}

function onWeeklyProductInputChange(event) {
  let input = event.currentTarget;
  onWeeklyProductChange(input.value, Number(input.dataset.weeklyRow));
}

function onWeeklyKeyDown(event) {
  let input = event.currentTarget;
  if (event.key === '/' && input.classList.contains('weekly-final-input')) {
    event.preventDefault();
    let key = input.dataset.weeklyKey;
    weeklyFinalQtys[key] = input.dataset.weeklySuggested;
    saveWeeklyMemory();
    renderWeeklyOrderTable();
    let filledInput = Array.from(document.querySelectorAll('.weekly-final-input')).find(field => field.dataset.weeklyKey === key);
    if (filledInput) {
      filledInput.focus();
      filledInput.select();
    }
    return;
  }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  let isProductPicker = input.classList.contains('weekly-product-select');
  if (isProductPicker && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && ((event.key === 'ArrowLeft' && input.selectionStart > 0) || (event.key === 'ArrowRight' && input.selectionStart < input.value.length))) return;
  event.preventDefault();
  if (!isProductPicker && input.dataset.weeklyKey) {
    weeklyFinalQtys[input.dataset.weeklyKey] = input.value === '' ? undefined : input.value;
    saveWeeklyMemory();
  }
  let next;
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    let direction = event.key === 'ArrowDown' ? 1 : -1;
    let row = Number(input.dataset.weeklyRow || 0);
    let targetRow = row + direction;
    if (targetRow >= 0) {
      if (isProductPicker) next = document.querySelector(`.weekly-product-select[data-weekly-row="${targetRow}"]`);
      else next = document.querySelector(`.weekly-final-input[data-weekly-row="${targetRow}"][data-weekly-col="${input.dataset.weeklyCol}"]`) || document.querySelector(`.weekly-product-select[data-weekly-row="${targetRow}"]`);
    }
  } else {
    let fields = Array.from(document.querySelectorAll('.weekly-product-select, .weekly-final-input'));
    let index = fields.indexOf(input);
    let nextIndex = event.key === 'ArrowRight' ? Math.min(index + 1, fields.length - 1) : Math.max(index - 1, 0);
    next = fields[nextIndex];
  }
  if (next) {
    next.focus();
    if (typeof next.select === 'function') next.select();
  }
}

function buildWeeklyProductCell(row, rowIndex, selected, filtered) {
  let selectedIds = new Set(weeklyProductRows.filter((id, index) => index !== rowIndex && id));
  let input = getCell(row, 'product_input');
  let datalist = getCell(row, 'product_options');
  let listId = 'oracle-product-options-' + rowIndex;
  datalist.id = listId;
  input.setAttribute('list', listId);
  input.value = selected ? selected.name : '';
  input.dataset.weeklyRow = rowIndex;
  filtered.filter(p => !selectedIds.has(String(p.id))).forEach(p => {
    let option = cloneTemplate('tmpl-weekly-option');
    option.value = p.name;
    option.label = String(p.code || p.id);
    datalist.appendChild(option);
  });
  input.addEventListener('change', onWeeklyProductInputChange);
  input.addEventListener('keydown', onWeeklyKeyDown);
}

function buildWeeklyDayCell(selected, plan, rowIndex, dateIndex) {
  let key = `${selected.id}|${plan.date}`;
  let value = weeklyFinalQtys[key] !== undefined ? weeklyFinalQtys[key] : '';
  let finalQty = Math.max(0, parseInt(value) || 0);
  let outside = value !== '' && (finalQty < plan.min || finalQty > plan.max);
  let td = cloneTemplate('tmpl-weekly-day-cell');
  setCell(td, 'min', plan.min);
  setCell(td, 'suggested', plan.suggested);
  setCell(td, 'max', plan.max);
  let input = getCell(td, 'final_input');
  input.value = value;
  input.dataset.weeklyKey = key;
  input.dataset.weeklySuggested = plan.suggested;
  input.dataset.weeklyRow = rowIndex;
  input.dataset.weeklyCol = dateIndex;
  input.setAttribute('aria-label', `${selected.name} on ${plan.date}`);
  if (outside) addClasses(input, 'border-red-400 bg-red-50 text-red-700');
  input.addEventListener('change', onWeeklyFinalInputChange);
  input.addEventListener('keydown', onWeeklyKeyDown);
  return { td, finalQty };
}

function renderWeeklyOrderTable() {
  let dates = getPlanDates();
  let head = document.getElementById('weekly-order-head');
  let body = document.getElementById('weekly-order-body');
  let foot = document.getElementById('weekly-order-foot');
  if (!head || !body || !foot) return;
  head.innerHTML = '';
  body.innerHTML = '';
  foot.innerHTML = '';
  if (!dates.length) {
    body.appendChild(buildMessageRow('Choose a valid delivery window to build the plan.', 1));
    return;
  }
  let mult = getEffMult();
  let filtered = PRODUCTS.filter(p => categoryMatches(p) && searchMatches(p));
  let headRow = cloneTemplate('tmpl-weekly-head-row');
  dates.forEach(date => {
    let th = cloneTemplate('tmpl-weekly-head-date');
    setCell(th, 'date_label', formatPlanDate(date));
    insertBeforeCell(headRow, th, 'week_total_head');
  });
  head.appendChild(headRow);
  let totalSuggested = 0, totalFinal = 0, totalCost = 0;
  let dailySuggested = dates.map(() => 0);
  weeklyProductRows.forEach((productId, rowIndex) => {
    let selected = PRODUCTS.find(p => String(p.id) === String(productId));
    let row = cloneTemplate('tmpl-weekly-product-row');
    buildWeeklyProductCell(row, rowIndex, selected, filtered);
    if (!selected) {
      dates.forEach(() => insertBeforeCell(row, cloneTemplate('tmpl-weekly-empty-cell'), 'week_total'));
      let emptyTotal = setCell(row, 'week_total', '—');
      emptyTotal.classList.remove('font-bold', 'text-sky-600');
      emptyTotal.classList.add('text-slate-300');
      body.appendChild(row);
      return;
    }
    let plans = getWeeklySuggestions(selected, dates, mult);
    let rowFinal = 0;
    plans.forEach((plan, dateIndex) => {
      let built = buildWeeklyDayCell(selected, plan, rowIndex, dateIndex);
      totalSuggested += plan.suggested;
      totalFinal += built.finalQty;
      rowFinal += built.finalQty;
      dailySuggested[dateIndex] += plan.suggested;
      insertBeforeCell(row, built.td, 'week_total');
    });
    totalCost += rowFinal * selected.plantPrice;
    setCell(row, 'week_total', rowFinal);
    body.appendChild(row);
  });
  let footRow = cloneTemplate('tmpl-weekly-foot-row');
  dailySuggested.forEach(total => {
    let td = cloneTemplate('tmpl-weekly-foot-cell');
    setCell(td, 'total', total || '—');
    insertBeforeCell(footRow, td, 'week_total');
  });
  setCell(footRow, 'week_total', totalFinal || '—');
  foot.appendChild(footRow);
  document.getElementById('weekly-plan-summary').textContent = `${dates.length} delivery days · ${formatPlanDate(dates[0])} to ${formatPlanDate(dates[dates.length - 1])}`;
  document.getElementById('weekly-sum-skus').textContent = weeklyProductRows.filter(Boolean).length;
  document.getElementById('weekly-sum-suggested').textContent = totalSuggested;
  document.getElementById('weekly-sum-final').textContent = totalFinal;
  document.getElementById('weekly-sum-cost').textContent = '₱' + Math.round(totalCost).toLocaleString();
}

// ---------------------------------------------------------------- Submit
async function submitWeeklyOrder() {
  if (CLUSTER_VIEW) return;
  let od = document.getElementById('order-date').value;
  let dates = getPlanDates();
  if (!od || dates.length < 1) {
    showToast('Choose a valid delivery window first.', 'error');
    return;
  }
  let mult = getEffMult();
  let submittedOrders = [];
  let selectedProducts = weeklyProductRows.map(id => PRODUCTS.find(p => String(p.id) === String(id))).filter(Boolean);
  if (!selectedProducts.length) {
    showToast('Choose at least one product before submitting.', 'info');
    return;
  }
  selectedProducts.forEach(p => getWeeklySuggestions(p, dates, mult).forEach(plan => {
    let key = `${p.id}|${plan.date}`;
    let raw = weeklyFinalQtys[key];
    let quantity = parseInt(raw) || 0;
    submittedOrders.push({ productId: p.id, quantity, orderDate: od, deliveryDate: plan.date, suggested: plan.suggested, minSuggested: plan.min, maxSuggested: plan.max });
  }));
  if (!submittedOrders.some(order => order.quantity > 0)) {
    showToast('Enter at least one quantity before submitting this week.', 'info');
    return;
  }
  try {
    let response = await fetch('/store-manager/oracle/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orders: submittedOrders }) });
    let result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to save weekly Oracle order');
    weeklyFinalQtys = {};
    saveWeeklyMemory();
    showToast(`${result.saved || submittedOrders.length} daily orders submitted${result.pending ? `; ${result.pending} require approval` : ''}.`, result.pending ? 'info' : 'success');
    renderWeeklyOrderTable();
    setTimeout(reloadPage, 900);
  } catch (error) {
    showToast(error.message || 'Unable to save weekly Oracle order', 'error');
  }
}

async function submitOrder() {
  if (CLUSTER_VIEW) return;
  if (orderMode === 'weekly') {
    await submitWeeklyOrder();
    return;
  }
  let od = document.getElementById('order-date').value;
  let dd = document.getElementById('delivery-date').value;
  let dayName = getDelivDayName();
  let dayIdx = getDelivDayIdx();
  let mult = getEffMult();
  let eventLabel = document.getElementById('forecast-event').selectedOptions[0].text;
  let manager = document.getElementById('order-manager').value;
  let tsRaw = document.getElementById('target-sales-input').value;
  let tSales = tsRaw !== '' ? parseFloat(tsRaw) : null;
  let useTarget = tSales !== null && tSales > 0;
  let autoC = 0, pendC = 0;
  let submittedOrders = [];
  PRODUCTS.forEach(p => {
    let stock = getCurStock(p.id);
    let exp = getExpSales(p.id, od, dd);
    let tIn = getTrans(p.id, 'in', od, dd);
    let tOut = getTrans(p.id, 'out', od, dd);
    let ne = Math.max(0, stock - exp);
    let sug = useTarget ? calcTarget(p, dayIdx, tSales, mult, ne, tIn, tOut) : calcAvg(p, dayName, mult, ne, tIn, tOut);
    let minS = Math.max(0, Math.floor(sug * 0.8));
    let maxS = Math.ceil(sug * 1.2);
    let fv = orderFinalQtys[p.id];
    if (fv === undefined || fv === '') return;
    let fo = parseInt(fv) || 0;
    if (fo <= 0) return;
    submittedOrders.push({ productId: p.id, quantity: fo, orderDate: od, deliveryDate: dd, suggested: sug, minSuggested: minS, maxSuggested: maxS });
    if (fo < minS || fo > maxS) pendC++;
    else autoC++;
  });
  if (autoC + pendC === 0) {
    showToast('No Oracle history saved because all final order quantities are zero.', 'info');
    return;
  }
  let savedOrders = [];
  try {
    let response = await fetch('/store-manager/oracle/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orders: submittedOrders }) });
    let result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to save Oracle order');
    savedOrders = result.orders || [];
  } catch (error) {
    showToast(error.message || 'Unable to save Oracle order', 'error');
    return;
  }
  submittedOrders.forEach(order => {
    let saved = savedOrders.find(item => item.productId === order.productId);
    if (saved?.status === 'approved') {
      let byDate = ORACLE_INCOMING_ORDERS[String(order.productId)] || (ORACLE_INCOMING_ORDERS[String(order.productId)] = {});
      byDate[order.deliveryDate] = (byDate[order.deliveryDate] || 0) + order.quantity;
    }
  });
  PRODUCTS.forEach(p => {
    let obj = submittedOrders.find(order => order.productId === p.id);
    if (!obj) return;
    let saved = savedOrders.find(order => order.productId === p.id);
    let historyObj = {
      id: saved ? `ORD-${saved.id}` : 'ORD-' + Math.random().toString(36).substr(2, 6).toUpperCase(),
      orderDateActual: obj.orderDate,
      delivDate: obj.deliveryDate,
      dayName,
      event: eventLabel,
      mode: useTarget ? 'Target Sales' : 'Avg Consumption',
      productId: p.id,
      productName: p.name,
      suggested: obj.suggested,
      minSug: obj.minSuggested,
      maxSug: obj.maxSuggested,
      finalOrder: obj.quantity,
      unitCost: p.plantPrice,
      totalCost: obj.quantity * p.plantPrice,
      multiplier: mult,
      manager,
      timestamp: new Date().toISOString()
    };
    if (saved?.status === 'pending') DB.pendingApprovals.push(historyObj);
    else DB.orderHistory.push(historyObj);
  });
  orderFinalQtys = {};
  showToast(pendC > 0 ? `${autoC} auto-approved. ${pendC} require Manager Approval.` : 'Order submitted!', pendC > 0 ? 'info' : 'success');
  renderOrderTable();
}

// ---------------------------------------------------------------- History
function groupOrderHistoryByDate() {
  let groups = {};
  DB.orderHistory.filter(order => Number(order.finalOrder || 0) >= 0).forEach(order => {
    let key = order.orderDateActual || 'No Date';
    if (!groups[key]) groups[key] = { date: key, items: [], deliveryDates: new Set(), managers: new Set(), suggestedTotal: 0, finalTotal: 0, totalCost: 0, latestTimestamp: '' };
    groups[key].items.push(order);
    if (order.delivDate) groups[key].deliveryDates.add(order.delivDate);
    if (order.manager) groups[key].managers.add(order.manager);
    groups[key].suggestedTotal += Number(order.suggested || 0);
    groups[key].finalTotal += Number(order.finalOrder || 0);
    groups[key].totalCost += Number(order.totalCost || 0);
    if (!groups[key].latestTimestamp || new Date(order.timestamp) > new Date(groups[key].latestTimestamp)) groups[key].latestTimestamp = order.timestamp;
  });
  return Object.values(groups).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function onHistoryFinalDblClick(event) {
  let el = event.currentTarget;
  editHistoryQty(el, el.dataset.orderId);
}

function buildHistoryWeek(g) {
  let week = cloneTemplate('tmpl-history-week');
  let dates = expandDateRange([...g.deliveryDates]);
  let products = [...new Map(g.items.map(item => [String(item.productId), item])).values()].sort((a, b) => String(a.productName).localeCompare(String(b.productName)));
  let byProductDate = {};
  g.items.forEach(item => {
    let key = `${item.productId}|${item.delivDate}`;
    if (!byProductDate[key]) byProductDate[key] = { final: 0, suggested: 0, min: 0, max: 0, orderId: item.id };
    byProductDate[key].final += Number(item.finalOrder || 0);
    byProductDate[key].suggested += Number(item.suggested || 0);
    byProductDate[key].min += Number(item.minSug || 0);
    byProductDate[key].max += Number(item.maxSug || 0);
  });
  setCell(week, 'title', 'Order week · ' + g.date);
  setCell(week, 'subtitle', `${dates.length} delivery days · ${products.length} products · ${[...g.managers].join(', ') || '—'}`);
  setCell(week, 'final_total', g.finalTotal.toLocaleString());
  setCell(week, 'total_cost', '₱' + g.totalCost.toLocaleString());
  let deleteBtn = getCell(week, 'delete_btn');
  deleteBtn.dataset.orderDate = g.date;
  deleteBtn.addEventListener('click', onDeleteOrderDateClick);
  getCell(week, 'table').style.minWidth = Math.max(760, 180 + dates.length * 145 + 100) + 'px';
  let headRow = getCell(week, 'head_row');
  dates.forEach(date => {
    let th = cloneTemplate('tmpl-history-head-date');
    setCell(th, 'date_label', formatPlanDate(date));
    insertBeforeCell(headRow, th, 'week_total_head');
  });
  let body = getCell(week, 'body');
  products.forEach(product => {
    let row = cloneTemplate('tmpl-history-product-row');
    setCell(row, 'name', product.productName);
    setCell(row, 'code', product.productId);
    let rowTotal = 0;
    dates.forEach(date => {
      let item = byProductDate[`${product.productId}|${date}`];
      if (!item) {
        insertBeforeCell(row, cloneTemplate('tmpl-history-empty-cell'), 'week_total');
        return;
      }
      rowTotal += Number(item.final || 0);
      let td = cloneTemplate('tmpl-history-day-cell');
      setCell(td, 'min', item.min);
      setCell(td, 'suggested', item.suggested);
      setCell(td, 'max', item.max);
      let finalEl = setCell(td, 'final', item.final);
      finalEl.dataset.quantity = item.final;
      finalEl.dataset.orderId = item.orderId;
      finalEl.addEventListener('dblclick', onHistoryFinalDblClick);
      insertBeforeCell(row, td, 'week_total');
    });
    setCell(row, 'week_total', rowTotal);
    body.appendChild(row);
  });
  let footRow = getCell(week, 'foot_row');
  dates.forEach(date => {
    let total = g.items.filter(item => item.delivDate === date).reduce((sum, item) => sum + Number(item.finalOrder || 0), 0);
    let td = cloneTemplate('tmpl-history-foot-cell');
    setCell(td, 'total', total);
    insertBeforeCell(footRow, td, 'week_total');
  });
  setCell(week, 'week_total', g.finalTotal);
  return week;
}

function renderHistory() {
  let container = document.getElementById('history-weekly-container');
  let detailPanel = document.getElementById('history-detail-panel');
  if (detailPanel) {
    detailPanel.classList.add('hidden');
    detailPanel.innerHTML = '';
    document.body.classList.remove('overflow-hidden');
  }
  HISTORY_GROUPS = groupOrderHistoryByDate();
  container.innerHTML = '';
  if (!HISTORY_GROUPS.length) {
    container.appendChild(cloneTemplate('tmpl-history-empty'));
    return;
  }
  HISTORY_GROUPS.forEach((g, index) => {
    let card = cloneTemplate('tmpl-history-card');
    setCell(card, 'title', 'Order week · ' + g.date);
    setCell(card, 'subtitle', `${expandDateRange([...g.deliveryDates]).length} delivery days · ${new Set(g.items.map(item => item.productId)).size} products · ${[...g.managers].join(', ') || '—'}`);
    setCell(card, 'final_total', g.finalTotal.toLocaleString());
    setCell(card, 'total_cost', '₱' + g.totalCost.toLocaleString());
    setCell(card, 'suggested_total', g.suggestedTotal.toLocaleString());
    let viewBtn = getCell(card, 'view_btn');
    viewBtn.dataset.index = index;
    viewBtn.addEventListener('click', onHistoryViewClick);
    let deleteBtn = getCell(card, 'delete_btn');
    deleteBtn.dataset.orderDate = g.date;
    deleteBtn.addEventListener('click', onDeleteOrderDateClick);
    container.appendChild(card);
  });
}

function onHistoryViewClick(event) {
  showHistoryWeek(Number(event.currentTarget.dataset.index));
}

function showHistoryWeek(index) {
  let detailPanel = document.getElementById('history-detail-panel');
  let g = HISTORY_GROUPS[index];
  if (!detailPanel || !g) return;
  let shell = cloneTemplate('tmpl-history-detail-shell');
  setCell(shell, 'title', 'Order week · ' + g.date);
  let exportBtn = getCell(shell, 'export_btn');
  exportBtn.dataset.orderDate = g.date;
  exportBtn.addEventListener('click', onExportHistoryClick);
  getCell(shell, 'close_btn').addEventListener('click', closeHistoryModal);
  getCell(shell, 'content').appendChild(buildHistoryWeek(g));
  detailPanel.innerHTML = '';
  detailPanel.appendChild(shell);
  detailPanel.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeHistoryModal() {
  document.getElementById('history-detail-panel').classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

async function editHistoryQty(cell, orderId) {
  if (!cell || !orderId || cell.isContentEditable) return;
  let current = cell.dataset.quantity || '0';
  cell.contentEditable = 'true';
  cell.setAttribute('aria-label', 'Edit final quantity');
  cell.classList.add('ring-2', 'ring-sky-400');
  cell.focus();
  let selection = window.getSelection();
  let range = document.createRange();
  range.selectNodeContents(cell);
  selection.removeAllRanges();
  selection.addRange(range);
  let saved = false;
  async function save() {
    if (saved) return;
    let quantity = Math.max(0, parseInt(cell.textContent.trim()) || 0);
    saved = true;
    try {
      let response = await fetch(`/store-manager/oracle/order/${encodeURIComponent(String(orderId).replace(/^ORD-/, ''))}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity }) });
      let result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to update quantity');
      showToast('Quantity updated', 'success');
      setTimeout(reloadPage, 350);
    } catch (error) {
      saved = false;
      cell.textContent = current;
      cell.contentEditable = 'false';
      cell.classList.remove('ring-2', 'ring-sky-400');
      showToast(error.message || 'Unable to update quantity', 'error');
    }
  }
  function onEditKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      cell.blur();
    }
    if (event.key === 'Escape') {
      saved = true;
      cell.textContent = current;
      cell.contentEditable = 'false';
      cell.classList.remove('ring-2', 'ring-sky-400');
    }
  }
  cell.addEventListener('blur', save, { once: true });
  cell.addEventListener('keydown', onEditKeyDown);
}

function onDeleteOrderDateClick(event) {
  deleteOracleOrderDate(event.currentTarget.dataset.orderDate);
}

function deleteOracleOrderDate(orderDate) {
  let message = `Delete all orders submitted on ${orderDate}?`;
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Delete Oracle orders',
      message: message,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      onConfirm: confirmDeleteOracleOrderDate.bind(null, orderDate)
    });
    return;
  }
  if (confirm(message)) confirmDeleteOracleOrderDate(orderDate);
}

async function confirmDeleteOracleOrderDate(orderDate) {
  try {
    let response = await fetch(`/store-manager/oracle/order-date/${encodeURIComponent(orderDate)}`, { method: 'DELETE' });
    let result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to delete order');
    let deleted = result.deleted || [];
    DB.orderHistory = DB.orderHistory.filter(order => String(order.orderDateActual) !== String(orderDate));
    deleted.forEach(order => {
      let byDate = ORACLE_INCOMING_ORDERS[String(order.productId)];
      if (byDate && order.deliveryDate) byDate[order.deliveryDate] = Math.max(0, (byDate[order.deliveryDate] || 0) - Number(order.quantity || 0));
    });
    renderHistory();
    showToast('Oracle order deleted', 'success');
  } catch (error) {
    showToast(error.message || 'Unable to delete order', 'error');
  }
}

function exportHistoryDateExcel(orderDate) {
  window.location.href = `/store-manager/oracle/export/${encodeURIComponent(orderDate)}`;
}

function onExportHistoryClick(event) {
  exportHistoryDateExcel(event.currentTarget.dataset.orderDate);
}

// ---------------------------------------------------------------- Daily averages
function getBulkOrderCell(productId, w, di) {
  let raw = (BULK_ORDER_PRODUCT_DATA[productId] && BULK_ORDER_PRODUCT_DATA[productId][w] && BULK_ORDER_PRODUCT_DATA[productId][w][di]) || null;
  if (!raw) return { qty: 0, date: '' };
  if (typeof raw === 'number') return { qty: Number(raw) || 0, date: '' };
  return { qty: Number(raw.qty || 0) || 0, date: raw.date || raw.upload_date || '' };
}

function renderDailyAverages() {
  renderWeeklyTables();
  renderAvgSummary();
}

function buildWeekDayCell(p, w, di, m) {
  let bulkCell = getBulkOrderCell(p.id, w, di);
  let bulkQty = bulkCell.qty || 0;
  let totalQty = salesData[p.id][w][di] || 0;
  let posQty = Math.max(totalQty - bulkQty, 0);
  let td = cloneTemplate('tmpl-week-day-cell');
  let qtyEl = setCell(td, 'qty', totalQty);
  qtyEl.style.background = m.iBg;
  qtyEl.style.border = '1px solid ' + m.iBd;
  qtyEl.style.color = m.iClr;
  if (bulkQty > 0) {
    getCell(td, 'tags').classList.remove('hidden');
    let posEl = setCell(td, 'pos', 'POS ' + posQty);
    posEl.title = `Actual POS Sold: ${posQty} qty (Total Sold ${totalQty} - Bulk Order ${bulkQty})`;
    let boEl = setCell(td, 'bo', 'BO ' + bulkQty);
    boEl.title = `Bulk Order: ${bulkQty} qty${bulkCell.date ? ` • Uploaded ${bulkCell.date}` : ''}`;
  }
  return td;
}

function buildWeekCard(w) {
  let m = WEEK_META[w];
  let card = cloneTemplate('tmpl-week-card');
  let dTots = DISP_TO_JS.map(di => PRODUCTS.reduce((s, p) => s + (salesData[p.id][w][di] || 0), 0));
  let wTot = dTots.reduce((s, v) => s + v, 0);
  let totRev = PRODUCTS.reduce((s, p) => s + DISP_TO_JS.reduce((ss, di) => ss + (salesData[p.id][w][di] || 0), 0) * p.sellingPrice, 0);
  let bulkInfo = BULK_ORDER_WEEKS[w] || {};
  addClasses(getCell(card, 'header'), m.hCls);
  addClasses(getCell(card, 'foot_row'), m.hCls);
  setCell(card, 'label', m.label);
  getCell(card, 'badges').appendChild(cloneTemplate(bulkInfo.has_bulk_order ? 'tmpl-week-bulk-yes' : 'tmpl-week-bulk-no'));
  setCell(card, 'units', wTot);
  setCell(card, 'revenue', '₱' + totRev.toLocaleString());
  if (bulkInfo.has_bulk_order) {
    getCell(card, 'bulk_detail').classList.remove('hidden');
    setCell(card, 'bulk_sales', '₱' + Number(bulkInfo.sales || 0).toLocaleString());
    setCell(card, 'bulk_tc', Number(bulkInfo.tc || 0).toLocaleString());
  }
  let headRow = getCell(card, 'head_row');
  DAYS_DISPLAY.forEach(d => {
    let th = cloneTemplate('tmpl-week-day-head');
    setCell(th, 'day', d.slice(0, 3));
    insertBeforeCell(headRow, th, 'week_total_head');
  });
  let body = getCell(card, 'body');
  PRODUCTS.forEach(p => {
    let row = cloneTemplate('tmpl-week-product-row');
    setCell(row, 'name', p.name);
    DISP_TO_JS.forEach(di => insertBeforeCell(row, buildWeekDayCell(p, w, di, m), 'total'));
    let rTot = DISP_TO_JS.reduce((s, di) => s + (salesData[p.id][w][di] || 0), 0);
    setCell(row, 'total', rTot);
    setCell(row, 'revenue', '₱' + (rTot * p.sellingPrice).toLocaleString());
    body.appendChild(row);
  });
  let footRow = getCell(card, 'foot_row');
  dTots.forEach(t => {
    let td = cloneTemplate('tmpl-week-foot-cell');
    setCell(td, 'total', t);
    insertBeforeCell(footRow, td, 'week_total');
  });
  setCell(card, 'week_total', wTot);
  setCell(card, 'week_revenue', '₱' + totRev.toLocaleString());
  return card;
}

function renderWeeklyTables() {
  let con = document.getElementById('weekly-sales-tables-container');
  con.innerHTML = '';
  for (let w = 0; w < 4; w++) con.appendChild(buildWeekCard(w));
}

function renderAvgSummary() {
  let aS = {}, aR = {};
  PRODUCTS.forEach(p => {
    aS[p.id] = DISP_TO_JS.map(di => salesData[p.id].reduce((s, wk, weekIndex) => s + getOrganicSales(p.id, weekIndex, di), 0) / 4);
    aR[p.id] = aS[p.id].map(a => a * p.sellingPrice);
  });
  let cU = DISP_TO_JS.map((_, ci) => PRODUCTS.reduce((s, p) => s + aS[p.id][ci], 0));
  let cR = DISP_TO_JS.map((_, ci) => PRODUCTS.reduce((s, p) => s + aR[p.id][ci], 0));
  let pU = PRODUCTS.map(p => aS[p.id].reduce((s, v) => s + v, 0));
  let pR = PRODUCTS.map(p => aR[p.id].reduce((s, v) => s + v, 0));
  let gU = pU.reduce((s, v) => s + v, 0);
  let gR = pR.reduce((s, v) => s + v, 0);
  let body = document.getElementById('avg-summary-body');
  let foot = document.getElementById('avg-summary-foot');
  body.innerHTML = '';
  foot.innerHTML = '';
  PRODUCTS.forEach((p, pi) => {
    let row = cloneTemplate('tmpl-avg-row');
    setCell(row, 'name', p.name);
    setCell(row, 'category', p.category);
    aS[p.id].forEach((avg, ci) => {
      let rev = aR[p.id][ci];
      let pct = cR[ci] > 0 ? (rev / cR[ci] * 100).toFixed(1) : '0.0';
      let td = cloneTemplate('tmpl-avg-cell');
      setCell(td, 'avg', avg.toFixed(1));
      setCell(td, 'pct', pct + '%');
      setCell(td, 'rev', '₱' + rev.toFixed(0));
      insertBeforeCell(row, td, 'total_cell');
    });
    let pct4 = gR > 0 ? (pR[pi] / gR * 100).toFixed(1) : '0.0';
    setCell(row, 'total_avg', pU[pi].toFixed(1));
    setCell(row, 'total_pct', pct4 + '%');
    setCell(row, 'total_rev', '₱' + pR[pi].toFixed(0));
    body.appendChild(row);
  });
  let footRow = cloneTemplate('tmpl-avg-foot-row');
  DISP_TO_JS.forEach((_, ci) => {
    let td = cloneTemplate('tmpl-avg-foot-cell');
    setCell(td, 'avg', cU[ci].toFixed(1));
    setCell(td, 'rev', '₱' + cR[ci].toFixed(0));
    insertBeforeCell(footRow, td, 'total_cell');
  });
  setCell(footRow, 'total_avg', gU.toFixed(1));
  setCell(footRow, 'total_rev', '₱' + gR.toFixed(0));
  foot.appendChild(footRow);
}

// ---------------------------------------------------------------- Listeners
function bindEvent(id, eventName, handler) {
  let el = document.getElementById(id);
  if (el) el.addEventListener(eventName, handler);
}

function bindOracleListeners() {
  bindEvent('order-date', 'change', onOrderDateChange);
  bindEvent('delivery-date', 'change', onDeliveryDateChange);
  bindEvent('delivery-end-date', 'change', onDeliveryEndChange);
  bindEvent('mode-weekly', 'click', onModeWeeklyClick);
  bindEvent('mode-single', 'click', onModeSingleClick);
  bindEvent('forecast-event', 'change', updateMultiplier);
  bindEvent('target-sales-input', 'input', onTargetSalesChange);
  bindEvent('product-search-input', 'input', onSearchInput);
  bindEvent('btn-new-order', 'click', onNewOrderClick);
  bindEvent('btn-submit-order', 'click', submitOrder);
  bindEvent('btn-fullscreen', 'click', toggleOrderFullscreen);
  bindEvent('btn-exit-fullscreen', 'click', toggleOrderFullscreen);  bindEvent('cluster-save-buffers', 'click', saveBuffersToCluster);
  bindEvent('btn-refresh-suggested', 'click', refreshSuggested);
  bindEvent('btn-clear-overrides', 'click', clearFinalOrders);
  bindEvent('btn-history-refresh', 'click', renderHistory);
  document.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', onNavClick));
  let allBtn = document.querySelector('[data-category-filter="all"]');
  if (allBtn) allBtn.addEventListener('click', onCategoryFilterClick);
  document.addEventListener('keydown', onDocumentKeyDown);
}

bindOracleListeners();
applyViewVisibility();
syncFullscreenButton('order-form');
applyOrderModePanels();
loadOracleData();
