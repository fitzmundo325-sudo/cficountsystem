
// -----------------------------------------------
// State
// -----------------------------------------------
let clusterData = [];
let canManage   = false;
let clusterModal = new Modal('clusterModal');
let searchTimer  = null;
let editClusterModal = new Modal('editClusterModal');

qBuilder.server_address = '/apis/clusters_list_admin';

// -----------------------------------------------
// Load
// -----------------------------------------------
function loadClusters() {
	qBuilder.search = document.getElementById('search-input').value;
	loadOnTableSpinner();
	qBuilder.sendQuery(process);

	function process(data) {
	  clearTableSpinner();
	  let res = JSON.parse(data.responseText);

	  if (res.type !== 'success') {
		toast.error(res.message || 'Failed to load clusters.');
		return;
	  }

	  clusterData = res.data.clusters;
	  canManage   = res.data.can_manage;

	  document.getElementById('page-subtitle').textContent = canManage
		? 'Manage store clusters and assign cluster managers.'
		: 'View all clusters and their store performance data.';

	  if (canManage) {
		document.getElementById('openModalBtn').classList.remove('hidden');
		loadManagers();
	  }

	  renderClusters(clusterData);
	  genPages(data.responseText);
	}
}

// -----------------------------------------------
// Build & Render
// -----------------------------------------------
function buildClusterCard(cluster) {
let tmpl = document.getElementById('tmpl-cluster-card');
let card = tmpl.content.cloneNode(true);

card.querySelector('[data-cell="store-count"]').textContent       = cluster.store_count + ' stores';
card.querySelector('[data-cell="view-data-link"]').href           = '/cluster-manager/cluster-data?cluster_id=' + cluster.id;
card.querySelector('[data-cell="name"]').textContent              = cluster.name;
card.querySelector('[data-cell="description"]').textContent       = cluster.description || 'No description';
card.querySelector('[data-cell="manager-avatar"]').textContent    = cluster.manager_initial;
card.querySelector('[data-cell="manager-name"]').textContent      = cluster.manager_name;
card.querySelector('[data-cell="date-added"]').textContent        = cluster.date_added ? 'Added ' + cluster.date_added : '';
card.querySelector('[data-cell="manage-link"]').href              = '/admin/clusters/' + cluster.id + '/manage';
card.querySelector('[data-cell="manage-link"]').textContent       = canManage ? 'Manage Stores' : 'View Stores';


card.querySelector('[data-cell="edit-btn"]').addEventListener('click', function() { openEditClusterModal(cluster); });
card.querySelector('[data-cell="delete-btn"]').addEventListener('click', function() { handleDeleteCluster(cluster); });


return card;
}

function renderClusters(data) {
	let grid  = document.getElementById('clusters-grid');
	let empty = document.getElementById('clusters-empty');

	grid.innerHTML = '';

	if (!data.length) {
	  empty.classList.remove('hidden');
	  return;
	}

	empty.classList.add('hidden');
	
	data.forEach(function(cluster) {
	  grid.appendChild(buildClusterCard(cluster));
	});
}

// -----------------------------------------------
// Table Spinners
// -----------------------------------------------
function loadOnTableSpinner() {
let grid = document.getElementById('clusters-grid');
if (!grid || document.getElementById('clusters-spinner')) return;
let div = document.createElement('div');
div.id = 'clusters-spinner';
div.className = 'col-span-full text-center py-12 text-slate-400';
div.innerHTML = '<i class="fa fa-spinner fa-spin mr-2"></i> Loading...';
grid.appendChild(div);
}

function clearTableSpinner() {
let spinner = document.getElementById('clusters-spinner');
if (spinner) spinner.remove();
}

// -----------------------------------------------
// Pagination
// -----------------------------------------------
function genPages(responseText) {
let paginations = JSON.parse(responseText).pagination_data;
let generated   = generatePagination(paginations, 'paginates', 'jumpToPage');
_('paginations') ? _('paginations').innerHTML = generated.innerHTML : false;
}


function paginates(dir) {
qBuilder.paginate(dir, true);
delayedQuery();
}


function jumpToPage(page_n) {
qBuilder.page = page_n;
delayedQuery();
}

// -----------------------------------------------
// Sort
// -----------------------------------------------
function sortByThis(elm) {
let sortname     = elm.getAttribute('sortname');
let currentOrder = elm.getAttribute('sort-order');
let nextOrder    = currentOrder === 'asc' ? 'desc' : 'asc';

elm.setAttribute('sort-order', nextOrder);
qBuilder.sort     = sortname;
qBuilder.order_by = nextOrder;

delayedQuery(true);
}

// -----------------------------------------------
// Helpers
// -----------------------------------------------
function delayedQuery(resetPage) {
if (resetPage) qBuilder.page = 1;
window.setTimeout(loadClusters, 500);
}

