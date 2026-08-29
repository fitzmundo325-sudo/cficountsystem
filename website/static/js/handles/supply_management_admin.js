let activeTab = 'requests';

// - Tab switching -----------------------------------------------
function switchTab(tab) {
  activeTab = tab;
  let reqPanel = document.getElementById('tab-panel-requests');
  let itmPanel = document.getElementById('tab-panel-items');
  let reqBtn   = document.getElementById('tab-btn-requests');
  let itmBtn   = document.getElementById('tab-btn-items');

  let activeClass   = 'bg-slate-900 text-white shadow-sm';
  let inactiveClass = 'text-slate-600 hover:bg-slate-100';

  if (tab === 'items') {
    itmPanel.classList.remove('hidden');
    reqPanel.classList.add('hidden');
    itmBtn.className  = itmBtn.className.replace(/bg-slate-900.*?shadow-sm|text-slate-600 hover:bg-slate-100/, '').trim() + ' ' + activeClass;
    reqBtn.className  = reqBtn.className.replace(/bg-slate-900.*?shadow-sm|text-slate-600 hover:bg-slate-100/, '').trim() + ' ' + inactiveClass;
    if (!siLoaded) { siLoaded = true; loadSupplyItems(); }
  } else {
    reqPanel.classList.remove('hidden');
    itmPanel.classList.add('hidden');
    reqBtn.className  = reqBtn.className.replace(/bg-slate-900.*?shadow-sm|text-slate-600 hover:bg-slate-100/, '').trim() + ' ' + activeClass;
    itmBtn.className  = itmBtn.className.replace(/bg-slate-900.*?shadow-sm|text-slate-600 hover:bg-slate-100/, '').trim() + ' ' + inactiveClass;
  }
}


// - Supply Requests --------------------------------------------
let srPage = 1;
let srLoaded = false;
let siLoaded = false;

function srDoSearch() {
  srPage = 1;
  loadSupplyRequests();
}

function srClearFilters() {
  document.getElementById('sr-status-filter').value = '';
  document.getElementById('sr-search').value = '';
  srPage = 1;
  loadSupplyRequests();
}

function loadSupplyRequests() {
  let body = document.getElementById('sr-table-body');
  body.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-sm text-slate-400 text-center">Loading...</td></tr>';

	let params = [

	];

	
	if(_("sr-status-filter").value){
		params.push({"name":"status", "value": _("sr-status-filter").value || "all"});
	}
	

	qBuilder.search = document.getElementById('sr-search').value;
	
	qBuilder.sendQuery(renderSupplyRequests, '/apis/supply_requests', params, function() {
    body.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-sm text-rose-500 text-center">Failed to load requests.</td></tr>';
  });
}



