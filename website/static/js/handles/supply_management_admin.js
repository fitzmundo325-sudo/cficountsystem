let activeTab = 'requests';

// - Tab switching -----------------------------------------------
function switchTab(tab) {
  activeTab = tab;
  let reqPanel = _('tab-panel-requests');
  let itmPanel = _('tab-panel-items');
  let reqBtn   = _('tab-btn-requests');
  let itmBtn   = _('tab-btn-items');

  let activeClass   = 'bg-slate-900 text-white shadow-sm';
  let inactiveClass = 'text-slate-600 hover:bg-slate-100';
	
	qBuilder.sort = undefined;
	qBuilder.page = 1;
	
  if (tab === 'items') {
    itmPanel.classList.remove('hidden');
    reqPanel.classList.add('hidden');
    itmBtn.className  = itmBtn.className.replace(/bg-slate-900.*?shadow-sm|text-slate-600 hover:bg-slate-100/, '').trim() + ' ' + activeClass;
    reqBtn.className  = reqBtn.className.replace(/bg-slate-900.*?shadow-sm|text-slate-600 hover:bg-slate-100/, '').trim() + ' ' + inactiveClass;
    if (!siLoaded) { siLoaded = true; loadSupplyItems(); }
	
	qBuilder.server_address = "../apis/supply_items";
	
  } else {
    reqPanel.classList.remove('hidden');
    itmPanel.classList.add('hidden');
    reqBtn.className  = reqBtn.className.replace(/bg-slate-900.*?shadow-sm|text-slate-600 hover:bg-slate-100/, '').trim() + ' ' + activeClass;
    itmBtn.className  = itmBtn.className.replace(/bg-slate-900.*?shadow-sm|text-slate-600 hover:bg-slate-100/, '').trim() + ' ' + inactiveClass;
	
	qBuilder.server_address = "../apis/supply_requests";
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
  _('sr-status-filter').value = '';
  _('sr-search').value = '';
  srPage = 1;
  loadSupplyRequests();
}

function loadSupplyRequests() {
  let body = _('sr-table-body');
  body.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-sm text-slate-400 text-center">Loading...</td></tr>';

	let params = [

	];

	
	if(_("sr-status-filter").value){
		params.push({"name":"status", "value": _("sr-status-filter").value || "all"});
	}
	

	qBuilder.search = _('sr-search').value;
	
	qBuilder.sendQuery(renderSupplyRequests, '/apis/supply_requests', params, function() {
    body.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-sm text-rose-500 text-center">Failed to load requests.</td></tr>';
  });
}



function renderSupplyRequests(res) {
  let body = _('sr-table-body');
  body.innerHTML = '';

  let data = JSON.parse(res.responseText);

  if (data.pending_count !== undefined) {
    _('pending-count-badge').textContent = data.pending_count;
  }

  let requests = data.data || [];
	
	genPages(res.responseText);
	
  if (!requests.length) {
    body.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-sm text-slate-500 text-center">No supply requests match your filters.</td></tr>';
   
    return;
  }

  let tmplRow    = _('tmpl-sr-row');
  let tmplDetail = _('tmpl-sr-detail');
  let tmplLine   = _('tmpl-sr-line');

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
	

}


// - Supply Items -----------------------------------------------
let siPage = 1;

function siDoSearch() {
  siPage = 1;
  loadSupplyItems();
}

function siClearFilters() {
  _('si-category-filter').value = '';
  _('si-search').value = '';
  siPage = 1;
  loadSupplyItems();
}

function loadSupplyItems() {
  let body = _('si-table-body');
  body.innerHTML = '<tr><td colspan="4" class="px-6 py-8 text-sm text-slate-400 text-center">Loading...</td></tr>';
	
	
	let search_value = _('si-search').value;
	
	let params = [
		{ name: 'category', 'value': _('si-category-filter').value || "all" },
	];
	
	qBuilder.search = search_value;
	
	
  qBuilder.sendQuery(renderSupplyItems, '/apis/supply_items',  params, function() {
    body.innerHTML = '<tr><td colspan="4" class="px-6 py-8 text-sm text-rose-500 text-center">Failed to load items.</td></tr>';
  });
}


qBuilder.server_address = "../apis/supply_requests";


function renderSupplyItems(res) {
  let body = _('si-table-body');
  body.innerHTML = '';
  
  let data = JSON.parse(res.responseText);


  // Populate categories dropdown if provided
  if (data.categories) {
    let sel = _('si-category-filter');
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

	genPages(res.responseText);
	
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="4" class="px-6 py-8 text-sm text-slate-500 text-center">No supply items match your filters.</td></tr>';

    return;
  }

  let tmpl = _('tmpl-si-row');

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

  	

}




// - SR modal / confirm -----------------------------------------
let srPendingAction = null;

function openSrModal(title, message) {
  _('sr-modal-title').textContent = title;
  _('sr-modal-message').textContent = message;
  _('sr-modal-insufficient').classList.add('hidden');
  _('sr-modal-insufficient').innerHTML = '';
  _('sr-modal').classList.remove('hidden');
  _('sr-modal').classList.add('flex');
}

function closeSrModal() {
  _('sr-modal').classList.add('hidden');
  _('sr-modal').classList.remove('flex');
  srPendingAction = null;
  _('sr-modal-confirm').classList.remove('hidden');
}

function showInsufficient(items) {
  let list = _('sr-modal-insufficient');
  list.innerHTML = items.map(function(i) {
    return '<li class="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">' +
      i.item_name + ' — requested ' + i.requested + ', available ' + i.available + '</li>';
  }).join('');
  list.classList.remove('hidden');
}

function confirmThen(fn, message, title) {
  openSrModal(title || 'Confirm Action', message);
  let confirmBtn = _('sr-modal-confirm');
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
    let res  = await fetch('../apis/supply_requests/' + id + '/approve', { method: 'POST' });
    let data = await res.json();
    if (data.type == 'success') {
      closeSrModal();
      toast.success(data.message);
      loadSupplyRequests();
    } else {
		
		toast.error(data.message);
		
      openSrModal('Approval Blocked', data.message || 'Failed to approve.');
      if (data.insufficient_items && data.insufficient_items.length) showInsufficient(data.insufficient_items);
      _('sr-modal-confirm').classList.add('hidden');
    }
  }, 'Approve request ' + requestNo + '? Stock will be deducted from supply items.', 'Approve Supply Request');
}

