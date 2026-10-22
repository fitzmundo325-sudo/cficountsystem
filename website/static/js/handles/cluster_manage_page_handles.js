// - State -
let canManageClusters = false;
let addStoreModal = null;
let assignManagerModal = null;
let totalPages = 1;
let totalResults = 0;

// - Helpers -
function getById(id) {
  return document.getElementById(id);
}

function getCell(root, name) {
  return root.querySelector('[data-cell="' + name + '"]');
}

async function postForm(url, formData) {
  let response = await fetch(url, { method: 'POST', body: formData });
  return await response.json();
}

function applyManageVisibility() {
  let elements = document.querySelectorAll('[data-manage-only]');
  for (let element of elements) {
    element.classList.toggle('hidden', !canManageClusters);
  }
}

// - Rendering -
function renderEmptyRow(message) {
  let body = getById('storesTableBody');
  let clone = getById('storeEmptyRowTemplate').content.cloneNode(true);
  let messageCell = getCell(clone, 'message');
  messageCell.textContent = message;
  messageCell.colSpan = canManageClusters ? 5 : 4;
  body.innerHTML = '';
  body.appendChild(clone);
}

function renderManager(manager) {
  let nameEl = getById('clusterManagerName');
  let assignWrap = getById('assignManagerWrap');
  let unassignedText = getById('managerUnassignedText');

  nameEl.classList.add('hidden');
  assignWrap.classList.add('hidden');
  unassignedText.classList.add('hidden');

  if (manager) {
    nameEl.textContent = manager.full_name;
    nameEl.classList.remove('hidden');
  } else if (canManageClusters) {
    assignWrap.classList.remove('hidden');
  } else {
    unassignedText.classList.remove('hidden');
  }
}

function renderCluster(cluster) {
  getById('clusterName').textContent = cluster.name;
  getById('breadcrumbClusterName').textContent = cluster.name;
  getById('clusterDescription').textContent = cluster.description || 'No description';
  getById('clusterStoreCount').textContent = cluster.store_count;
  getById('addStoreModalClusterName').textContent = cluster.name;
  getById('assignManagerModalClusterName').textContent = cluster.name;
  document.title = 'Manage ' + cluster.name;
  renderManager(cluster.manager);
}

function renderStores(stores) {
  let body = getById('storesTableBody');
  let template = getById('storeRowTemplate');

  if (!stores.length) {
    renderEmptyRow(canManageClusters
      ? 'No stores in this cluster yet. Add some stores to get started!'
      : 'No stores in this cluster yet.');
    return;
  }

  body.innerHTML = '';
  for (let store of stores) {
    let clone = template.content.cloneNode(true);
    getCell(clone, 'id').textContent = '#' + store.id;
    getCell(clone, 'name').textContent = store.name;
    getCell(clone, 'address').textContent = store.address || '';
    getCell(clone, 'dateAdded').textContent = store.date_added || '—';

    let removeBtn = getCell(clone, 'removeBtn');
    removeBtn.dataset.storeId = store.id;
    removeBtn.dataset.storeName = store.name;
    removeBtn.addEventListener('click', handleRemoveStoreClick);

    body.appendChild(clone);
  }
}

function renderPagination() {
  let wrap = getById('storesPagination');
  wrap.classList.toggle('hidden', totalResults === 0);

  getById('storesPaginationInfo').textContent = totalResults + ' store' + (totalResults === 1 ? '' : 's');
  getById('storesPageLabel').textContent = 'Page ' + qBuilder.page + ' of ' + Math.max(totalPages, 1);
  getById('storesPrevBtn').disabled = qBuilder.page <= 1;
  getById('storesNextBtn').disabled = qBuilder.page >= totalPages;
}

function renderAvailableStores(stores) {
  let list = getById('availableStoresList');
  let template = getById('availableStoreTemplate');

  list.innerHTML = '';
  getById('availableStoresEmpty').classList.toggle('hidden', stores.length > 0);

  for (let store of stores) {
    let clone = template.content.cloneNode(true);
    getCell(clone, 'checkbox').value = store.id;
    getCell(clone, 'name').textContent = store.name;
    getCell(clone, 'address').textContent = store.address || '';
    list.appendChild(clone);
  }
}

function renderAvailableManagers(managers) {
  let select = getById('manager_id');
  select.innerHTML = '';
  select.appendChild(new Option('Select a manager', ''));
  for (let manager of managers) {
    select.appendChild(new Option(manager.full_name + ' (' + manager.username + ')', manager.id));
  }
}

// - Data loading -
function showLoadError(message) {
  toast.error(message);
  renderEmptyRow(message);
  getById('storesPagination').classList.add('hidden');
}