function renderSupplyRequests(res) {
  let body = document.getElementById('sr-table-body');
  body.innerHTML = '';

  let data = JSON.parse(res.responseText);

  if (data.pending_count !== undefined) {
    document.getElementById('pending-count-badge').textContent = data.pending_count;
  }

  let requests = data.data || [];

  if (!requests.length) {
    body.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-sm text-slate-500 text-center">No supply requests match your filters.</td></tr>';
    renderSrPagination(data.pagination_data);
    return;
  }

  let tmplRow    = document.getElementById('tmpl-sr-row');
  let tmplDetail = document.getElementById('tmpl-sr-detail');
  let tmplLine   = document.getElementById('tmpl-sr-line');

  requests.forEach(function(req) {
    // - Main row
    let row = tmplRow.content.cloneNode(true).querySelector('tr');

    row.querySelector('[data-cell="request_no"]').textContent = req.request_no;
    row.querySelector('[data-cell="created_at"]').textContent = req.created_at || '-';

    // Store name + TAF badge
    let storeCell = row.querySelector('[data-cell="store_name"]');
    storeCell.textContent = req.store_name || '-';
    if (req.request_type === 'taf') {
      let badge = document.createElement('span');
      badge.className = 'ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700';
      badge.title = 'Submitted from the TAF page';
      badge.textContent = 'Via TAF';
      storeCell.appendChild(badge);
    }

    row.querySelector('[data-cell="requester"]').textContent = req.requester || '-';
    row.querySelector('[data-cell="item_count"]').textContent = req.item_count ?? 0;

    // Status badge
    let statusCell = row.querySelector('[data-cell="status_cell"]');
    let statusMap = {
      'Pending':  'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700',
      'Approved': 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700',
      'Rejected': 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-700',
    };
    let badge = document.createElement('span');
    badge.className = statusMap[req.status] || statusMap['Pending'];
    badge.textContent = req.status;
    statusCell.appendChild(badge);

    // Actions
    let actionsDiv = row.querySelector('[data-cell="actions"]');
    if (req.status === 'Pending') {
      let approveBtn = buildActionBtn('emerald', svgCheck(), 'Approve');
      approveBtn.addEventListener('click', function() { approveRequest(req.id, req.request_no); });
      let rejectBtn  = buildActionBtn('rose', svgX(), 'Reject');
      rejectBtn.addEventListener('click', function() { rejectRequest(req.id, req.request_no); });
      actionsDiv.appendChild(approveBtn);
      actionsDiv.appendChild(rejectBtn);
    }
    let deleteBtn = buildActionBtn('rose', svgTrash(), 'Delete');
    deleteBtn.addEventListener('click', function() { deleteRequest(req.id, req.request_no); });
    actionsDiv.appendChild(deleteBtn);

    body.appendChild(row);

    // - Detail row
    let detail = tmplDetail.content.cloneNode(true).querySelector('tr');

    let remarksEl = detail.querySelector('[data-cell="remarks"]');
    if (req.remarks) { remarksEl.textContent = 'Remarks: ' + req.remarks; }
    else { remarksEl.remove(); }

    let itemsBody = detail.querySelector('[data-cell="items_body"]');
    (req.items || []).forEach(function(line) {
      let lineRow = tmplLine.content.cloneNode(true).querySelector('tr');
      lineRow.querySelector('[data-cell="item_name"]').textContent = line.item_name;
      lineRow.querySelector('[data-cell="category"]').textContent  = line.category || '-';
      lineRow.querySelector('[data-cell="quantity"]').textContent  = line.quantity;
      itemsBody.appendChild(lineRow);
    });

    let approverLine = detail.querySelector('[data-cell="approver_line"]');
    if (req.status === 'Approved' && req.approver) {
      approverLine.textContent = 'Approved by ' + req.approver + (req.approved_at ? ' on ' + req.approved_at : '');
    } else if (req.status === 'Rejected' && req.rejecter) {
      approverLine.textContent = 'Rejected by ' + req.rejecter + (req.rejected_at ? ' on ' + req.rejected_at : '');
    } else {
      approverLine.remove();
    }

    // Toggle logic
    let toggleBtn  = row.querySelector('[data-cell="toggle-btn"]');
    let toggleIcon = row.querySelector('[data-cell="toggle-icon"]');
    toggleBtn.addEventListener('click', function() {
      detail.classList.toggle('hidden');
      let open = !detail.classList.contains('hidden');
      toggleIcon.innerHTML = open ? '<polyline points="18 15 12 9 6 15"/>' : '<polyline points="6 9 12 15 18 9"/>';
    });

    body.appendChild(detail);
  });

  renderSrPagination(data.pagination_data);
}

function renderSrPagination(pg) {
  if (!pg) return;
  document.getElementById('sr-pagination-info').textContent =
    'Showing ' + pg.start_index + '–' + pg.end_index + ' of ' + pg.total_items;
  let container = document.getElementById('sr-pagination-pages');
  container.innerHTML = '';
  for (let i = 1; i <= pg.total_pages; i++) {
    let node = document.getElementById('tmpl-page-btn').content.cloneNode(true).querySelector('button');
    node.textContent = i;
    node.className += i === pg.current_page
      ? ' bg-slate-900 text-white border-slate-900'
      : ' bg-white text-slate-600 border-slate-300 hover:bg-slate-50';
    node.addEventListener('click', (function(page) {
      return function() { srPage = page; loadSupplyRequests(); };
    })(i));
    container.appendChild(node);
  }
}


// - Supply Items -----------------------------------------------
let siPage = 1;

function siDoSearch() {
  siPage = 1;
  loadSupplyItems();
}

function siClearFilters() {
  document.getElementById('si-category-filter').value = '';
  document.getElementById('si-search').value = '';
  siPage = 1;
  loadSupplyItems();
}

function loadSupplyItems() {
  let body = document.getElementById('si-table-body');
  body.innerHTML = '<tr><td colspan="4" class="px-6 py-8 text-sm text-slate-400 text-center">Loading...</td></tr>';
	
	
	let search_value = document.getElementById('si-search').value;
	
	let params = [
		{ name: 'category', 'value': document.getElementById('si-category-filter').value || "all" },
	];
	
	qBuilder.search = search_value;
	
	
  qBuilder.sendQuery(renderSupplyItems, '/apis/supply_items',  params, function() {
    body.innerHTML = '<tr><td colspan="4" class="px-6 py-8 text-sm text-rose-500 text-center">Failed to load items.</td></tr>';
  });
}



