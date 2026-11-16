let PAGE_SIZE = 20;
let DEFAULT_SORT = 'transaction_date';

let headerDate = document.getElementById('header_date');
let filterDateBtn = document.getElementById('filter-date-btn');
let chargeForm = document.getElementById('charge-form');
let searchInput = document.getElementById('cs-search');
let storeSelect = document.getElementById('store_id');
let typeSelect = document.getElementById('charge_type');
let statusSelect = document.getElementById('status');
let applyBtn = document.getElementById('apply-btn');
let resetBtn = document.getElementById('reset-btn');
let matchingInfo = document.getElementById('matching-info');
let sumTotal = document.getElementById('sum-total');
let sumNet = document.getElementById('sum-net');
let sumSpoilage = document.getElementById('sum-spoilage');
let chargeHead = document.getElementById('charge-head');
let chargeBody = document.getElementById('charge-body');
let chargeEmpty = document.getElementById('charge-empty');
let emptyMessage = document.getElementById('empty-message');
let rowTemplate = document.getElementById('tmpl-charge-row');
let paginationBar = document.getElementById('charge-pagination');
let paginationInfo = document.getElementById('pagination-info');
let paginationButtons = document.getElementById('pagination-buttons');

let currentPage = 1;
let currentSort = DEFAULT_SORT;
let currentOrder = 'desc';
let pendingDeleteId = null;
let skipNextPush = false;

// - formatting -

