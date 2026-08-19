

qBuilder.server_address = "../apis/product_masterlist";

function loadAllItems(dataOnly=false){

	qBuilder.search = _("product-live-search").value;
	loadOnTableSpinner();
	
	// await sleep(100);
	
	qBuilder.sendQuery(process);
	
	//createDialogue("wait", "Please wait...");
	if(dataOnly == true){
		createDialogue('wait', 'loading');
	}
	
	loadOnTableSpinner();
	
	function process(data){
			clearTableSpinner();
			tableLoader(data);
			genPages(data.responseText);
			
			
			
	}
}

loadAllItems();

function tableLoader(data) {
  let resData = JSON.parse(data.responseText);
  let products = resData.products;

  let tbody       = _('product-table-body');
  let tmplRow     = document.getElementById('tmpl-product-row');
  let emptyRow    = _('product-empty-row');
  let loadingRow  = _('product-loading-row');
  let totalAll = resData.pagination_data.total_results;
	

  // Clear existing product rows
  Array.from(tbody.querySelectorAll('.product-row')).forEach(r => r.remove());

  loadingRow.classList.add('hidden');

  if (!products || !products.length) {
    emptyRow.classList.remove('hidden');
    return;
  }

  emptyRow.classList.add('hidden');

  let frag = document.createDocumentFragment();

  products.forEach(p => {
    let clone = tmplRow.content.cloneNode(true);
    let tr    = clone.querySelector('tr');

    // Store full product data on row for edit modal
    tr.dataset.productId   = p.id;
    tr.dataset.productData = JSON.stringify(p);

    // Fill cells
    clone.querySelector('[data-cell="code"]').textContent         = p.code ?? '-';
    clone.querySelector('[data-cell="description-text"]').textContent = p.description ?? '-';
    clone.querySelector('[data-cell="category"]').textContent     = p.category ?? '-';
    clone.querySelector('[data-cell="sub_category"]').textContent = p.sub_category || '-';
    clone.querySelector('[data-cell="tp"]').textContent           = p.tp    != null ? parseFloat(p.tp).toFixed(2)    : '-';
    clone.querySelector('[data-cell="sp_p"]').textContent         = p.sp_p  != null ? parseFloat(p.sp_p).toFixed(2)  : '-';
    clone.querySelector('[data-cell="sp_np"]').textContent        = p.sp_np != null ? parseFloat(p.sp_np).toFixed(2) : '-';
    clone.querySelector('[data-cell="shelf_life"]').textContent   = p.shelf_life || '-';
    clone.querySelector('[data-cell="updated_at"]').textContent   = p.updated_at ?? '-';

    // Aliases
    let aliasLabel = clone.querySelector('[data-cell="alias-label"]');
    let aliasList  = clone.querySelector('[data-cell="alias-list"]');
    if (p.aliases && p.aliases.length) {
      aliasLabel.textContent = 'Aliases';
      aliasList.textContent  = p.aliases.map(a => a.alias_name).join(', ');
    } else {
      aliasLabel.textContent = '';
      aliasList.textContent  = 'No linked aliases yet.';
      aliasList.classList.add('text-slate-500');
    }

    // Action button data
    clone.querySelector('.edit-product-btn').dataset.productId    = p.id;
    clone.querySelector('.delete-product-btn').dataset.productId  = p.id;
    clone.querySelector('.delete-product-btn').dataset.productName = p.description;
	
	let detailsElement = tag("trend_index",clone)[0];
		detailsElement.setAttribute("item_id",p.id);
		
    frag.appendChild(clone);
  });

  tbody.appendChild(frag);
  
  
  _("total-products-count") ? _("total-products-count").innerText = totalAll: false;
  
  
  initAliasDropdowns();
}



function loadOnTableSpinner() {
  let tbody = _('product-table-body');
  let colSpan = tbody.closest('table').querySelectorAll('thead th').length;

  let existing = document.getElementById('table-spinner-row');
  if (existing) return;
	
	
	

  let tr  = document.createElement('tr');
  tr.id   = 'table-spinner-row';

  let td        = document.createElement('td');
  td.colSpan    = colSpan;
  td.className  = 'text-center py-6 text-slate-400';
  td.innerHTML  = '<i class="fa fa-spinner fa-spin mr-2"></i> Loading...';

  tr.appendChild(td);
  tbody.appendChild(tr);
}


function clearTableSpinner() {
  let row = document.getElementById('table-spinner-row');
  if (row) row.remove();
}