function renderSupplyItems(res) {
  let body = document.getElementById('si-table-body');
  body.innerHTML = '';
  
  let data = JSON.parse(res.responseText);


  // Populate categories dropdown if provided
  if (data.categories) {
    let sel = document.getElementById('si-category-filter');
    let currentVal = sel.value;
    sel.innerHTML = '<option value="">All Categories</option>';
    data.categories.forEach(function(cat) {
      let opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (cat === currentVal) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  let items = data.data || [];

  if (!items.length) {
    body.innerHTML = '<tr><td colspan="4" class="px-6 py-8 text-sm text-slate-500 text-center">No supply items match your filters.</td></tr>';
    renderSiPagination(data.pagination_data);
    return;
  }

  let tmpl = document.getElementById('tmpl-si-row');

  items.forEach(function(item) {
    let row = tmpl.content.cloneNode(true).querySelector('tr');
    row.querySelector('[data-cell="item_name"]').textContent = item.item_name;
    row.querySelector('[data-cell="category"]').textContent  = item.category;

    let stockCell = row.querySelector('[data-cell="stock_cell"]');
    let stockBadge = document.createElement('span');
    stockBadge.textContent = item.available_stock;
    if (item.available_stock <= 0) {
      stockBadge.className = 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-700';
    } else if (item.available_stock < 10) {
      stockBadge.className = 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700';
    } else {
      stockBadge.className = 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700';
    }
    stockCell.appendChild(stockBadge);

    let editBtn = row.querySelector('[data-cell="edit-btn"]');
    editBtn.addEventListener('click', function() {
      editItem(item.id, item.category, item.item_name, item.available_stock);
    });

    let deleteBtn = row.querySelector('[data-cell="delete-btn"]');
    deleteBtn.addEventListener('click', function() {
      deleteItem(item.id, item.item_name);
    });

    body.appendChild(row);
  });

  renderSiPagination(data.pagination_data);
}

function renderSiPagination(pg) {
  if (!pg) return;
  document.getElementById('si-pagination-info').textContent =
    'Showing ' + pg.start_index + '–' + pg.end_index + ' of ' + pg.total_items;
  let container = document.getElementById('si-pagination-pages');
  container.innerHTML = '';
  for (let i = 1; i <= pg.total_pages; i++) {
    let node = document.getElementById('tmpl-page-btn').content.cloneNode(true).querySelector('button');
    node.textContent = i;
    node.className += i === pg.current_page
      ? ' bg-slate-900 text-white border-slate-900'
      : ' bg-white text-slate-600 border-slate-300 hover:bg-slate-50';
    node.addEventListener('click', (function(page) {
      return function() { siPage = page; loadSupplyItems(); };
    })(i));
    container.appendChild(node);
  }
}



// - SR modal / confirm -----------------------------------------
let srPendingAction = null;

function openSrModal(title, message) {
  document.getElementById('sr-modal-title').textContent = title;
  document.getElementById('sr-modal-message').textContent = message;
  document.getElementById('sr-modal-insufficient').classList.add('hidden');
  document.getElementById('sr-modal-insufficient').innerHTML = '';
  document.getElementById('sr-modal').classList.remove('hidden');
  document.getElementById('sr-modal').classList.add('flex');
}

function closeSrModal() {
  document.getElementById('sr-modal').classList.add('hidden');
  document.getElementById('sr-modal').classList.remove('flex');
  srPendingAction = null;
  document.getElementById('sr-modal-confirm').classList.remove('hidden');
}

function showInsufficient(items) {
  let list = document.getElementById('sr-modal-insufficient');
  list.innerHTML = items.map(function(i) {
    return '<li class="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">' +
      i.item_name + ' — requested ' + i.requested + ', available ' + i.available + '</li>';
  }).join('');
  list.classList.remove('hidden');
}

function confirmThen(fn, message, title) {
  openSrModal(title || 'Confirm Action', message);
  let confirmBtn = document.getElementById('sr-modal-confirm');
  confirmBtn.classList.remove('hidden');
  confirmBtn.onclick = async function() {
    this.disabled = true;
    await fn();
    this.disabled = false;
    closeSrModal();
  };
}

function approveRequest(id, requestNo) {
  confirmThen(async function() {
    let res  = await fetch('/admin/supply-request/' + id + '/approve', { method: 'POST' });
    let data = await res.json();
    if (data.success) { loadSupplyRequests(); }
    else {
      openSrModal('Approval Blocked', data.error || 'Failed to approve.');
      if (data.insufficient_items && data.insufficient_items.length) showInsufficient(data.insufficient_items);
      document.getElementById('sr-modal-confirm').classList.add('hidden');
    }
  }, 'Approve request ' + requestNo + '? Stock will be deducted from supply items.', 'Approve Supply Request');
}

function rejectRequest(id, requestNo) {
  confirmThen(async function() {
    let res  = await fetch('/admin/supply-request/' + id + '/reject', { method: 'POST' });
    let data = await res.json();
    if (data.success) { loadSupplyRequests(); }
    else { openSrModal('Error', data.error || 'Failed to reject.'); }
  }, 'Reject request ' + requestNo + '?', 'Reject Supply Request');
}

function deleteRequest(id, requestNo) {
  confirmThen(async function() {
    let res  = await fetch('/admin/supply-request/' + id + '/delete', { method: 'POST' });
    let data = await res.json();
    if (data.success) { loadSupplyRequests(); }
    else { openSrModal('Error', data.error || 'Failed to delete.'); }
  }, 'Delete request ' + requestNo + '? This cannot be undone.', 'Delete Supply Request');
}





// - Supply Item modal ------------------------------------------
let siEditId = null;

function openItemModal() {
  siEditId = null;
  document.getElementById('si-modal-title').textContent = 'Add Supply Item';
  document.getElementById('si-category').value = '';
  document.getElementById('si-name').value = '';
  document.getElementById('si-stock').value = '0';
  document.getElementById('si-modal-error').classList.add('hidden');
  document.getElementById('si-modal').classList.remove('hidden');
  document.getElementById('si-modal').classList.add('flex');
  document.getElementById('si-name').focus();
}

function editItem(id, category, itemName, stock) {
  siEditId = id;
  document.getElementById('si-modal-title').textContent = 'Edit Supply Item';
  document.getElementById('si-category').value  = category || '';
  document.getElementById('si-name').value       = itemName || '';
  document.getElementById('si-stock').value      = stock ?? 0;
  document.getElementById('si-modal-error').classList.add('hidden');
  document.getElementById('si-modal').classList.remove('hidden');
  document.getElementById('si-modal').classList.add('flex');
}

function closeItemModal() {
  document.getElementById('si-modal').classList.add('hidden');
  document.getElementById('si-modal').classList.remove('flex');
  siEditId = null;
}

function showItemError(message) {
  let el = document.getElementById('si-modal-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

async function saveItem() {
  let payload = {
    category:        document.getElementById('si-category').value.trim(),
    item_name:       document.getElementById('si-name').value.trim(),
    available_stock: parseInt(document.getElementById('si-stock').value, 10) || 0
  };
  let url     = siEditId ? '/admin/supply-items/' + siEditId + '/update' : '/admin/supply-items/create';
  let saveBtn = document.getElementById('si-save');
  saveBtn.disabled = true;
  try {
    let res  = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let data = await res.json();
    if (data.success) {
      closeItemModal();
      loadSupplyItems();
    } else {
      showItemError(data.error || 'Failed to save item.');
    }
  } catch (err) {
    showItemError('Network error while saving.');
  } finally {
    saveBtn.disabled = false;
  }
}

function deleteItem(id, name) {
  if (typeof showConfirmationModal !== 'undefined') {
    showConfirmationModal('Delete Supply Item', 'Delete "' + name + '"? This cannot be undone.', function() {
      fetch('/admin/supply-items/' + id + '/delete', { method: 'POST' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.success) { loadSupplyItems(); }
          else { alert(data.error || 'Failed to delete.'); }
        })
        .catch(function() { alert('Network error while deleting.'); });
    });
  } else {
    if (!confirm('Delete supply item "' + name + '"? This cannot be undone.')) return;
    fetch('/admin/supply-items/' + id + '/delete', { method: 'POST' })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) { loadSupplyItems(); }
        else { alert(data.error || 'Failed to delete.'); }
      })
      .catch(function() { alert('Network error while deleting.'); });
  }
}

document.getElementById('si-save').addEventListener('click', saveItem);


// Extra



// - SVG helpers ------------------------------------------------
function svgCheck() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
}
function svgX() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
}
function svgTrash() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
}

function buildActionBtn(color, svgHtml, label) {
  let btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'inline-flex items-center justify-center w-8 h-8 rounded-lg bg-' + color + '-100 text-' + color + '-700 hover:bg-' + color + '-200 transition-colors';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = svgHtml;
  return btn;
}

// - Init -------------------------------------------------------
switchTab('requests');
loadSupplyRequests();