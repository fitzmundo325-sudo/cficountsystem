let currentPage = 1;
let currentSort = 'id';
let currentDir  = 'asc';
let searchTimer = null;
let activeStoreId = null;
let formData = { all_managers: [], available_managers: [] };

let storeModal         = new Modal('storeModal');
let assignManagerModal = new Modal('assignManagerModal');
let editStoreModal     = new Modal('editStoreModal');

// -----------------------------------------------------------------------
// Form data loader
// -----------------------------------------------------------------------

qBuilder.server_address = '/apis/stores';

function onFormDataLoaded(data) {
formData = data;
populateManagerDropdowns();
}



function loadFormData() {
	loadStores();
}



function populateManagerDropdowns() {
    Promise.all([
        fetch('/apis/stores_managers_available').then(function(r) { return r.json(); }),
        fetch('/apis/managers_all').then(function(r) { return r.json(); })
    ]).then(function(results) {
        let available = results[0];
        let all       = results[1];

        let newSelect    = document.getElementById('new_manager_id');
        let assignSelect = document.getElementById('assign_manager_id');
        let editSelect   = document.getElementById('edit_manager_id');

        // -- Available managers for new + assign
        let availableOptions = '<option value="">Select a manager (optional)</option>';
        available.data.forEach(function(m) {
            availableOptions += `<option value="${m.id}">${m.full_name} (${m.username})</option>`;
        });
        newSelect.innerHTML    = availableOptions;
        assignSelect.innerHTML = availableOptions.replace('(optional)', '');

        // -- All managers for edit
        let allOptions = '<option value="">No manager assigned</option>';
        all.data.forEach(function(m) {
            allOptions += `<option value="${m.id}">${m.full_name} (${m.username})</option>`;
        });
        editSelect.innerHTML = allOptions;
    });
}



// -----------------------------------------------------------------------
// Store list loader
// -----------------------------------------------------------------------

function loadStores() {
    qBuilder.search   = document.getElementById('store-search-input').value;
    qBuilder.sort     = currentSort;
    qBuilder.order_by = currentDir;
    loadOnTableSpinner();
    qBuilder.sendQuery(process);
    function process(data) {
        clearTableSpinner();
        let res = JSON.parse(data.responseText);
        if (res.type !== 'success') {
            toast.error(res.message || 'Failed to load stores.');
            return;
        }
        let stores    = res.data.stores;
        canManage     = res.data.can_manage;
        renderStores(stores);
        genPages(data.responseText);
    }
	
	populateManagerDropdowns();
}


function loadOnTableSpinner() {
    let tbody = document.getElementById('stores-table-body');
    let colSpan = tbody.closest('table').querySelectorAll('thead th').length;
    let existing = document.getElementById('table-spinner-row');
    if (existing) return;

    let tr = document.createElement('tr');
    tr.id  = 'table-spinner-row';

    let td       = document.createElement('td');
    td.colSpan   = colSpan;
    td.className = 'text-center py-6 text-slate-400';
    td.innerHTML = '<i class="fa fa-spinner fa-spin mr-2"></i> Loading...';

    tr.appendChild(td);
    tbody.appendChild(tr);
}

function clearTableSpinner() {
    let existing = document.getElementById('table-spinner-row');
    if (existing) existing.remove();
}




