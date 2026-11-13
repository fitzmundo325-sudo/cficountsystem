let PER_PAGE = 50;
let SENTINEL_ID = '987654321';
let API_FILTERS = '/apis/delivery_filters';
let API_CONSOLIDATED = '/apis/delivery_consolidated';
let API_REVIEW = '/apis/delivery_review';
let URL_KEYS = ['tab', 'apply', 'cluster_id', 'store_id', 'start_date', 'end_date', 'page', 'sort', 'order_by', 'review_store_id', 'review_date', 'review_sort', 'review_order'];
let CONSOLIDATED_SORT_KEYS = ['store_name', 'report_date', 'product_name', 'upload_source', 'entry_count', 'quantity', 'received_quantity'];
let REVIEW_SORT_KEYS = ['rso_no', 'product_name', 'quantity', 'received_quantity', 'upload_source', 'reviewed_date'];

let TOUR_STEPS = [
  { ids: ['delivery-admin-tab-consolidated', 'delivery-admin-tab-review'], text: 'Switch between Consolidated View (all stores) and Store Date Review (per-store detail).', placement: 'bottom' },
  { ids: ['delivery-admin-cluster-field'], text: 'Select a Cluster to filter stores by group.', placement: 'bottom', tab: 'consolidated' },
  { ids: ['delivery-admin-store-field'], text: 'Optionally pick a specific Store after selecting a Cluster.', placement: 'bottom', tab: 'consolidated' },
  { ids: ['delivery-admin-start-date-field'], text: 'Choose the Start Date for the delivery date range.', placement: 'bottom', tab: 'consolidated' },
  { ids: ['delivery-admin-end-date-field'], text: 'Choose the End Date for the delivery date range.', placement: 'bottom', tab: 'consolidated' },
  { ids: ['delivery-admin-apply-btn', 'delivery-admin-reset-btn'], text: 'Click Apply to load data or Reset to clear filters.', placement: 'bottom', tab: 'consolidated' },
  { ids: ['delivery-admin-summary-cards'], text: 'Summary cards show Rows, Stores, Total Qty, and Total Received Qty.', placement: 'bottom', tab: 'consolidated' },
  { ids: ['delivery-admin-data-table'], text: 'The table lists all delivery entries grouped by store, date, and product.', placement: 'top', tab: 'consolidated' },
  { ids: ['delivery-admin-review-store-field'], text: 'Select a Store to review its delivery entries.', placement: 'bottom', tab: 'review' },
  { ids: ['delivery-admin-review-date-field'], text: 'Pick the report date for the store delivery review.', placement: 'bottom', tab: 'review' },
  { ids: ['delivery-admin-load-review-btn', 'delivery-admin-review-reset-btn'], text: 'Click Load Review to load entries or Reset to start over.', placement: 'bottom', tab: 'review' },
  { ids: ['delivery-admin-review-summary'], text: 'Summary cards show Rows, Total Qty, and Total Received Qty for this store/date.', placement: 'bottom', tab: 'review' },
  { ids: ['delivery-admin-review-table'], text: 'Review individual entries. Use Edit to change quantities or Delete to remove a row.', placement: 'top', tab: 'review' }
];

let state = {
  tab: 'consolidated',
  canEdit: false,
  clusters: [],
  stores: [],
  defaultStartDate: '',
  today: '',
  page: 1,
  filtersReady: false,
  consolidatedLoaded: false,
  sort: { consolidated: { column: '', order: 'asc' }, review: { column: '', order: 'asc' } },
  review: { loaded: false, storeId: '', date: '', rows: [] },
  pendingRow: null
};

let tourStepIndex = 0;
let editModal = null;
let deleteModal = null;
let deleteAllModal = null;
let exportModal = null;
let exportButtonHtml = '';

// - Helpers -

function byId(id) {
  return document.getElementById(id);
}

function setCell(node, name, text) {
  let el = node.querySelector('[data-cell="' + name + '"]');
  if (el) {
    el.textContent = text;
  }
  return el;
}

function buildBody(params) {
  let body = new URLSearchParams();
  Object.keys(params).forEach(function(key) {
    body.append(key, params[key]);
  });
  return body;
}

function fetchJson(url, params) {
  return fetch(url, { method: 'POST', body: buildBody(params), credentials: 'same-origin' })
    .then(function(response) { return response.json(); });
}

function postLegacy(url, params) {
  return fetch(url, { method: 'POST', body: buildBody(params), credentials: 'same-origin', redirect: 'manual' });
}