function initAliasDropdowns() {
  const tbody     = _('product-table-body');
  const triggers  = Array.from(tbody.querySelectorAll('.alias-dropdown-trigger'));
  const dropdowns = Array.from(tbody.querySelectorAll('.alias-dropdown'));

  function closeAll() {
    dropdowns.forEach(d => d.classList.add('hidden'));
    triggers.forEach(t => t.setAttribute('aria-expanded', 'false'));
  }

  triggers.forEach(trigger => {
    trigger.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const dropdown = trigger.closest('td').querySelector('.alias-dropdown');
      if (!dropdown) return;
      const isOpen = !dropdown.classList.contains('hidden');
      closeAll();
      if (!isOpen) {
        dropdown.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

// Close alias dropdowns on outside click or Escape
document.addEventListener('click', e => {
  if (!e.target.closest('.alias-dropdown') && !e.target.closest('.alias-dropdown-trigger')) {
    document.querySelectorAll('.alias-dropdown').forEach(d => d.classList.add('hidden'));
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.alias-dropdown').forEach(d => d.classList.add('hidden'));
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
	window.setTimeout(loadAllItems(), 500);
		
		
	
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



(function () {
// ── Add Product ───────────────────────────────────────────
document.getElementById('add-product-btn').addEventListener('click', () => addProductModal.open());

document.getElementById('addProductForm').addEventListener('submit', function (e) {
  e.preventDefault();

  let code        = document.getElementById('product-code');
  let description = document.getElementById('product-description');
  let category    = document.getElementById('product-category');

  if (!code.value.trim())        { addProductModal.shakeElement(code);        toast.error('Please enter a product code!'); return; }
  if (!description.value.trim()) { addProductModal.shakeElement(description); toast.error('Please enter a description!');  return; }
  if (!category.value.trim())    { addProductModal.shakeElement(category);    toast.error('Please enter a category!');     return; }

  let data = {
    code:         code.value.trim(),
    description:  description.value.trim(),
    category:     category.value.trim(),
    sub_category: document.getElementById('product-sub-category').value.trim(),
    tp:           parseFloat(document.getElementById('product-tp').value)    || 0,
    sp_p:         parseFloat(document.getElementById('product-sp-p').value)  || 0,
    sp_np:        parseFloat(document.getElementById('product-sp-np').value) || 0,
    shelf_life:   document.getElementById('product-shelf-life').value.trim(),
  };

  fetch('/apis/add_product_master', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
    .then(r => r.json())
    .then(result => {
      if (result.type === 'success') {
        toast.success('Product added successfully!');
        addProductModal.close();
        loadAllItems();
      } else {
        toast.error('Error: ' + (result.message || 'Failed to add product'));
      }
    })
    .catch(() => toast.error('Error adding product. Please try again.'));
});



// ── Delete button (delegated) ─────────────────────────────
document.addEventListener('click', function (e) {
  let deleteBtn = e.target.closest('.delete-product-btn');
  if (!deleteBtn) return;

  let productId   = deleteBtn.dataset.productId;
  let productName = deleteBtn.dataset.productName;

  let doDelete = () => {
    fetch(`../apis/delete_product_master/${productId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
      .then(r => r.json())
      .then(result => {
        if (result.type === 'success') {
          toast.success('Product deleted successfully');
          loadAllItems();
        } else {
          toast.error('Error: ' + (result.message || 'Failed to delete product'));
        }
      })
      .catch(() => toast.error('Error deleting product. Please try again.'));
  };

  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title:       'Delete Product',
      message:     `Are you sure you want to delete "${productName}"? This action cannot be undone.`,
      confirmText: 'Yes, Delete',
      cancelText:  'Cancel',
      onConfirm:   doDelete,
    });
  } else {
    if (confirm(`Are you sure you want to delete "${productName}"? This action cannot be undone.`)) {
      doDelete();
    }
  }
});
  // ── Init ──────────────────────────────────────────────────
  addProductModal = new Modal('addProductModal');

})();





document.addEventListener('click', function (e) {
  const editBtn = e.target.closest('.edit-product-btn');
  if (!editBtn) return;

  const row = editBtn.closest('tr');
  if (!row || !row.dataset.productData) return;

  const p = JSON.parse(row.dataset.productData);

  document.getElementById('edit-product-id').value           = p.id        ?? '';
  document.getElementById('edit-product-code').value         = p.code      ?? '';
  document.getElementById('edit-product-description').value  = p.description ?? '';
  document.getElementById('edit-product-category').value     = p.category  ?? '';
  document.getElementById('edit-product-sub-category').value = p.sub_category ?? '';
  document.getElementById('edit-product-tp').value           = p.tp        ?? '';
  document.getElementById('edit-product-sp-p').value         = p.sp_p      ?? '';
  document.getElementById('edit-product-sp-np').value        = p.sp_np     ?? '';
  document.getElementById('edit-product-shelf-life').value   = p.shelf_life ?? '';

  editProductModal.open();
});

const editProductModal = new Modal('editProductModal');




//Sending Update... based on the old one
document.getElementById('editProductForm').addEventListener('submit', function (e) {
  e.preventDefault();
  let productId   = document.getElementById('edit-product-id').value;
  let code        = document.getElementById('edit-product-code');
  let description = document.getElementById('edit-product-description');
  let category    = document.getElementById('edit-product-category');

  // Validation
  if (!code.value.trim()) {
    editProductModal.shakeElement(code);
    toast.error('Please enter a product code!');
    return;
  }
  if (!description.value.trim()) {
    editProductModal.shakeElement(description);
    toast.error('Please enter a description!');
    return;
  }
  if (!category.value.trim()) {
    editProductModal.shakeElement(category);
    toast.error('Please enter a category!');
    return;
  }

  let data = {
    code:        code.value.trim(),
    description: description.value.trim(),
    category:    category.value.trim(),
    sub_category:document.getElementById('edit-product-sub-category').value.trim(),
    tp:          parseFloat(document.getElementById('edit-product-tp').value)    || 0,
    sp_p:        parseFloat(document.getElementById('edit-product-sp-p').value)  || 0,
    sp_np:       parseFloat(document.getElementById('edit-product-sp-np').value) || 0,
    shelf_life:  document.getElementById('edit-product-shelf-life').value.trim(),
  };
	
	createDialogue("wait","Performing Action");	
	
	
  fetch(`/apis/update_product_master/${productId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
    .then(r => r.json())
    .then(result => {
      if (result.type === 'success') {
        toast.success('Product updated successfully!');
        editProductModal.close();
        loadAllItems();
		destroy_dia();
      } else {
        toast.error('Error: ' + (result.message || 'Failed to update product.'));
      }
    })
    .catch(() => toast.error('Error updating product. Please try again.'));
});




function loadItemToModal(elm){
	
	let itemId = elm.getAttribute("item_id");
	console.log(itemId);
	
	openProductPriceHistoryModal(itemId);
	
}



let openProductPriceHistoryModal = function(productId) {
    let modal = document.getElementById('productPriceHistoryModal');
    let backdrop = modal.querySelector('[data-modal-backdrop]');
    let content = modal.querySelector('[data-modal-content]');

    // Reset state
    document.getElementById('pph-product-code').textContent = '';
    document.getElementById('pph-product-description').textContent = '';
    document.getElementById('pph-current-tp').textContent = '—';
    document.getElementById('pph-current-sp-p').textContent = '—';
    document.getElementById('pph-current-sp-np').textContent = '—';
    document.getElementById('pph-total-changes').textContent = '—';
    document.getElementById('pph-chart-canvas').classList.add('hidden');
    document.getElementById('pph-chart-placeholder').classList.remove('hidden');

    // Show modal
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        backdrop.classList.add('opacity-100');
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });

		// Fetch data
		qBuilder.sendQuery(
			onPriceHistoryLoaded,
			productHistoryURL,
			[{ name: 'product_id', 'value': productId }],
			function(err) { console.error('Price history request failed', err); }
		);

		function onPriceHistoryLoaded(data) {
			let res_data = (JSON.parse(data.responseText));
			
			let product = res_data.product;
			let stats = res_data.stats_data;
			console.log(res_data);
			
			if(stats.length <= 0){
				return toast.info("There was no history yet!");
			}
			

			// Populate header
			document.getElementById('pph-product-code').textContent = product.code;
			document.getElementById('pph-product-description').textContent = product.description;

			// Populate pills
			document.getElementById('pph-current-tp').textContent = '₱' + product.tp.toFixed(2);
			document.getElementById('pph-current-sp-p').textContent = '₱' + product.sp_p.toFixed(2);
			document.getElementById('pph-current-sp-np').textContent = '₱' + product.sp_np.toFixed(2);
			document.getElementById('pph-total-changes').textContent = stats.length + ' change(s)';

			// Toggle canvas
			if (stats.length > 0) {
				document.getElementById('pph-chart-placeholder').classList.add('hidden');
				document.getElementById('pph-chart-canvas').classList.remove('hidden');
				// chart build goes here later
				
				let datasets = [
					{
						label: 'TP',
						data: stats.map(function(s) { return [s.date, s.tp]; })
					},
					{
						label: 'SP Premium',
						data: stats.map(function(s) { return [s.date, s.sp_p]; })
					},
					{
						label: 'SP Regular',
						data: stats.map(function(s) { return [s.date, s.sp_np]; })
					}
				];

				generateMultiLineChart(datasets, 'pph-chart-canvas', false);					
			}else{
					document.getElementById('pph-chart-canvas').classList.add('hidden');
			}
		}
		
		

    // Close handlers
    modal.querySelectorAll('[data-modal-close]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            backdrop.classList.remove('opacity-100');
            content.classList.add('scale-95', 'opacity-0');
            content.classList.remove('scale-100', 'opacity-100');
            setTimeout(function() { modal.classList.add('hidden'); }, 300);
        });
    });
};





let closeProductPriceHistoryModal = function() {
    let modal = document.getElementById('productPriceHistoryModal');
    let backdrop = modal.querySelector('[data-modal-backdrop]');
    let content = modal.querySelector('[data-modal-content]');

    backdrop.classList.remove('opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    content.classList.remove('scale-100', 'opacity-100');

    setTimeout(function() { modal.classList.add('hidden'); }, 300);
};


