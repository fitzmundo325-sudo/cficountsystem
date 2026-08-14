

//Assign the modal
usersModal     = new Modal('userModal');
editUsersModal = new Modal('editUserModal');

qBuilder.server_address = apiUsersUrl;

let createRoleEl         = document.getElementById('role');
let createStoreEl        = document.getElementById('assigned_store_id');
let createStoreGroupEl   = document.getElementById('assigned_store_group');
let createClusterEl      = document.getElementById('assigned_cluster_id');
let createClusterGroupEl = document.getElementById('assigned_cluster_group');
let editRoleEl           = document.getElementById('edit_role');
let editStoreEl          = document.getElementById('edit_assigned_store_id');
let editStoreGroupEl     = document.getElementById('edit_assigned_store_group');
let editClusterEl        = document.getElementById('edit_assigned_cluster_id');
let editClusterGroupEl   = document.getElementById('edit_assigned_cluster_group');

let searchTimer = null;

// ── Load ──────────────────────────────────────────────────
function loadAllUsers(dataOnly = false) {
qBuilder.search = document.getElementById('users-live-search').value;
loadOnTableSpinner();
qBuilder.sendQuery(process);
if (dataOnly) createDialogue('wait', 'loading');

function process(data) {
  clearTableSpinner();
  tableLoader(data);
  destroy_dia();
  if (typeof genPages === 'function') genPages(data.responseText);
}
}

// ── Table Loader ──────────────────────────────────────────
function tableLoader(data) {
let resData = JSON.parse(data.responseText);
let users   = resData.users;

let tbody    = document.getElementById('users-table-body');
let tmplRow  = document.getElementById('user-row-template');
let emptyRow = document.getElementById('users-empty-row');

Array.from(tbody.querySelectorAll('tr:not(#users-empty-row):not(#table-spinner-row)')).forEach(r => r.remove());

if (!users || !users.length) {
  emptyRow.classList.remove('hidden');
  return;
}
emptyRow.classList.add('hidden');

let frag = document.createDocumentFragment();

users.forEach(u => {
  let clone = tmplRow.content.cloneNode(true);
  let row   = clone.querySelector('tr');
  row.classList.add('user-row');
  row.dataset.userId   = u.id;
  row.dataset.userData = JSON.stringify(u);

  row.querySelector('[data-cell="id"]').textContent             = '#' + u.id;
  row.querySelector('[data-cell="avatar"]').textContent         = (u.username || '').charAt(0).toUpperCase();
  row.querySelector('[data-cell="username"]').textContent       = u.username || '';
  row.querySelector('[data-cell="full_name"]').textContent      = u.full_name || '';
  row.querySelector('[data-cell="email"]').textContent          = u.email || '';
  row.querySelector('[data-cell="role"]').textContent           = u.role || 'User';
  row.querySelector('[data-cell="assigned_store"]').textContent = resolveAssignedStore(u);
  row.querySelector('[data-cell="date_added"]').textContent     = u.date_added || '--';

  let editBtn   = row.querySelector('.editUserBtn');
  let deleteBtn = row.querySelector('.deleteUserBtn');

  if (editBtn)   editBtn.addEventListener('click',   () => openEditModal(u));
  if (deleteBtn) deleteBtn.addEventListener('click', () => handleDelete(u.id, row));

  frag.appendChild(clone);
});

tbody.appendChild(frag);
}

// ── Resolve assigned store display ────────────────────────
function resolveAssignedStore(u) {
if (u.role === 'Store Manager')   return u.managed_store   || '--';
if (u.role === 'Cluster Manager') return u.managed_cluster || '--';
if (u.role === 'Area Manager')    return u.assigned_clusters && u.assigned_clusters.length ? u.assigned_clusters.join(', ') : '--';
if (u.assigned_stores && u.assigned_stores.length) return u.assigned_stores.join(', ');
return '--';
}

// ── Assignment group toggle ───────────────────────────────
function syncAssignmentGroups(roleEl, storeEl, storeGroupEl, clusterEl, clusterGroupEl) {
if (!roleEl) return;
let isInventoryStaff = roleEl.value === 'Inventory Staff';
let isAreaManager    = roleEl.value === 'Area Manager';
storeGroupEl.classList.toggle('hidden', !isInventoryStaff);
storeEl.classList.toggle('border-amber-300', isInventoryStaff);
if (!isInventoryStaff) storeEl.querySelectorAll('input[type="checkbox"]').forEach(i => i.checked = false);
clusterGroupEl.classList.toggle('hidden', !isAreaManager);
clusterEl.classList.toggle('border-amber-300', isAreaManager);
if (!isAreaManager) clusterEl.querySelectorAll('input[type="checkbox"]').forEach(i => i.checked = false);
}

// ── Edit modal ────────────────────────────────────────────
function openEditModal(u) {
let editForm = document.getElementById('editUserForm');
editForm.action = updateUserUrl.replace('/0/', '/' + u.id + '/');
document.getElementById('edit_full_name').value = u.full_name || '';
document.getElementById('edit_username').value  = u.username  || '';
document.getElementById('edit_email').value     = u.email     || '';
document.getElementById('edit_role').value      = u.role      || '';
document.getElementById('edit_new_password').value         = '';
document.getElementById('edit_confirm_new_password').value = '';

let selectedStoreIds   = (u.assigned_store_ids   || []).map(String);
let selectedClusterIds = (u.assigned_cluster_ids || []).map(String);

document.querySelectorAll('#edit_assigned_store_id input[type="checkbox"]').forEach(i => {
  i.checked = selectedStoreIds.includes(String(i.value));
});
document.querySelectorAll('#edit_assigned_cluster_id input[type="checkbox"]').forEach(i => {
  i.checked = selectedClusterIds.includes(String(i.value));
});

syncAssignmentGroups(editRoleEl, editStoreEl, editStoreGroupEl, editClusterEl, editClusterGroupEl);
editUsersModal.open();
}