// -----------------------------------------------
// API - Load Managers (for modal select)
// -----------------------------------------------
function loadManagers() {
  fetch('/apis/clusters_managers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  .then(function(res) { return res.json(); })
  .then(function(res) {
    if (res.type !== 'success') return;
    let selects = ['cluster-manager', 'edit-cluster-manager'];
    selects.forEach(function(id) {
      let select = document.getElementById(id);
      select.innerHTML = '<option value="">Select a manager (optional)</option>';
      res.data.forEach(function(m) {
        let opt         = document.createElement('option');
        opt.value       = m.id;
        opt.textContent = m.full_name + ' (' + m.username + ')';
        select.appendChild(opt);
      });
    });
  });
}

// -----------------------------------------------
// API - Create Cluster
// -----------------------------------------------
function submitCreateCluster() {
let name        = document.getElementById('cluster-name');
let description = document.getElementById('cluster-description');
let managerId   = document.getElementById('cluster-manager');

if (!name.value.trim()) {
  clusterModal.shakeElement(name);
  toast.error('Please enter a cluster name!');
  return;
}

fetch('/apis/clusters_create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
	name:        name.value.trim(),
	description: description.value.trim(),
	manager_id:  managerId.value || null
  })
})
.then(function(res) { return res.json(); })
.then(function(res) {
  if (res.type !== 'success') {
	toast.error(res.message || 'Failed to create cluster.');
	return;
  }
  toast.success(res.message || 'Cluster created.');
  clusterModal.close();
  name.value        = '';
  description.value = '';
  managerId.value   = '';
  loadClusters();
})
.catch(function() {
  toast.error('Something went wrong.');
});
}

// -----------------------------------------------
// Modal
// -----------------------------------------------
function openClusterModal() {
clusterModal.open();
}

// -----------------------------------------------
// Event Listeners
// -----------------------------------------------
document.getElementById('search-input').addEventListener('input', function() {
clearTimeout(searchTimer);
searchTimer = setTimeout(function() {
  qBuilder.page = 1;
  loadClusters();
}, 350);
});

document.getElementById('openModalBtn').addEventListener('click', openClusterModal);
document.getElementById('submitClusterBtn').addEventListener('click', submitCreateCluster);
document.getElementById('editClusterBtn').addEventListener('click', submitEditCluster);

// -----------------------------------------------
// Edit Cluster Modal
// -----------------------------------------------
function openEditClusterModal(cluster) {
  document.getElementById('edit-cluster-name').value        = cluster.name || '';
  document.getElementById('edit-cluster-description').value = cluster.description || '';
  document.getElementById('edit-cluster-manager').value     = cluster.manager_id || '';
  
  document.getElementById('editClusterBtn').dataset.clusterId = cluster.id;
  editClusterModal.open();
}


function submitEditCluster() {
  let name        = document.getElementById('edit-cluster-name');
  let description = document.getElementById('edit-cluster-description');
  let managerId   = document.getElementById('edit-cluster-manager');
  let clusterId   = document.getElementById('editClusterBtn').dataset.clusterId;

  if (!name.value.trim()) {
    editClusterModal.shakeElement(name);
    toast.error('Please enter a cluster name!');
    return;
  }

  fetch('/apis/clusters_update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id:          clusterId,
      name:        name.value.trim(),
      description: description.value.trim(),
      manager_id:  managerId.value || null
    })
  })
  .then(function(res) { return res.json(); })
  .then(function(res) {
    if (res.type !== 'success') {
      toast.error(res.message || 'Failed to update cluster.');
      return;
    }
    toast.success(res.message || 'Cluster updated.');
    editClusterModal.close();
    loadClusters();
  })
  .catch(function() {
    toast.error('Something went wrong.');
  });
}

// -----------------------------------------------
// Delete Cluster
// -----------------------------------------------
function handleDeleteCluster(cluster) {
  let doDelete = function() {
    fetch('/apis/clusters_delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cluster.id })
    })
    .then(function(res) { return res.json(); })
    .then(function(res) {
      if (res.type !== 'success') {
        toast.error(res.message || 'Failed to delete cluster.');
        return;
      }
      toast.success(res.message || 'Cluster deleted.');
      loadClusters();
    })
    .catch(function() {
      toast.error('Something went wrong.');
    });
  };

  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title:       'Delete Cluster',
      message:     'Are you sure you want to delete "' + cluster.name + '"? This action cannot be undone.',
      confirmText: 'Yes, Delete',
      cancelText:  'Cancel',
      onConfirm:   doDelete,
    });
  } else {
    if (confirm('Are you sure you want to delete "' + cluster.name + '"?')) doDelete();
  }
}



// -----------------------------------------------
// Init
// -----------------------------------------------
loadClusters();