function monitorChangesHere(key = "shouldReload", loader = undefined, custom_counter = 2000) {
  let timer_c = setInterval(check, custom_counter);
  function check() {
    if (firstLoad) {
      firstLoad = false;
      return;
    }
    let rl = localStorage.getItem(key);
    if (rl == 'true') {
      localStorage.removeItem(key);
      if (loader == undefined) {
      } else {
        loader();
      }
    }
  }
}

function setBusy(button, busy) {
  if (button) {
    button.disabled = busy;
  }
  if (busy) {
    addLoading(button);
  } else {
    removeLoading();
  }
}

function applyManualParts(node, isManual, note) {
  if (!isManual) {
    node.querySelector('[data-cell="manual-badge"]').remove();
  }
  let noteEl = node.querySelector('[data-cell="note"]');
  if (note) {
    noteEl.textContent = note;
  } else {
    noteEl.remove();
  }
}

// - URL sync -

function syncUrl(extra) {
  let params = new URLSearchParams(window.location.search);
  URL_KEYS.forEach(function(key) { params.delete(key); });
  Object.keys(extra).forEach(function(key) {
    if (extra[key] !== '' && extra[key] !== null && extra[key] !== undefined) {
      params.set(key, extra[key]);
    }
  });
  history.pushState({}, '', '?' + params.toString());
}

function syncCurrentUrl() {
  let extra = { tab: state.tab };
  if (state.tab === 'consolidated' && state.consolidatedLoaded) {
    extra.apply = '1';
    extra.cluster_id = byId('cluster_id').value;
    extra.store_id = byId('store_id').value;
    extra.start_date = byId('consolidated_start_date').value;
    extra.end_date = byId('consolidated_end_date').value;
    extra.page = state.page;
    if (state.sort.consolidated.column) {
      extra.sort = state.sort.consolidated.column;
      extra.order_by = state.sort.consolidated.order;
    }
  }
  if (state.tab === 'review' && state.review.loaded) {
    extra.review_store_id = state.review.storeId;
    extra.review_date = state.review.date;
    if (state.sort.review.column) {
      extra.review_sort = state.sort.review.column;
      extra.review_order = state.sort.review.order;
    }
  }
  syncUrl(extra);
}

// - Tabs -

function setTab(tab) {
  state.tab = tab;
  byId('panel-consolidated').classList.toggle('hidden', tab !== 'consolidated');
  byId('panel-review').classList.toggle('hidden', tab !== 'review');
  document.querySelectorAll('.tab-btn').forEach(function(button) {
    let active = button.dataset.tab === tab;
    UI_CLASSES.tabActive.split(' ').forEach(function(name) { button.classList.toggle(name, active); });
    UI_CLASSES.tabInactive.split(' ').forEach(function(name) { button.classList.toggle(name, !active); });
  });
}

function onTabClick(event) {
  let button = event.target.closest('.tab-btn');
  if (!button) {
    return;
  }
  setTab(button.dataset.tab);
  syncCurrentUrl();
}

// - Sorting -

function sortParams(scope) {
  let current = state.sort[scope];
  if (!current.column) {
    return {};
  }
  return { sort: current.column, order_by: current.order };
}

function readSortFromUrl(params, columnKey, orderKey, allowedKeys) {
  let column = params.get(columnKey) || '';
  if (allowedKeys.indexOf(column) === -1) {
    column = '';
  }
  return { column: column, order: params.get(orderKey) === 'desc' ? 'desc' : 'asc' };
}

function toggleSort(scope, column) {
  let current = state.sort[scope];
  if (current.column === column) {
    current.order = current.order === 'asc' ? 'desc' : 'asc';
  } else {
    current.column = column;
    current.order = 'asc';
  }
}

function renderSortIndicators(scope) {
  let current = state.sort[scope];
  byId(scope + '-head').querySelectorAll('[data-sort]').forEach(function(header) {
    let icon = header.querySelector('[data-sort-icon]');
    let active = header.dataset.sort === current.column;
    icon.textContent = active ? (current.order === 'desc' ? '\u25bc' : '\u25b2') : '\u2195';
    UI_CLASSES.sortActive.split(' ').forEach(function(name) { icon.classList.toggle(name, active); });
    UI_CLASSES.sortInactive.split(' ').forEach(function(name) { icon.classList.toggle(name, !active); });
    header.setAttribute('aria-sort', active ? (current.order === 'desc' ? 'descending' : 'ascending') : 'none');
  });
}