function formatPlain(value) {
  return Number(value || 0).toFixed(2);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function readJson(res) {
  return res.json();
}

function setCell(node, name, text) {
  node.querySelector('[data-cell="' + name + '"]').textContent = text;
}

function hasActiveFilters() {
  return !!(headerDate.value || searchInput.value.trim() || storeSelect.value || typeSelect.value || statusSelect.value);
}

// - loading -

function setLoading(state) {
  applyBtn.disabled = state;
  applyBtn.innerHTML = state ? SPINNER_HTML + 'Search' : 'Search';
}

function hasParamValue(param) {
  return param.value !== '' && param.value !== null && param.value !== undefined;
}


function buildParams() {
  let candidates = [
    { name: 'date', value: headerDate.value },
    { name: 'store_id', value: storeSelect.value },
    { name: 'charge_type', value: typeSelect.value },
    { name: 'status', value: statusSelect.value },
    { name: 'rows', value: PAGE_SIZE }
  ];
  return candidates.filter(hasParamValue);
}


function loadChargeSlips() {
  qBuilder.server_address = '/apis/charge_slips';
  qBuilder.search = searchInput.value.trim();
  qBuilder.page = currentPage;
  qBuilder.sort = currentSort;
  qBuilder.order_by = currentOrder;
  setLoading(true);
  qBuilder.sendQuery(onChargeSlipsLoaded, undefined, buildParams(), onChargeSlipsError);
}

function onChargeSlipsLoaded(datas) {
	
	let data = JSON.parse(datas.responseText);

	setLoading(false);
	if (data.type !== 'success') {
	toast.error(data.message || 'Failed to load Charge Slips.');
	return;
	}
	currentPage = data.current_page;
	renderSummary(data.summary);
	renderRows(data.data);
	renderPagination(data);
	updateSortIcons();
	matchingInfo.textContent = 'Showing ' + data.total_results + ' matching Charge Slip' + (data.total_results === 1 ? '' : 's') + ' across all pages.';
	syncUrl();
}

function onChargeSlipsError() {
  setLoading(false);
  toast.error('An error occurred while loading Charge Slips.');
}

// - rendering -

function renderSummary(summary) {
  sumTotal.textContent = summary.total_count;
  sumNet.textContent = '₱' + formatMoney(summary.total_net_amount);
  sumSpoilage.textContent = summary.total_spoilage_count;
}

function renderRows(rows) {
  chargeBody.innerHTML = '';
  if (!rows || !rows.length) {
    emptyMessage.textContent = hasActiveFilters()
      ? 'No Charge Slips match the selected search or filters.'
      : 'No Charge Slips have been submitted yet.';
    chargeEmpty.classList.remove('hidden');
    return;
  }
  chargeEmpty.classList.add('hidden');
  rows.forEach(appendRow);
}

function appendRow(row) {
  let node = rowTemplate.content.cloneNode(true);

  setCell(node, 'date', row.date_label);
  setCell(node, 'control_no', row.control_no);
  setCell(node, 'store', row.store_name);
  setCell(node, 'customer', row.customer_name || '—');
  setCell(node, 'items', row.items_count);
  setCell(node, 'subtotal', '₱' + formatPlain(row.grand_total));
  setCell(node, 'discount', Number(row.discount_percent || 0).toFixed(1) + '%');
  setCell(node, 'net', '₱' + formatMoney(row.net_total));

  let typeBadge = node.querySelector('[data-cell="type"]');
  typeBadge.textContent = row.charge_type;
  typeBadge.className = UI_CLASSES.typeBase + ' ' + (row.charge_type.toLowerCase() === 'spoilage' ? UI_CLASSES.typeSpoilage : UI_CLASSES.typeCharge);

  let statusBadge = node.querySelector('[data-cell="status"]');
  statusBadge.textContent = row.status;
  statusBadge.className = UI_CLASSES.statusBase + ' ' + (row.status === 'Pending' ? UI_CLASSES.statusPending : UI_CLASSES.statusReceived);

  let editLink = node.querySelector('[data-action="edit"]');
  editLink.href = CHARGE_SLIP_ROUTES.edit.replace('987654321', row.id);

  let deleteBtn = node.querySelector('[data-action="delete"]');
  deleteBtn.dataset.id = row.id;
  deleteBtn.dataset.control = row.control_no;

  chargeBody.appendChild(node);
}

function buildPageList(current, total) {
  let pages = [];
  let last = 0;
  for (let n = 1; n <= total; n++) {
    let onEdge = n <= 1 || n > total - 1;
    let nearCurrent = n >= current - 2 && n <= current + 2;
    if (onEdge || nearCurrent) {
      if (last && n - last > 1) {
        pages.push(0);
      }
      pages.push(n);
      last = n;
    }
  }
  return pages;
}

function createPageButton(label, page, isCurrent) {
  let button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.page = page;
  button.className = isCurrent ? UI_CLASSES.pageCurrent : UI_CLASSES.pageButton;
  return button;
}

function createPageGap() {
  let gap = document.createElement('span');
  gap.textContent = '…';
  gap.className = UI_CLASSES.pageGap;
  return gap;
}

function renderPagination(data) {
  paginationButtons.innerHTML = '';
  if (data.total_pages <= 1) {
    paginationBar.classList.add('hidden');
    return;
  }
  paginationBar.classList.remove('hidden');

  let start = ((data.current_page - 1) * PAGE_SIZE) + 1;
  let end = Math.min(data.current_page * PAGE_SIZE, data.total_results);
  paginationInfo.textContent = 'Showing ' + start + '–' + end + ' of ' + data.total_results;

  if (data.current_page > 1) {
    paginationButtons.appendChild(createPageButton('Previous', data.current_page - 1, false));
  }
  buildPageList(data.current_page, data.total_pages).forEach(function (n) {
    if (n === 0) {
      paginationButtons.appendChild(createPageGap());
    } else {
      paginationButtons.appendChild(createPageButton(n, n, n === data.current_page));
    }
  });
  if (data.current_page < data.total_pages) {
    paginationButtons.appendChild(createPageButton('Next', data.current_page + 1, false));
  }
}

// - sorting -

function styleSortHeader(th) {
  let icon = th.querySelector('[data-sort-icon]');
  let active = th.dataset.sort === currentSort;
  th.setAttribute('aria-sort', active ? (currentOrder === 'asc' ? 'ascending' : 'descending') : 'none');
  icon.className = 'ml-1 ' + (active ? UI_CLASSES.sortActive : UI_CLASSES.sortInactive);
  icon.innerHTML = active ? (currentOrder === 'asc' ? '&#9650;' : '&#9660;') : '&#8597;';
}

function updateSortIcons() {
  chargeHead.querySelectorAll('th[data-sort]').forEach(styleSortHeader);
}

function onSortClick(event) {
  let th = event.target.closest('th[data-sort]');
  if (!th) {
    return;
  }
  let key = th.dataset.sort;
  if (currentSort === key) {
    currentOrder = currentOrder === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort = key;
    currentOrder = key === DEFAULT_SORT ? 'desc' : 'asc';
  }
  currentPage = 1;
  loadChargeSlips();
}

// - url sync -

function syncUrl() {
  if (skipNextPush) {
    skipNextPush = false;
    return;
  }
  let url = new URL(window.location.href);
  let values = {
    date: headerDate.value,
    q: searchInput.value.trim(),
    store_id: storeSelect.value,
    charge_type: typeSelect.value,
    status: statusSelect.value,
    sort: currentSort === DEFAULT_SORT && currentOrder === 'desc' ? '' : currentSort,
    order_by: currentSort === DEFAULT_SORT && currentOrder === 'desc' ? '' : currentOrder,
    page: currentPage > 1 ? currentPage : ''
  };
  Object.keys(values).forEach(function (key) {
    if (values[key]) {
      url.searchParams.set(key, values[key]);
    } else {
      url.searchParams.delete(key);
    }
  });
  history.pushState({}, '', url.toString());
}

function restoreFromUrl() {
  let params = new URL(window.location.href).searchParams;
  headerDate.value = params.get('date') || '';
  searchInput.value = params.get('q') || '';
  storeSelect.value = params.get('store_id') || '';
  typeSelect.value = params.get('charge_type') || '';
  statusSelect.value = params.get('status') || '';
  currentSort = params.get('sort') || DEFAULT_SORT;
  currentOrder = params.get('order_by') || (currentSort === DEFAULT_SORT ? 'desc' : 'asc');
  currentPage = parseInt(params.get('page'), 10) || 1;
}

function onPopState() {
  restoreFromUrl();
  skipNextPush = true;
  loadChargeSlips();
}

// - filters -

function appendStoreOption(store) {
  let option = document.createElement('option');
  option.value = store.id;
  option.textContent = store.name;
  storeSelect.appendChild(option);
}

function fillStoreOptions(data) {
  if (data.type !== 'success') {
    toast.error(data.message || 'Failed to load stores.');
    return;
  }
  data.stores.forEach(appendStoreOption);
}

function onStoreOptionsFailed() {
  toast.error('Failed to load stores.');
}

function loadStoreOptions() {
  return fetch('/apis/charge_slips_filters')
    .then(readJson)
    .then(fillStoreOptions)
    .catch(onStoreOptionsFailed);
}

function onFormSubmit(event) {
  event.preventDefault();
  currentPage = 1;
  loadChargeSlips();
}

function onFilterDateClick() {
  currentPage = 1;
  loadChargeSlips();
}

function onResetClick() {
  headerDate.value = '';
  searchInput.value = '';
  storeSelect.value = '';
  typeSelect.value = '';
  statusSelect.value = '';
  currentSort = DEFAULT_SORT;
  currentOrder = 'desc';
  currentPage = 1;
  loadChargeSlips();
}

function onPaginationClick(event) {
  let button = event.target.closest('[data-page]');
  if (!button) {
    return;
  }
  currentPage = parseInt(button.dataset.page, 10) || 1;
  loadChargeSlips();
}

// - delete -

function onBodyClick(event) {
  let button = event.target.closest('[data-action="delete"]');
  if (!button) {
    return;
  }
  askDelete(button.dataset.id, button.dataset.control);
}

function askDelete(id, controlNo) {
  let message = 'Are you sure you want to delete Charge Slip ' + controlNo + '? This will automatically reverse/reconcile store inventory.';
  pendingDeleteId = id;
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Delete Charge Slip?',
      message: message,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      onConfirm: runPendingDelete
    });
    return;
  }
  if (confirm(message)) {
    runPendingDelete();
  }
}