function rejectRequest(id, requestNo) {
  confirmThen(async function() {
    let res  = await fetch('../apis/supply_requests/' + id + '/reject', { method: 'POST' });
    let data = await res.json();
    if (data.type == 'success') {
      closeSrModal();
      toast.info(data.message);
      loadSupplyRequests();
    } else {
		toast.error(data.message);
      closeSrModal();
      toast.error(data.message || 'Failed to reject.');
    }
  }, 'Reject request ' + requestNo + '?', 'Reject Supply Request');
}

function deleteRequest(id, requestNo) {
  confirmThen(async function() {
    let res  = await fetch('../apis/supply_requests/' + id + '/delete', { method: 'POST' });
    let data = await res.json();
    if (data.type == 'success') {
      closeSrModal();
      toast.success(data.message);
      loadSupplyRequests();
    } else {
      closeSrModal();
	  
      toast.error(data.message || 'Failed to delete.');
    }
  }, 'Delete request ' + requestNo + '? This cannot be undone.', 'Delete Supply Request');
}


// - Supply Item modal ------------------------------------------
let siEditId = null;

function openItemModal() {
  siEditId = null;
  _('si-modal-title').textContent = 'Add Supply Item';
  _('si-category').value = '';
  _('si-name').value = '';
  _('si-stock').value = '0';
  _('si-modal-error').classList.add('hidden');
  _('si-modal').classList.remove('hidden');
  _('si-modal').classList.add('flex');
  _('si-name').focus();
}

function editItem(id, category, itemName, stock) {
  siEditId = id;
  _('si-modal-title').textContent = 'Edit Supply Item';
  _('si-category').value  = category || '';
  _('si-name').value       = itemName || '';
  _('si-stock').value      = stock ?? 0;
  _('si-modal-error').classList.add('hidden');
  _('si-modal').classList.remove('hidden');
  _('si-modal').classList.add('flex');
}

function closeItemModal() {
  _('si-modal').classList.add('hidden');
  _('si-modal').classList.remove('flex');
  siEditId = null;
}

function showItemError(message) {
  let el = _('si-modal-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

async function saveItem() {
  let payload = {
    category:        _('si-category').value.trim(),
    item_name:       _('si-name').value.trim(),
    available_stock: parseInt(_('si-stock').value, 10) || 0
  };
  let url     = siEditId ? '/apis/supply_items/' + siEditId + '/update' : '/apis/supply_items/create';
  let saveBtn = _('si-save');
  saveBtn.disabled = true;
  try {
    let res  = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let data = await res.json();
	
	console.log(data);
	
    if (data.type == "success") {
      closeItemModal();
      loadSupplyItems();
	  toast.success("Item changes saved successfully!");
	  
    } else {
      showItemError(data.message || 'Failed to save item.');
    }
  } catch (err) {
    showItemError('Network error while saving.');
  } finally {
    saveBtn.disabled = false;
  }
}



function deleteItem(id, name) {
  if (typeof showConfirmationModal !== 'undefined') {
    showConfirmationModal({
      title:       'Delete Supply Item',
      message:     'Delete "' + name + '"? This cannot be undone.',
      confirmText: 'Delete',
      cancelText:  'Cancel',
      onConfirm:   function() {
        fetch('/apis/supply_items/' + id + '/delete', { method: 'POST' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.type === 'success') { loadSupplyItems(); }
            else { alert(data.message || 'Failed to delete.'); }
          })
          .catch(function() { alert('Network error while deleting.'); });
      }
    });
  } else {
    if (!confirm('Delete supply item "' + name + '"? This cannot be undone.')) return;
    fetch('/apis/supply_items/' + id + '/delete', { method: 'POST' })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.type === 'success') { loadSupplyItems(); }
        else { alert(data.message || 'Failed to delete.'); }
      })
      .catch(function() { alert('Network error while deleting.'); });
  }
}



_('si-save').addEventListener('click', saveItem);


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





//Utilities


//Pagination Function Helpers ===
function genPages(data){	
	let paginations = JSON.parse(data).pagination_data;	
	let generated = generatePagination(paginations,'paginates', 'jumpToPage');
	_("paginations") ? _("paginations").innerHTML = generated.innerHTML : false;
}



function sortByThis(elm) {
  let sortname = elm.getAttribute('sortname');
  let currentOrder = elm.getAttribute('sort-order');

  let nextOrder = (currentOrder === 'asc') ? 'desc' : 'asc';
  elm.setAttribute('sort-order', nextOrder);

  qBuilder.sort     = sortname;
  qBuilder.order_by = nextOrder;

  delayedQuerry(true);
}


function delayedQuerry(resetPage){
	
	if(resetPage){
		qBuilder.page = 1;
	}
	window.setTimeout(loadAllItems(), 500);
		
		
	
}



function loadAllItems(){
	
	if(activeTab == "items"){
		loadSupplyItems();
	}else{
		loadSupplyRequests();
	}
	
}


function paginates(dir){
	qBuilder.paginate(dir,true);
	delayedQuerry();
};


function jumpToPage(page_n){
	page = page_n;
	qBuilder.page = page;
	delayedQuerry();
}