function onSortClick(event) {
  let header = event.target.closest('[data-sort]');
  if (!header) {
    return;
  }
  let scope = header.dataset.sortScope;
  toggleSort(scope, header.dataset.sort);
  if (scope === 'consolidated') {
    state.page = 1;
    loadConsolidated(true);
  } else {
    refreshReview();
  }
}

// - Filters -

function fillClusterSelect(select, placeholder, selectedId) {
  select.innerHTML = '';
  if (placeholder) {
    let blank = document.createElement('option');
    blank.value = '';
    blank.text = placeholder;
    select.appendChild(blank);
  }
  state.clusters.forEach(function(cluster) {
    let option = document.createElement('option');
    option.value = String(cluster.id);
    option.text = cluster.name;
    if (selectedId && String(cluster.id) === String(selectedId)) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function populateStoreSelect(clusterId, selectedId) {
  let select = byId('store_id');
  select.innerHTML = '';
  let blank = document.createElement('option');
  blank.value = '';
  if (!clusterId) {
    blank.text = 'Select Cluster First';
    select.appendChild(blank);
    select.disabled = true;
    return;
  }
  blank.text = 'Select Store (Optional)';
  select.appendChild(blank);
  select.disabled = false;
  state.stores
    .filter(function(store) { return Number(store.cluster_id) === Number(clusterId); })
    .sort(function(a, b) { return String(a.name || '').localeCompare(String(b.name || '')); })
    .forEach(function(store) {
      let option = document.createElement('option');
      option.value = String(store.id);
      option.text = store.name || ('Store ' + store.id);
      if (selectedId && String(store.id) === String(selectedId)) {
        option.selected = true;
      }
      select.appendChild(option);
    });
}

function populateReviewStores() {
  let select = byId('review_store_id');
  select.innerHTML = '';
  let blank = document.createElement('option');
  blank.value = '';
  blank.text = 'Select Store';
  select.appendChild(blank);
  state.stores.forEach(function(store) {
    let option = document.createElement('option');
    option.value = String(store.id);
    option.text = store.name || ('Store ' + store.id);
    select.appendChild(option);
  });
}

function loadFilters() {
  fetchJson(API_FILTERS, {})
    .then(onFiltersLoaded)
    .catch(function() { toast.error('Failed to load filters.'); });
}

function onFiltersLoaded(data) {
  if (data.type !== 'success') {
    toast.error(data.message || 'Failed to load filters.');
    return;
  }
  state.clusters = data.clusters || [];
  state.stores = data.stores || [];
  state.canEdit = !!data.can_edit;
  state.defaultStartDate = data.default_start_date || '';
  state.today = data.today || '';
  state.filtersReady = true;
  fillClusterSelect(byId('cluster_id'), 'Select Cluster', '');
  populateReviewStores();
  if (data.warning) {
    toast.warning(data.warning);
  }
  restoreFromUrl();
}

function onClusterChange() {
  populateStoreSelect(byId('cluster_id').value, '');
}

function restoreFromUrl() {
  let params = new URLSearchParams(window.location.search);
  let tab = params.get('tab') === 'review' ? 'review' : 'consolidated';
  let clusterId = params.get('cluster_id') || '';
  byId('cluster_id').value = clusterId;
  if (byId('cluster_id').value !== clusterId) {
    clusterId = '';
  }
  populateStoreSelect(clusterId, params.get('store_id') || '');
  byId('consolidated_start_date').value = params.get('start_date') || state.defaultStartDate;
  byId('consolidated_end_date').value = params.get('end_date') || '';
  byId('review_store_id').value = params.get('review_store_id') || '';
  byId('review_date').value = params.get('review_date') || state.today;
  state.page = Number(params.get('page')) || 1;
  state.sort.consolidated = readSortFromUrl(params, 'sort', 'order_by', CONSOLIDATED_SORT_KEYS);
  state.sort.review = readSortFromUrl(params, 'review_sort', 'review_order', REVIEW_SORT_KEYS);
  renderSortIndicators('consolidated');
  renderSortIndicators('review');
  setTab(tab);
  if (tab === 'consolidated' && params.get('apply') === '1' && clusterId) {
    loadConsolidated(false);
  } else if (tab === 'consolidated') {
    showConsolidatedInitial();
  }
  if (tab === 'review' && params.get('review_store_id')) {
    loadReview(false);
  }
}

function onPopState() {
  if (state.filtersReady) {
    restoreFromUrl();
  }
}

// - Consolidated -

function showConsolidatedInitial() {
  state.consolidatedLoaded = false;
  byId('consolidated-initial').classList.remove('hidden');
  byId('consolidated-results').classList.add('hidden');
  byId('openExportDeliveryModal').classList.add('hidden');
  byId('consolidated-warning').classList.add('hidden');
}

function setApplyBusy(busy) {
  setBusy(byId('delivery-admin-apply-btn'), busy);
}

function onConsolidatedSubmit(event) {
  event.preventDefault();
  state.page = 1;
  loadConsolidated(true);
}

function loadConsolidated(push) {
  let clusterId = byId('cluster_id').value;
  let storeId = byId('store_id').value;
  let startDate = byId('consolidated_start_date').value;
  let endDate = byId('consolidated_end_date').value;
  if (!clusterId) {
    toast.warning('Please select a cluster first.');
    return;
  }
  if (!startDate || !endDate) {
    toast.warning('Please select valid start and end dates.');
    return;
  }
  let params = { cluster_id: clusterId, start_date: startDate, end_date: endDate, page: state.page };
  if (storeId) {
    params.store_id = storeId;
  }
  Object.assign(params, sortParams('consolidated'));
  setApplyBusy(true);
  fetchJson(API_CONSOLIDATED, params)
    .then(function(data) { onConsolidatedSuccess(data, push); })
    .catch(onConsolidatedError);
}

function onConsolidatedSuccess(data, push) {
  setApplyBusy(false);
  if (data.type !== 'success') {
    toast.error(data.message || 'Failed to load delivery data.');
    showConsolidatedInitial();
    return;
  }
  byId('consolidated_start_date').value = data.start_date;
  byId('consolidated_end_date').value = data.end_date;
  state.page = data.current_page;

  let warning = byId('consolidated-warning');
  if (data.warning) {
    warning.textContent = data.warning;
    warning.classList.remove('hidden');
    byId('store_id').value = '';
  } else {
    warning.classList.add('hidden');
  }

  state.consolidatedLoaded = true;
  byId('consolidated-initial').classList.add('hidden');
  byId('consolidated-results').classList.remove('hidden');
  byId('openExportDeliveryModal').classList.remove('hidden');

  renderSummary(data.summary);
  renderConsolidatedRows(data.data || []);
  renderPagination(data);
  renderSortIndicators('consolidated');

  if (push) {
    syncCurrentUrl();
  }
}

function onConsolidatedError() {
  setApplyBusy(false);
  toast.error('Failed to load delivery data.');
}

function renderSummary(summary) {
  byId('sum-rows').textContent = summary.rows_count;
  byId('sum-stores').textContent = summary.stores_count;
  byId('sum-qty').textContent = summary.total_qty;
  byId('sum-received').textContent = summary.total_received_qty;
}

function renderConsolidatedRows(rows) {
  let body = byId('consolidated-body');
  let template = byId('tmpl-delivery-row');
  body.innerHTML = '';
  byId('consolidated-empty').classList.toggle('hidden', rows.length > 0);
  rows.forEach(function(row) {
    let node = template.content.firstElementChild.cloneNode(true);
    setCell(node, 'store', row.store_name);
    setCell(node, 'date', row.report_date || '--');
    setCell(node, 'product', row.product_name);
    setCell(node, 'source', row.upload_source);
    setCell(node, 'entries', row.entry_count);
    setCell(node, 'quantity', row.quantity);
    setCell(node, 'received', row.received_quantity);
    applyManualParts(node, row.has_manual, row.manual_note);
    body.appendChild(node);
  });
}

function makePageButton(label, page) {
  let button = document.createElement('button');
  button.type = 'button';
  button.dataset.page = String(page);
  button.className = UI_CLASSES.pageButton;
  button.textContent = label;
  return button;
}

function renderPagination(data) {
  let container = byId('consolidated-pagination');
  let page = data.current_page;
  let totalPages = data.total_pages;
  let total = data.total_results;
  if (totalPages <= 1) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  let start = ((page - 1) * PER_PAGE) + 1;
  let end = Math.min(page * PER_PAGE, total);
  byId('pagination-info').textContent = 'Showing ' + start + '\u2013' + end + ' of ' + total + ' results';

  let holder = byId('pagination-buttons');
  holder.innerHTML = '';
  if (page > 1) {
    holder.appendChild(makePageButton('\u00ab Prev', page - 1));
  }
  for (let p = 1; p <= totalPages; p++) {
    if (p === page) {
      let current = document.createElement('span');
      current.className = UI_CLASSES.pageCurrent;
      current.textContent = String(p);
      holder.appendChild(current);
    } else if (p <= 3 || p > totalPages - 3 || (p >= page - 1 && p <= page + 1)) {
      holder.appendChild(makePageButton(String(p), p));
    } else if (p === 4 || p === totalPages - 3) {
      let gap = document.createElement('span');
      gap.className = UI_CLASSES.pageGap;
      gap.textContent = '\u2026';
      holder.appendChild(gap);
    }
  }
  if (page < totalPages) {
    holder.appendChild(makePageButton('Next \u00bb', page + 1));
  }
}

function onPaginationClick(event) {
  let button = event.target.closest('[data-page]');
  if (!button) {
    return;
  }
  state.page = Number(button.dataset.page);
  loadConsolidated(true);
}

function onConsolidatedReset() {
  byId('cluster_id').value = '';
  populateStoreSelect('', '');
  byId('consolidated_start_date').value = state.defaultStartDate;
  byId('consolidated_end_date').value = '';
  state.page = 1;
  state.sort.consolidated = { column: '', order: 'asc' };
  renderSortIndicators('consolidated');
  showConsolidatedInitial();
  syncCurrentUrl();
}

// - Export -

function currentExportOption() {
  let checked = document.querySelector('#exportDeliveryModal input[name="export_option"]:checked');
  return checked ? checked.value : 'cluster_range';
}

function applyExportOption(optionValue) {
  let parts = (optionValue || 'cluster_range').split('_');
  let scope = parts[0] === 'all' ? 'all' : 'cluster';
  let type = parts[1] === 'all' ? 'all' : 'range';
  byId('export_scope').value = scope;
  byId('export_type').value = type;
  byId('deliveryRangeFields').classList.toggle('hidden', type !== 'range');
  byId('deliveryExportClusterField').classList.toggle('hidden', scope !== 'cluster');
  byId('export_del_cluster_id').required = scope === 'cluster';
  if (scope !== 'cluster') {
    byId('export_store_id').value = '';
  }
}

function onExportOptionChange(event) {
  applyExportOption(event.target.value);
}

function onExportClusterChange() {
  byId('export_store_id').value = '';
}

function resetExportButton() {
  let button = byId('export-submit');
  button.disabled = false;
  button.innerHTML = exportButtonHtml;
}

function openExportModal() {
  let select = byId('export_del_cluster_id');
  let selectedCluster = byId('cluster_id').value;
  if (state.clusters.length === 0) {
    select.innerHTML = '<option value="">No Clusters Available</option>';
  } else {
    fillClusterSelect(select, selectedCluster ? '' : 'Select a Cluster', selectedCluster);
  }
  byId('export_del_start_date').value = byId('consolidated_start_date').value;
  byId('export_del_end_date').value = byId('consolidated_end_date').value;
  byId('export_store_id').value = byId('store_id').value;
  resetExportButton();
  applyExportOption(currentExportOption());
  exportModal.open();
}

function closeExportModal() {
  exportModal.close();
  resetExportButton();
}

function onExportSubmit() {
  applyExportOption(currentExportOption());
  let button = byId('export-submit');
  button.disabled = true;
  button.innerHTML = SPINNER_HTML + 'Downloading...';
  setTimeout(closeExportModal, 1000);
}

// - Review -

function requestReview(storeId, date) {
  let params = { review_store_id: storeId, review_date: date };
  Object.assign(params, sortParams('review'));
  return fetchJson(API_REVIEW, params);
}

function onReviewSubmit(event) {
  event.preventDefault();
  loadReview(true);
}

function loadReview(push) {
  let storeId = byId('review_store_id').value;
  let date = byId('review_date').value;
  if (!storeId) {
    toast.warning('Please select a store first.');
    return;
  }
  setBusy(byId('delivery-admin-load-review-btn'), true);
  requestReview(storeId, date)
    .then(function(data) { onReviewLoaded(data, storeId, push); })
    .catch(onReviewError);
}

function onReviewLoaded(data, storeId, push) {
  setBusy(byId('delivery-admin-load-review-btn'), false);
  if (data.type !== 'success') {
    toast.error(data.message || 'Failed to load review.');
    byId('review-results').classList.add('hidden');
    return;
  }
  state.review.storeId = storeId;
  state.review.loaded = true;
  renderReview(data);
  if (push) {
    syncCurrentUrl();
  }
}

function onReviewError() {
  setBusy(byId('delivery-admin-load-review-btn'), false);
  toast.error('Failed to load review.');
}

function refreshReview() {
  requestReview(state.review.storeId, state.review.date)
    .then(function(data) {
      if (data.type !== 'success') {
        toast.error(data.message || 'Failed to load review.');
        return;
      }
      renderReview(data);
      syncCurrentUrl();
    })
    .catch(onReviewError);
}

function renderReview(data) {
  state.canEdit = !!data.can_edit;
  state.review.date = data.review_date;
  state.review.rows = data.data || [];
  byId('review_date').value = data.review_date;
  byId('review-results').classList.remove('hidden');

  let summary = data.summary;
  byId('rev-rows').textContent = summary.rows_count;
  byId('rev-qty').textContent = summary.total_qty;
  byId('rev-received').textContent = summary.total_received_qty;

  byId('review-meta').textContent = data.review_date;
  byId('openDeleteAllDeliveryModal').classList.toggle('hidden', !(state.canEdit && state.review.rows.length > 0));
  byId('review-actions-th').classList.toggle('hidden', !state.canEdit);
  renderReviewRows();
  renderSortIndicators('review');
}

function renderReviewRows() {
  let body = byId('review-body');
  let template = byId('tmpl-review-row');
  body.innerHTML = '';
  byId('review-empty').classList.toggle('hidden', state.review.rows.length > 0);
  state.review.rows.forEach(function(row, index) {
    let node = template.content.firstElementChild.cloneNode(true);
    setCell(node, 'rso', row.rso_no || '--');
    setCell(node, 'product', row.product_name);
    setCell(node, 'quantity', row.quantity);
    setCell(node, 'received', row.received_quantity);
    setCell(node, 'source', row.upload_source);
    setCell(node, 'reviewed', row.reviewed_date || '--');
    applyManualParts(node, row.is_manual, row.manual_note);
    if (state.canEdit) {
      node.querySelectorAll('[data-action]').forEach(function(button) { button.dataset.index = String(index); });
    } else {
      node.querySelector('[data-cell="actions"]').remove();
    }
    body.appendChild(node);
  });
}

function onReviewReset() {
  byId('review_store_id').value = '';
  byId('review_date').value = state.today;
  state.review.loaded = false;
  state.sort.review = { column: '', order: 'asc' };
  renderSortIndicators('review');
  byId('review-results').classList.add('hidden');
  syncCurrentUrl();
}

function onReviewBodyClick(event) {
  let button = event.target.closest('[data-action]');
  if (!button) {
    return;
  }
  let row = state.review.rows[Number(button.dataset.index)];
  if (!row) {
    return;
  }
  if (button.dataset.action === 'edit') {
    openEditModal(row);
  } else {
    openDeleteModal(row);
  }
}

// - Row actions -

function buildRowUrl(row, kind) {
  let template = kind === 'edit' ? DELIVERY_ROUTES.edit : DELIVERY_ROUTES.remove;
  return template.replace(SENTINEL_ID, row.id);
}

function baseActionParams() {
  return { review_store_id: state.review.storeId, review_date: state.review.date };
}

function runLegacyAction(config) {
  let before = state.review.rows.length;
  setBusy(config.button, true);
  postLegacy(config.url, config.params)
    .then(function() { return requestReview(state.review.storeId, state.review.date); })
    .then(function(data) {
      setBusy(config.button, false);
      if (data.type !== 'success') {
        toast.error(data.message || 'Failed to refresh review.');
        return;
      }
      renderReview(data);
      if (config.check(data, before)) {
        config.modal.close();
        toast.success(config.successMessage);
      } else {
        toast.error(config.failMessage);
      }
    })
    .catch(function() {
      setBusy(config.button, false);
      toast.error('Request failed. Please try again.');
    });
}

function rowValuesMatch(data, row, quantity, received) {
  let found = (data.data || []).find(function(item) { return item.id === row.id; });
  if (!found) {
    return false;
  }
  let expectedReceived = received === '' ? quantity : received;
  return Number(found.quantity) === Number(quantity) && Number(found.received_quantity) === Number(expectedReceived);
}

function openEditModal(row) {
  state.pendingRow = row;
  byId('editDeliveryProductName').textContent = row.product_name || 'This item';
  byId('edit_delivery_quantity').value = row.quantity;
  byId('edit_delivery_received_quantity').value = row.received_quantity_raw === null ? '' : row.received_quantity_raw;
  editModal.open();
  setTimeout(function() { byId('edit_delivery_quantity').focus(); }, 50);
}

function onEditSubmit(event) {
  event.preventDefault();
  let row = state.pendingRow;
  let quantity = byId('edit_delivery_quantity').value;
  let received = byId('edit_delivery_received_quantity').value;
  if (!row || quantity === '' || Number(quantity) < 0 || (received !== '' && Number(received) < 0)) {
    toast.warning('Please enter valid quantities.');
    return;
  }
  let params = baseActionParams();
  params.quantity = quantity;
  params.received_quantity = received;
  runLegacyAction({
    url: buildRowUrl(row, 'edit'),
    params: params,
    button: byId('editDeliveryBtn'),
    modal: editModal,
    check: function(data) { return rowValuesMatch(data, row, quantity, received); },
    successMessage: 'Delivery entry updated.',
    failMessage: 'Entry was not updated. Please try again.'
  });
}

function openDeleteModal(row) {
  state.pendingRow = row;
  byId('deleteDeliveryProductName').textContent = row.product_name || 'This item';
  byId('deleteDeliveryQty').textContent = row.quantity;
  byId('deleteDeliveryReceived').textContent = row.received_quantity;
  byId('delete_row_admin_password').value = '';
  deleteModal.open();
  setTimeout(function() { byId('delete_row_admin_password').focus(); }, 50);
}

function onDeleteSubmit(event) {
  event.preventDefault();
  let row = state.pendingRow;
  let password = byId('delete_row_admin_password').value;
  if (!row || !password) {
    toast.warning('Please enter your admin password.');
    return;
  }
  let params = baseActionParams();
  params.admin_password = password;
  runLegacyAction({
    url: buildRowUrl(row, 'delete'),
    params: params,
    button: byId('deleteDeliveryBtn'),
    modal: deleteModal,
    check: function(data, before) { return data.summary.rows_count < before; },
    successMessage: 'Delivery entry deleted.',
    failMessage: 'Entry was not deleted. Please check your admin password.'
  });
  byId('delete_row_admin_password').value = '';
}

function openDeleteAllModal() {
  byId('deleteAllDeliveryCount').textContent = state.review.rows.length;
  byId('delete_all_admin_password').value = '';
  deleteAllModal.open();
  setTimeout(function() { byId('delete_all_admin_password').focus(); }, 50);
}

function onDeleteAllSubmit(event) {
  event.preventDefault();
  let password = byId('delete_all_admin_password').value;
  if (!password) {
    toast.warning('Please enter your admin password.');
    return;
  }
  let params = baseActionParams();
  params.admin_password = password;
  runLegacyAction({
    url: DELIVERY_ROUTES.removeAll,
    params: params,
    button: byId('deleteAllDeliveryBtn'),
    modal: deleteAllModal,
    check: function(data) { return data.summary.rows_count === 0; },
    successMessage: 'All Delivery entries deleted.',
    failMessage: 'Entries were not deleted. Please check your admin password.'
  });
  byId('delete_all_admin_password').value = '';
}

// - Help tour -

function tourElements(step) {
  return step.ids
    .map(function(id) { return byId(id); })
    .filter(function(el) { return el && el.offsetParent !== null; });
}

function getTourSteps() {
  return TOUR_STEPS.filter(function(step) {
    if (step.tab && step.tab !== state.tab) {
      return false;
    }
    return tourElements(step).length > 0;
  });
}

function getTourStep() {
  return getTourSteps()[tourStepIndex] || null;
}

function removeTourPanels() {
  document.querySelectorAll('.delivery-admin-tour-panel').forEach(function(el) { el.remove(); });
  document.querySelectorAll('.delivery-admin-tour-label').forEach(function(el) { el.remove(); });
}

function clearTourTargets() {
  document.querySelectorAll('.delivery-admin-tour-target').forEach(function(el) {
    el.classList.remove('delivery-admin-tour-target');
  });
}

function clearTour() {
  tourStepIndex = 0;
  removeTourPanels();
  clearTourTargets();
}

function applyTourTarget() {
  clearTourTargets();
  let step = getTourStep();
  if (!step) {
    return;
  }
  tourElements(step).forEach(function(el) { el.classList.add('delivery-admin-tour-target'); });
}

function getTourRect(elements) {
  if (!elements.length) {
    return null;
  }
  let rects = elements.map(function(el) { return el.getBoundingClientRect(); });
  let pad = 10;
  return {
    top: Math.max(0, Math.min.apply(null, rects.map(function(r) { return r.top; })) - pad),
    left: Math.max(0, Math.min.apply(null, rects.map(function(r) { return r.left; })) - pad),
    right: Math.min(window.innerWidth, Math.max.apply(null, rects.map(function(r) { return r.right; })) + pad),
    bottom: Math.min(window.innerHeight, Math.max.apply(null, rects.map(function(r) { return r.bottom; })) + pad)
  };
}

function onTourNext() {
  tourStepIndex += 1;
  showTourStep();
}

function renderSpotlight() {
  removeTourPanels();
  let step = getTourStep();
  if (!step) {
    clearTour();
    return;
  }
  let rect = getTourRect(tourElements(step));
  if (!rect) {
    return;
  }
  let panels = [
    { top: 0, left: 0, width: window.innerWidth, height: rect.top },
    { top: rect.bottom, left: 0, width: window.innerWidth, height: window.innerHeight - rect.bottom },
    { top: rect.top, left: 0, width: rect.left, height: rect.bottom - rect.top },
    { top: rect.top, left: rect.right, width: window.innerWidth - rect.right, height: rect.bottom - rect.top }
  ];
  panels.forEach(function(p) {
    let el = document.createElement('div');
    el.className = 'delivery-admin-tour-panel';
    el.style.top = p.top + 'px';
    el.style.left = p.left + 'px';
    el.style.width = Math.max(0, p.width) + 'px';
    el.style.height = Math.max(0, p.height) + 'px';
    document.body.appendChild(el);
  });

  let label = document.createElement('div');
  label.className = 'delivery-admin-tour-label';
  let message = document.createElement('div');
  message.textContent = step.text;
  let button = document.createElement('button');
  button.type = 'button';
  button.textContent = tourStepIndex >= getTourSteps().length - 1 ? 'Finish' : 'Next';
  button.addEventListener('click', onTourNext);
  label.appendChild(message);
  label.appendChild(button);

  label.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 376)) + 'px';
  if (step.placement === 'bottom') {
    label.style.top = Math.min(window.innerHeight - 120, rect.bottom + 18) + 'px';
  } else {
    label.style.top = Math.max(24, rect.top - 140) + 'px';
  }
  document.body.appendChild(label);
}

function showTourStep() {
  let step = getTourStep();
  if (!step) {
    clearTour();
    return;
  }
  let elements = tourElements(step);
  if (elements.length) {
    elements[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
  setTimeout(function() {
    applyTourTarget();
    renderSpotlight();
  }, 350);
}

function onHelpClick() {
  clearTour();
  showTourStep();
}

// - Init -

function initPage() {
  editModal = new Modal('editDeliveryModal');
  deleteModal = new Modal('deleteDeliveryModal');
  deleteAllModal = new Modal('deleteAllDeliveryModal');
  exportModal = new Modal('exportDeliveryModal');
  exportButtonHtml = byId('export-submit').innerHTML;
  byId('exportDeliveryForm').action = DELIVERY_ROUTES.exportExcel;
  renderSortIndicators('consolidated');
  renderSortIndicators('review');
  loadFilters();
}

// - Store scope monitor -

monitorChangesHere("hasStoreScopeChanges", handleStoreScopeChanges, 1000);
let hasFirstOpen = true;

function handleStoreScopeChanges() {
  let storeScope = localStorage.getItem('storeScope') || 'official';

  loadFilters();

  if (hasFirstOpen) {
    return hasFirstOpen = false;
  }
}

// - Event listeners -

byId('delivery-admin-tab-bar').addEventListener('click', onTabClick);
byId('cluster_id').addEventListener('change', onClusterChange);
byId('consolidated-form').addEventListener('submit', onConsolidatedSubmit);
byId('delivery-admin-reset-btn').addEventListener('click', onConsolidatedReset);
byId('pagination-buttons').addEventListener('click', onPaginationClick);
byId('consolidated-head').addEventListener('click', onSortClick);
byId('openExportDeliveryModal').addEventListener('click', openExportModal);
byId('exportDeliveryForm').addEventListener('submit', onExportSubmit);
byId('export_del_cluster_id').addEventListener('change', onExportClusterChange);
document.querySelectorAll('#exportDeliveryModal input[name="export_option"]').forEach(function(radio) {
  radio.addEventListener('change', onExportOptionChange);
});
byId('review-form').addEventListener('submit', onReviewSubmit);
byId('delivery-admin-review-reset-btn').addEventListener('click', onReviewReset);
byId('review-head').addEventListener('click', onSortClick);
byId('review-body').addEventListener('click', onReviewBodyClick);
byId('openDeleteAllDeliveryModal').addEventListener('click', openDeleteAllModal);
byId('editDeliveryForm').addEventListener('submit', onEditSubmit);
byId('deleteDeliveryForm').addEventListener('submit', onDeleteSubmit);
byId('deleteAllDeliveryForm').addEventListener('submit', onDeleteAllSubmit);
byId('delivery-admin-help-btn').addEventListener('click', onHelpClick);
window.addEventListener('popstate', onPopState);

initPage();