function runPendingDelete() {
  if (!pendingDeleteId) {
    return;
  }
  let id = pendingDeleteId;
  pendingDeleteId = null;
  fetch(CHARGE_SLIP_ROUTES.remove.replace('987654321', id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
    .then(readJson)
    .then(onDeleteResult)
    .catch(onDeleteFailed);
}

function onDeleteResult(data) {
  if (data.success || data.type === 'success') {
    toast.success(data.message || 'Charge Slip deleted successfully.');
    loadChargeSlips();
    return;
  }
  toast.error(data.error || data.message || 'Failed to delete Charge Slip.');
}

function onDeleteFailed(err) {
  console.error('Error deleting charge slip:', err);
  toast.error('An error occurred while deleting the Charge Slip.');
}

// - init -

function initialLoad() {
  restoreFromUrl();
  skipNextPush = true;
  loadChargeSlips();
}

chargeForm.addEventListener('submit', onFormSubmit);
filterDateBtn.addEventListener('click', onFilterDateClick);
resetBtn.addEventListener('click', onResetClick);
chargeHead.addEventListener('click', onSortClick);
chargeBody.addEventListener('click', onBodyClick);
paginationButtons.addEventListener('click', onPaginationClick);
window.addEventListener('popstate', onPopState);

loadStoreOptions().then(initialLoad);