// ── Delete ────────────────────────────────────────────────
function handleDelete(userId, row) {
if (!confirm('Delete this user?')) return;
let url = deleteUserUrl.replace('/0/', '/' + userId + '/');
fetch(url, { method: 'POST' })
  .then(r => r.json())
  .then(data => {
	if (data.type === 'success') {
	  row.remove();
	  toast.success(data.message || 'User deleted.');
	} else {
	  toast.error(data.message || 'Failed to delete user.');
	}
  })
  .catch(() => toast.error('Network error while deleting user.'));
}

// ── Table spinners ────────────────────────────────────────
function loadOnTableSpinner() {
let tbody = document.getElementById('users-table-body');
if (!tbody) return;
if (document.getElementById('table-spinner-row')) return;
let colSpan = tbody.closest('table').querySelectorAll('thead th').length;
let tr  = document.createElement('tr');
tr.id   = 'table-spinner-row';
let td       = document.createElement('td');
td.colSpan   = colSpan;
td.className = 'text-center py-6 text-slate-400';
td.innerHTML = '<i class="fa fa-spinner fa-spin mr-2"></i> Loading...';
tr.appendChild(td);
tbody.appendChild(tr);
}

function clearTableSpinner() {
let row = document.getElementById('table-spinner-row');
if (row) row.remove();
}

// ── Search ────────────────────────────────────────────────
document.getElementById('users-live-search')?.addEventListener('input', () => {
clearTimeout(searchTimer);
searchTimer = setTimeout(() => loadAllUsers(true), 350);
});

// ── Form validation ───────────────────────────────────────
document.getElementById('newUserForm').addEventListener('submit', e => {
let password        = document.getElementById('password');
let confirmPassword = document.getElementById('confirm_password');
let assignedStore   = createStoreEl;
let assignedCluster = createClusterEl;

if (password.value !== confirmPassword.value) {
  e.preventDefault();
  usersModal.shakeElement(password);
  usersModal.shakeElement(confirmPassword);
  toast.error('Passwords do not match!');
  return;
}
if (createRoleEl?.value === 'Inventory Staff' && !assignedStore?.querySelector('input[type="checkbox"]:checked')) {
  e.preventDefault();
  usersModal.shakeElement(assignedStore);
  toast.error('Select at least one Assigned Store for Inventory Staff.');
  return;
}
if (createRoleEl?.value === 'Area Manager') {
  let checkedClusters = assignedCluster?.querySelectorAll('input[type="checkbox"]:checked') || [];
  if (checkedClusters.length === 0) {
	e.preventDefault();
	usersModal.shakeElement(assignedCluster);
	toast.error('Select at least one Cluster for the Area Manager.');
	return;
  }
  if (checkedClusters.length > 6) {
	e.preventDefault();
	usersModal.shakeElement(assignedCluster);
	toast.error('An Area Manager can be assigned a maximum of 6 clusters.');
	return;
  }
}
});

document.getElementById('editUserForm').addEventListener('submit', e => {
let password        = document.getElementById('edit_new_password');
let confirmPassword = document.getElementById('edit_confirm_new_password');
let assignedStore   = editStoreEl;
let assignedCluster = editClusterEl;

if (password.value || confirmPassword.value) {
  if (password.value !== confirmPassword.value) {
	e.preventDefault();
	editUsersModal.shakeElement(password);
	editUsersModal.shakeElement(confirmPassword);
	toast.error('New passwords do not match!');
	return;
  }
  if (password.value.length < 6) {
	e.preventDefault();
	editUsersModal.shakeElement(password);
	toast.error('New password must be at least 6 characters.');
	return;
  }
}
if (editRoleEl?.value === 'Inventory Staff' && !assignedStore?.querySelector('input[type="checkbox"]:checked')) {
  e.preventDefault();
  editUsersModal.shakeElement(assignedStore);
  toast.error('Select at least one Assigned Store for Inventory Staff.');
  return;
}
if (editRoleEl?.value === 'Area Manager') {
  let checkedClusters = assignedCluster?.querySelectorAll('input[type="checkbox"]:checked') || [];
  if (checkedClusters.length === 0) {
	e.preventDefault();
	editUsersModal.shakeElement(assignedCluster);
	toast.error('Select at least one Cluster for the Area Manager.');
	return;
  }
  if (checkedClusters.length > 6) {
	e.preventDefault();
	editUsersModal.shakeElement(assignedCluster);
	toast.error('An Area Manager can be assigned a maximum of 6 clusters.');
	return;
  }
}
});



// ── Init ──────────────────────────────────────────────────
document.getElementById('openModalBtn').addEventListener('click', () => usersModal.open());
createRoleEl?.addEventListener('change', () => syncAssignmentGroups(createRoleEl, createStoreEl, createStoreGroupEl, createClusterEl, createClusterGroupEl));
editRoleEl?.addEventListener('change',   () => syncAssignmentGroups(editRoleEl, editStoreEl, editStoreGroupEl, editClusterEl, editClusterGroupEl));
syncAssignmentGroups(createRoleEl, createStoreEl, createStoreGroupEl, createClusterEl, createClusterGroupEl);
loadAllUsers();






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
	window.setTimeout(loadAllUsers(), 500);
		
		
	
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