function renderStores(stores) {
    let tbody = document.getElementById('stores-table-body');
    tbody.innerHTML = '';

    if (!stores.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400 text-sm">No stores found.</td></tr>';
        return;
    }

    let tmpl = document.getElementById('tmpl-store-row');

    stores.forEach(function(s) {
        let row = tmpl.content.cloneNode(true);

        row.querySelector('[data-cell="id"]').textContent       = '#' + s.id;
        row.querySelector('[data-cell="name"]').textContent     = s.name;
        row.querySelector('[data-cell="address"]').textContent  = s.address;
        row.querySelector('[data-cell="date_added"]').textContent = s.date_added || '—';

        // -- Manager cell
        let managerCell = row.querySelector('[data-cell="manager"]');
        if (s.manager_name) {
            managerCell.innerHTML = `
                <div class="flex items-center gap-2">
                    <div class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-[10px] font-bold uppercase">
                        ${s.manager_username.charAt(0)}
                    </div>
                    <span class="text-xs font-medium text-slate-700">${s.manager_name}</span>
                </div>`;
        } else {
            managerCell.innerHTML = `
                <button class="btn-assign-manager inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold border-2 border-red-500 text-red-500 animate-pulse shadow-sm shadow-red-500/20 hover:bg-red-50 transition-all"
                    data-store-id="${s.id}" data-store-name="${s.name}">
                    ASSIGN MANAGER
                </button>`;
        }

        // -- Cluster cell
        let clusterCell = row.querySelector('[data-cell="cluster"]');
        if (s.cluster_name) {
            clusterCell.innerHTML = `<span class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700">${s.cluster_name}</span>`;
        } else {
            clusterCell.innerHTML = `<span class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-400">Unassigned</span>`;
        }


        // -- Actions cell
		let actionsCell = row.querySelector('[data-cell="actions"]');
		actionsCell.innerHTML = `
			<div class="inline-flex items-center gap-1">
				<button type="button" class="btn-edit-store inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors" title="Edit Store" aria-label="Edit Store"
					data-id="${s.id}" data-name="${s.name}" data-address="${s.address}"
					data-is-one-year="${s.is_one_year_already ? '1' : '0'}"
					data-manager-id="${s.manager_id || ''}">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
						<path d="m15 5 4 4" />
					</svg>
				</button>
				<button type="button" class="btn-delete-store inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors" title="Delete Store" aria-label="Delete Store"
					data-store-id="${s.id}" data-store-name="${s.name}">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M3 6h18" />
						<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
						<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
						<line x1="10" x2="10" y1="11" y2="17" />
						<line x1="14" x2="14" y1="11" y2="17" />
					</svg>
				</button>
			</div>`;

        tbody.appendChild(row);
    });
}



// -----------------------------------------------------------------------
// Sort helpers
// -----------------------------------------------------------------------

function updateSortIcons() {
document.querySelectorAll('.sort-icon').forEach(function(el) {
  let col = el.dataset.col;
  if (col === currentSort) {
	el.textContent = currentDir === 'asc' ? '↑' : '↓';
  } else {
	el.textContent = '⇅';
  }
});
}

// -----------------------------------------------------------------------
// Create store
// -----------------------------------------------------------------------

function onStoreCreated(data) {
if (data.type !== 'success') { toast.error(data.message); return; }
toast.success(data.message);
storeModal.close();
document.getElementById('new_name').value    = '';
document.getElementById('new_address').value = '';
document.getElementById('new_manager_id').value = '';
document.querySelector('input[name="new_is_one_year"][value="0"]').checked = true;
loadFormData();
loadStores();
}

function submitNewStore() {
let name    = document.getElementById('new_name').value.trim();
let address = document.getElementById('new_address').value.trim();
if (!name || !address) {
  toast.error('Please fill in all required fields!');
  return;
}
let isOneYear  = document.querySelector('input[name="new_is_one_year"]:checked').value;
let managerId  = document.getElementById('new_manager_id').value;

qBuilder.sendQuery('/apis/stores/create', onStoreCreated, {
  method: 'POST',
  body: JSON.stringify({ name, address, manager_id: managerId || null, is_one_year_already: isOneYear }),
});
}

// -----------------------------------------------------------------------
// Edit store
// -----------------------------------------------------------------------

function openEditStoreModal(id, name, address, isOneYear, managerId) {
activeStoreId = id;
document.getElementById('edit_name').value    = name;
document.getElementById('edit_address').value = address;
document.getElementById('edit_manager_id').value = managerId || '';

let noRadio  = document.querySelector('.edit-is-one-year-no');
let yesRadio = document.querySelector('.edit-is-one-year-yes');
if (isOneYear === '1') { yesRadio.checked = true; noRadio.checked = false; }
else                   { noRadio.checked = true; yesRadio.checked = false; }

editStoreModal.open();
}