async function loadClusterInfo() {
  if (!clusterId) {
    showLoadError('No cluster selected.');
    return false;
  }

  try {
    let response = await fetch('/apis/get_cluster_manage_info?cluster_id=' + encodeURIComponent(clusterId));
    let data = await response.json();

    if (data.type !== 'success') {
      showLoadError(data.message || 'Failed to load cluster.');
      return false;
    }

    canManageClusters = !!data.can_manage;
    renderCluster(data.cluster);
    renderAvailableStores(data.available_stores || []);
    renderAvailableManagers(data.available_managers || []);
    applyManageVisibility();
    return true;
  } catch (error) {
    showLoadError('Unable to load cluster. Please try again.');
    return false;
  }
}

function handleStoresSuccess(xhr) {
  let data = JSON.parse(xhr.responseText);

  if (data.type !== 'success') {
    showLoadError(data.message || 'Failed to load stores.');
    return;
  }

  let pagination = data.pagination_data;
  totalPages = pagination.total_pages;
  totalResults = pagination.total_results;
  qBuilder.maxPage = Math.max(totalPages, 1);

  if (!data.data.stores.length && qBuilder.page > 1 && totalPages < qBuilder.page) {
    qBuilder.page = Math.max(totalPages, 1);
    loadStores();
    return;
  }

  canManageClusters = !!data.data.can_manage;
  renderStores(data.data.stores);
  applyManageVisibility();
  renderPagination();
}

function handleStoresError() {
  showLoadError('Unable to load stores. Please try again.');
}

function loadStores() {
  qBuilder.sendQuery(
    handleStoresSuccess,
    '/apis/clusters_stores_list',
    [
      { name: 'cluster_id', value: clusterId },
      { name: 'scope', value: 'all' }
    ],
    handleStoresError
  );
}

async function refreshAll() {
  let loaded = await loadClusterInfo();
  if (loaded) {
    loadStores();
  }
}

// - Pagination -
function handlePrevPage() {
  if (qBuilder.page > 1) {
    qBuilder.paginate('prev');
    loadStores();
  }
}

function handleNextPage() {
  if (qBuilder.page < totalPages) {
    qBuilder.paginate('next');
    loadStores();
  }
}

// - Actions -
function openAddStoreModal() {
  addStoreModal.open();
}

function openAssignManagerModal() {
  assignManagerModal.open();
}

async function handleAddStoresSubmit(event) {
  event.preventDefault();

  let formData = new FormData(getById('addStoreForm'));
  if (!formData.getAll('store_ids').length) {
    toast.warn('Select at least one store.');
    return;
  }
  formData.append('cluster_id', clusterId);

  try {
    let data = await postForm('/apis/add_cluster_stores', formData);
    if (data.type === 'success') {
      toast.success(data.message);
      addStoreModal.close();
      await refreshAll();
    } else {
      toast.error(data.message || 'Failed to add stores.');
    }
  } catch (error) {
    toast.error('Failed to add stores.');
  }
}

async function handleAssignManagerSubmit(event) {
  event.preventDefault();

  let formData = new FormData(getById('assignManagerForm'));
  formData.append('cluster_id', clusterId);

  try {
    let data = await postForm('/apis/assign_cluster_manager', formData);
    if (data.type === 'success') {
      toast.success(data.message);
      assignManagerModal.close();
      await loadClusterInfo();
    } else {
      toast.error(data.message || 'Failed to assign manager.');
    }
  } catch (error) {
    toast.error('Failed to assign manager.');
  }
}

async function removeStore(storeId) {
  let formData = new FormData();
  formData.append('cluster_id', clusterId);
  formData.append('store_id', storeId);

  try {
    let data = await postForm('/apis/remove_cluster_store', formData);
    if (data.type === 'success') {
      toast.success(data.message);
      await refreshAll();
    } else {
      toast.error(data.message || 'Failed to remove store.');
    }
  } catch (error) {
    toast.error('Failed to remove store.');
  }
}

function handleRemoveStoreClick(event) {
  let storeId = event.currentTarget.dataset.storeId;
  let storeName = event.currentTarget.dataset.storeName;

  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Remove Store',
      message: 'Remove ' + storeName + ' from this cluster?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      onConfirm: removeStore.bind(null, storeId)
    });
    return;
  }

  if (confirm('Remove this store from cluster?')) {
    removeStore(storeId);
  }
}

// - Init -
addStoreModal = new Modal('addStoreModal');
assignManagerModal = new Modal('assignManagerModal');

getById('addStoreBtn').addEventListener('click', openAddStoreModal);
getById('assignManagerBtn').addEventListener('click', openAssignManagerModal);
getById('addStoreForm').addEventListener('submit', handleAddStoresSubmit);
getById('assignManagerForm').addEventListener('submit', handleAssignManagerSubmit);
getById('storesPrevBtn').addEventListener('click', handlePrevPage);
getById('storesNextBtn').addEventListener('click', handleNextPage);

qBuilder.server_address = '/apis/clusters_stores_list';
refreshAll();