function onStoreUpdated(data) {
if (data.type !== 'success') { toast.error(data.message); return; }
toast.success(data.message);
editStoreModal.close();
loadFormData();
loadStores();
}

function submitEditStore() {
let name    = document.getElementById('edit_name').value.trim();
let address = document.getElementById('edit_address').value.trim();
if (!name || !address) {
  toast.error('Please fill in all required fields!');
  return;
}
let isOneYear = document.querySelector('input[name="edit_is_one_year"]:checked').value;
let managerId = document.getElementById('edit_manager_id').value;

qBuilder.sendQuery(`/apis/stores/${activeStoreId}/update`, onStoreUpdated, {
  method: 'POST',
  body: JSON.stringify({ name, address, manager_id: managerId || null, is_one_year_already: isOneYear }),
});
}

// -----------------------------------------------------------------------
// Assign manager
// -----------------------------------------------------------------------

function openAssignManagerModal(storeId, storeName) {
activeStoreId = storeId;
document.getElementById('assign-store-name').textContent = storeName;
assignManagerModal.open();
}

function onManagerAssigned(data) {
if (data.type !== 'success') { toast.error(data.message); return; }
toast.success(data.message);
assignManagerModal.close();
loadFormData();
loadStores();
}

function submitAssignManager() {
let managerId = document.getElementById('assign_manager_id').value;
if (!managerId) { toast.error('Please select a manager.'); return; }

qBuilder.sendQuery(`/apis/stores/${activeStoreId}/assign-manager`, onManagerAssigned, {
  method: 'POST',
  body: JSON.stringify({ manager_id: managerId }),
});
}

// -----------------------------------------------------------------------
// Delete store
// -----------------------------------------------------------------------

function onStoreDeleted(data) {
if (data.type !== 'success') { toast.error(data.message); return; }
toast.success(data.message);
loadFormData();
loadStores();
}

function deleteStore(storeId, storeName) {
showConfirmationModal(
  `Delete "${storeName}"?`,
  'This action cannot be undone.',
  function() {
	qBuilder.sendQuery(`/apis/stores/${storeId}/delete`, onStoreDeleted, {
	  method: 'POST',
	  body: JSON.stringify({}),
	});
  }
);
}

// -----------------------------------------------------------------------
// Event listeners
// -----------------------------------------------------------------------

document.getElementById('openModalBtn').addEventListener('click', function() {
storeModal.open();
});

document.getElementById('submitNewStore').addEventListener('click', submitNewStore);
document.getElementById('submitEditStore').addEventListener('click', submitEditStore);
document.getElementById('submitAssignManager').addEventListener('click', submitAssignManager);

document.getElementById('store-search-input').addEventListener('input', function() {
clearTimeout(searchTimer);
searchTimer = setTimeout(function() {
  currentPage = 1;
  loadStores();
}, 400);
});

document.querySelectorAll('th[data-sort]').forEach(function(th) {
th.addEventListener('click', function() {
  let col = th.dataset.sort;
  if (currentSort === col) {
	currentDir = currentDir === 'asc' ? 'desc' : 'asc';
  } else {
	currentSort = col;
	currentDir  = 'asc';
  }
  updateSortIcons();
  currentPage = 1;
  loadStores();
});
});

document.getElementById('stores-table-body').addEventListener('click', function(e) {
let assignBtn = e.target.closest('.btn-assign-manager');
if (assignBtn) {
  openAssignManagerModal(assignBtn.dataset.storeId, assignBtn.dataset.storeName);
  return;
}
let editBtn = e.target.closest('.btn-edit-store');
if (editBtn) {
  openEditStoreModal(
	editBtn.dataset.id,
	editBtn.dataset.name,
	editBtn.dataset.address,
	editBtn.dataset.isOneYear,
	editBtn.dataset.managerId
  );
  return;
}
let deleteBtn = e.target.closest('.btn-delete-store');
if (deleteBtn) {
  deleteStore(deleteBtn.dataset.storeId, deleteBtn.dataset.storeName);
}
});


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
	window.setTimeout(loadStores(), 500);
	
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



// Utilities End


// -----------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------

loadFormData();
loadStores();
