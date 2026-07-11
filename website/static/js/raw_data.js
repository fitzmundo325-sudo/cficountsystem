// Toast notification function
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg text-white text-sm font-medium z-50 ${
    type === 'success' ? 'bg-emerald-600' : 
    type === 'error' ? 'bg-red-600' : 'bg-indigo-600'
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Tab functionality
const tabTitles = {
  'sales': 'Sales Data',
  'aggregators': 'Aggregators',
  'sbi': 'SBI',
  'cost': 'Cost Monitoring',
  'inventory': 'Inventory Monitoring'
};

const tabOrder = ['sales', 'aggregators', 'sbi', 'cost', 'inventory'];

// Get store info injected by template
const storeInfo = window.rawDataConfig || {
  name: 'All Stores',
  month: '',
  year: '',
  storeFilter: 'All Stores'
};

const editModeStorageKey = 'cluster_manager_edit_mode';
let isEditModeEnabled = false;
const nonEditableComputedFields = ['spoilage_percentage', 'total_discount', 'discount_percentage'];
const globalPencilIcon = `<svg class="edit-icon inline-block w-3.5 h-3.5 ml-1 text-indigo-500 opacity-0 transition-opacity cursor-pointer" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;

function getEditableFieldMapByTab(tabId) {
  if (tabId === 'sales') {
    return {
      1: { field: 'pos_gross_sales' },
      2: { field: 'ci_regular_gross_sales' },
      7: { field: 'pos_net_sales', field2: 'ci_regular_net_sales' },
      17: { field: 'pos_tc', field2: 'ci_tc' },
    };
  }
  if (tabId === 'aggregators') {
    return {
      1: { field: 'gds_sales' },
      2: { field: 'gds_tc' },
      3: { field: 'grab_sales' },
      4: { field: 'grab_tc' },
      5: { field: 'foodpanda_sales' },
      6: { field: 'foodpanda_tc' },
    };
  }
  if (tabId === 'sbi') {
    return {
      1: { field: 'boothselling_sales' },
      2: { field: 'boothselling_tc' },
      3: { field: 'bulk_order_sales' },
      4: { field: 'bulk_order_tc' },
      5: { field: 'reseller_sales' },
      6: { field: 'reseller_tc' },
      7: { field: 'tieup_sales' },
      8: { field: 'tieup_tc' },
      11: { field: 'ambulant_sales' },
      12: { field: 'ambulant_tc' },
    };
  }
  if (tabId === 'cost') {
    return {
      1: { field: 'spoilage_gc', field2: 'spoilage_rolls', field3: 'spoilage_premium', field4: 'spoilage_others' },
      3: { field: 'senior_pwd_discount' },
      4: { field: 'promo_ldts_discount' },
      5: { field: 'bulk_orders_discount' },
    };
  }
  if (tabId === 'inventory') {
    return {
      7: { field: 'ending_inv_gc' },
      8: { field: 'ending_inv_rolls' },
      9: { field: 'ending_inv_premium' },
    };
  }
  return {};
}

function normalizeEditableRows(root) {
  const tabContents = root.querySelectorAll('.tab-content[id^="content-"]');
  tabContents.forEach((tabContent) => {
    const tabId = tabContent.id.replace('content-', '');
    const mapByIndex = getEditableFieldMapByTab(tabId);
    if (!Object.keys(mapByIndex).length) {
      return;
    }
    tabContent.querySelectorAll('tbody tr.report-row[data-report-id]').forEach((row) => {
      const cells = row.querySelectorAll('td');
      Object.entries(mapByIndex).forEach(([indexKey, def]) => {
        const cell = cells[parseInt(indexKey, 10)];
        if (!cell) {
          return;
        }
        cell.classList.add('editable-cell');
        cell.dataset.field = def.field;
        if (def.field2) cell.dataset.field2 = def.field2;
        if (def.field3) cell.dataset.field3 = def.field3;
        if (def.field4) cell.dataset.field4 = def.field4;
        cell.setAttribute('title', 'Click to edit');
      });
    });
  });
}

function updateEditModeUI() {
  const toggleButton = document.getElementById('edit-mode-toggle');
  const toggleCircle = document.getElementById('edit-mode-toggle-circle');
  const toggleStatus = document.getElementById('edit-mode-toggle-label');

  if (!toggleButton || !toggleCircle || !toggleStatus) {
    return;
  }

  toggleButton.setAttribute('aria-pressed', isEditModeEnabled ? 'true' : 'false');
  if (isEditModeEnabled) {
    toggleButton.classList.remove('bg-slate-300');
    toggleButton.classList.add('bg-indigo-600');
    toggleCircle.classList.remove('translate-x-1');
    toggleCircle.classList.add('translate-x-6');
    toggleStatus.textContent = 'ON';
    toggleStatus.classList.remove('text-slate-500');
    toggleStatus.classList.add('text-indigo-600');
  } else {
    toggleButton.classList.remove('bg-indigo-600');
    toggleButton.classList.add('bg-slate-300');
    toggleCircle.classList.remove('translate-x-6');
    toggleCircle.classList.add('translate-x-1');
    toggleStatus.textContent = 'OFF';
    toggleStatus.classList.remove('text-indigo-600');
    toggleStatus.classList.add('text-slate-500');
  }
}

function setEditModeState(enabled) {
  isEditModeEnabled = !!enabled;
  localStorage.setItem(editModeStorageKey, isEditModeEnabled ? 'true' : 'false');
  updateEditModeUI();
  if (!isEditModeEnabled) {
    document.querySelectorAll('.edit-icon').forEach((icon) => icon.classList.add('opacity-0'));
  }
}

function toggleEditModeState() {
  setEditModeState(!isEditModeEnabled);
}

function updateFullscreenContent(tabId) {
  const modalContent = document.getElementById('modal-content');
  const activeContent = document.getElementById('content-' + tabId);
  
  // Save current fullscreen tab to localStorage
  const modal = document.getElementById('fullscreen-modal');
  const isFullscreen = !modal.classList.contains('hidden');
  if (isFullscreen) {
    localStorage.setItem('fullscreenTab', tabId);
  }
  
  // Add fade out animation
  modalContent.style.opacity = '0';
  modalContent.style.transform = 'translateY(-10px)';
  
  setTimeout(() => {
    // Update title
    document.getElementById('fullscreen-title').textContent = tabTitles[tabId];
    
    // Update subtitle with store info + store filter
    const subtitle = storeInfo.storeFilter + ' - ' + storeInfo.name + ' - ' + storeInfo.month + '/' + storeInfo.year;
    document.getElementById('fullscreen-subtitle').textContent = subtitle;
    
    // Clone table content
    const tableContainer = activeContent.querySelector('.overflow-x-auto');
    const table = tableContainer.querySelector('table');
    
    modalContent.innerHTML = '';
    const clonedTable = table.cloneNode(true);
    modalContent.appendChild(clonedTable);
    
    normalizeEditableRows(modalContent);
    setupEditableCells(modalContent);
    
    // Add fade in animation
    modalContent.style.opacity = '1';
    modalContent.style.transform = 'translateY(0)';
  }, 150);
}

function navigateTab(direction) {
  // Get current active tab
  const activeTab = document.querySelector('.tab-button.border-indigo-600');
  const currentTabId = activeTab.id.replace('tab-', '');
  const currentIndex = tabOrder.indexOf(currentTabId);
  
  let newIndex;
  if (direction === 'next') {
    // Go to next tab, loop to first if at end
    newIndex = (currentIndex + 1) % tabOrder.length;
  } else {
    // Go to previous tab, loop to last if at beginning
    newIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
  }
  
  const newTabId = tabOrder[newIndex];
  
  // Check if we're in fullscreen mode
  const modal = document.getElementById('fullscreen-modal');
  const isFullscreen = !modal.classList.contains('hidden');
  
  if (isFullscreen) {
    // Switch tab and update fullscreen content with animation
    switchTab(newTabId);
    updateFullscreenContent(newTabId);
  } else {
    // Just switch tab normally
    switchTab(newTabId);
  }
}

function toggleFullscreen() {
  const modal = document.getElementById('fullscreen-modal');
  const isHidden = modal.classList.contains('hidden');
  
  if (isHidden) {
    // Get current active tab
    const activeTab = document.querySelector('.tab-button.border-indigo-600');
    const activeTabId = activeTab.id.replace('tab-', '');
    
    // Update fullscreen content
    updateFullscreenContent(activeTabId);
    
    // Show modal
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    // Save fullscreen state to localStorage
    localStorage.setItem('isFullscreen', 'true');
    localStorage.setItem('fullscreenTab', activeTabId);
  } else {
    // Exit fullscreen
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    
    // Remove fullscreen state from localStorage
    localStorage.removeItem('isFullscreen');
    localStorage.removeItem('fullscreenTab');
  }
}

function switchTab(tabName) {
  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.add('hidden');
  });
  
  // Remove active styles from all tabs
  document.querySelectorAll('.tab-button').forEach(button => {
    button.classList.remove('border-indigo-600', 'text-indigo-600');
    button.classList.add('border-transparent', 'text-slate-600');
  });
  
  // Show selected tab content
  document.getElementById('content-' + tabName).classList.remove('hidden');
  
  // Add active styles to selected tab
  const activeTab = document.getElementById('tab-' + tabName);
  activeTab.classList.remove('border-transparent', 'text-slate-600');
  activeTab.classList.add('border-indigo-600', 'text-indigo-600');
  
  // Save current tab to localStorage
  localStorage.setItem('lastActiveTab', tabName);
  
}

function setupEditableCells(root = document) {
  const editableCells = root.querySelectorAll('.editable-cell');
  editableCells.forEach((cell) => {
    const fieldName = cell.dataset.field;
    if (!fieldName) {
      return;
    }

    if (!cell.dataset.baseHtml) {
      cell.dataset.baseHtml = cell.innerHTML;
    }
    const isComputedField = nonEditableComputedFields.includes(fieldName);
    if (!cell.querySelector('.edit-icon') && !isComputedField) {
      cell.innerHTML = `${cell.dataset.baseHtml}${globalPencilIcon}`;
    }
    cell.style.cursor = isComputedField ? 'default' : 'pointer';

    if (cell.dataset.editListenersBound === '1') {
      return;
    }

    cell.addEventListener('mouseenter', function() {
      if (!isEditModeEnabled || isComputedField) {
        return;
      }
      const icon = this.querySelector('.edit-icon');
      if (icon) {
        icon.classList.remove('opacity-0');
      }
    });

    cell.addEventListener('mouseleave', function() {
      const icon = this.querySelector('.edit-icon');
      if (icon) {
        icon.classList.add('opacity-0');
      }
    });

    cell.addEventListener('click', function() {
      if (!isEditModeEnabled || isComputedField) {
        return;
      }
      if (typeof window.openEditModal !== 'undefined') {
        window.openEditModal(this);
      }
    });

    cell.dataset.editListenersBound = '1';
  });
}

// Editable cell functionality
document.addEventListener('DOMContentLoaded', function() {
  // Check for fullscreen state first to prevent flicker
  const isFullscreen = localStorage.getItem('isFullscreen');
  const fullscreenTab = localStorage.getItem('fullscreenTab');
  
  if (isFullscreen === 'true' && fullscreenTab && document.getElementById('tab-' + fullscreenTab)) {
    // Hide normal content temporarily to prevent flicker
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.style.opacity = '0';
    }
    
    // Switch to the fullscreen tab
    switchTab(fullscreenTab);
    
    // Enter fullscreen immediately
    const modal = document.getElementById('fullscreen-modal');
    if (modal) {
      // Update fullscreen content
      updateFullscreenContent(fullscreenTab);
      
      // Show modal
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
    
    // Restore normal content visibility after a short delay
    setTimeout(() => {
      if (mainContent) {
        mainContent.style.opacity = '1';
      }
    }, 50);
  } else {
    // Normal behavior - restore last active tab
    const lastActiveTab = localStorage.getItem('lastActiveTab');
    if (lastActiveTab && document.getElementById('tab-' + lastActiveTab)) {
      switchTab(lastActiveTab);
    }
  }
  
  const editModeToggle = document.getElementById('edit-mode-toggle');
  if (editModeToggle) {
    editModeToggle.addEventListener('click', toggleEditModeState);
  }

  normalizeEditableRows(document);
  setupEditableCells(document);
  setEditModeState(localStorage.getItem(editModeStorageKey) === 'true');

  const approveBtns = document.querySelectorAll('.approve-btn');
    
  // Handle approve button clicks
  approveBtns.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const dateCell = this.closest('.date-cell-pending');
      const reportId = dateCell.dataset.reportId;
      
      // Show confirmation modal
      showApproveConfirmation(reportId);
    });
  });

  function showApproveConfirmation(reportId) {
    const modalHTML = `
      <div id="approve-confirm-modal" class="fixed inset-0 z-[100] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
        <div class="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
          <div class="px-5 py-4 border-b border-slate-200">
            <h3 class="text-base font-bold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-emerald-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              Approve Report
            </h3>
          </div>
          <div class="px-5 py-4">
            <p class="text-sm text-slate-600 mb-3">Are you sure you want to approve this report?</p>
            <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <p class="text-xs text-emerald-700">This will change the status from <span class="font-semibold">Pending</span> to <span class="font-semibold">Approved</span>.</p>
            </div>
          </div>
          <div class="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
            <button id="cancel-approve-btn" class="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button id="confirm-approve-btn" class="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20">
              Approve
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modal = document.getElementById('approve-confirm-modal');
    const confirmBtn = modal.querySelector('#confirm-approve-btn');
    const cancelBtn = modal.querySelector('#cancel-approve-btn');
    const modalContent = modal.querySelector('.relative');

    // Add animation
    modalContent.style.transform = 'scale(0.95)';
    modalContent.style.opacity = '0';
    modalContent.style.transition = 'all 0.2s ease-out';
    setTimeout(() => {
      modalContent.style.transform = 'scale(1)';
      modalContent.style.opacity = '1';
      confirmBtn.focus();
    }, 10);

    function closeModal() {
      modalContent.style.transform = 'scale(0.95)';
      modalContent.style.opacity = '0';
      setTimeout(() => modal.remove(), 200);
    }

    confirmBtn.addEventListener('click', () => {
      closeModal();
      approveReport(reportId);
    });

    cancelBtn.addEventListener('click', closeModal);
    modal.querySelector('.absolute').addEventListener('click', closeModal);

    // ESC key to cancel, Enter key to confirm
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', keyHandler);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        closeModal();
        document.removeEventListener('keydown', keyHandler);
        approveReport(reportId);
      }
    };
    document.addEventListener('keydown', keyHandler);
  }

  function approveReport(reportId) {
    fetch('/cluster-manager/raw-data/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        report_id: reportId
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showToast('Report approved successfully', 'success');
        // Update the UI to show approved status
        const dateCell = document.querySelector(`[data-report-id="${reportId}"]`);
        if (dateCell) {
          dateCell.classList.remove('date-cell-pending', 'bg-yellow-100');
          dateCell.classList.add('date-cell-approved', 'bg-emerald-100');
          dateCell.innerHTML = `
            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
              <svg class="w-3 h-3 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              Approved
            </span>
          `;
        }
        // Recalculate totals
        setTimeout(() => {
          window.location.reload();
        }, 500);
      } else {
        showToast(data.error || 'Failed to approve report', 'error');
      }
    })
    .catch(error => {
      console.error('Error:', error);
      showToast('An error occurred while approving', 'error');
    });
  }

  window.openEditModal = function(cell) {
    if (!isEditModeEnabled) {
      return;
    }
    const fieldName = cell.dataset.field;
    const reportRow = cell.closest('.editable-row');
      
    if (!reportRow) {
      return;
    }
      
    const reportId = reportRow.dataset.reportId;
  
    // Get current value (remove currency symbol and pencil icon)
    let currentValue = cell.textContent.replace('₱', '').replace(/,/g, '').trim();
    if (currentValue === '' || isNaN(parseFloat(currentValue))) {
      currentValue = '0';
    }
  
    // Get related values for calculation
    let posGrossSales = 0;
    let ciGrossSales = 0;
    if (fieldName === 'pos_gross_sales' || fieldName === 'ci_regular_gross_sales') {
      const posCell = reportRow.querySelector('[data-field="pos_gross_sales"]');
      const ciCell = reportRow.querySelector('[data-field="ci_regular_gross_sales"]');
      if (posCell) posGrossSales = parseFloat(posCell.textContent.replace('₱', '').replace(/,/g, '').trim()) || 0;
      if (ciCell) ciGrossSales = parseFloat(ciCell.textContent.replace('₱', '').replace(/,/g, '').trim()) || 0;
    }
  
    window.showEditModal({
      reportId: reportId,
      fieldName: fieldName,
      currentValue: currentValue,
      cell: cell,
      reportRow: reportRow,
      posGrossSales: posGrossSales,
      ciGrossSales: ciGrossSales
    });
  }

  window.showEditModal = function(options) {
    const {
      reportId,
      fieldName,
      currentValue,
      cell,
      reportRow,
      posGrossSales,
      ciGrossSales
    } = options;
    
    // Remove existing modal
    const existingModal = document.getElementById('edit-value-modal');
    if (existingModal) existingModal.remove();

    const formattedFieldName = formatFieldName(fieldName);
    const isTcField = ['gds_tc', 'grab_tc', 'foodpanda_tc', 'boothselling_tc',
                       'bulk_order_tc', 'reseller_tc', 'tieup_tc', 'ambulant_tc',
                       'ending_inv_gc', 'ending_inv_rolls', 'ending_inv_premium'].includes(fieldName);
    
    const inputStep = isTcField ? '1' : '0.01';
    const inputType = 'number';
    
    // Check if this field affects Total Gross Sales
    const affectsTotalGross = (fieldName === 'pos_gross_sales' || fieldName === 'ci_regular_gross_sales');
    const calculationPreview = affectsTotalGross ? `
      <div id="calculation-preview" class="mt-4 p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-medium text-indigo-700 uppercase">Total Gross Sales Preview</span>
          <span id="preview-total" class="text-sm font-bold text-indigo-900">₱${(posGrossSales + ciGrossSales).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div class="text-xs text-indigo-600 space-y-1">
          <div class="flex justify-between">
            <span>Gross Sales:</span>
            <span id="preview-pos">₱${posGrossSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div class="flex justify-between">
            <span>C.I:</span>
            <span id="preview-ci">₱${ciGrossSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>
    ` : '';

    const modalHTML = `
      <div id="edit-value-modal" class="fixed inset-0 z-[200] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
        <div class="relative bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
          <div class="px-6 py-4 border-b border-slate-200">
            <h3 class="text-lg font-bold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              Edit ${formattedFieldName}
            </h3>
          </div>
          <div class="px-6 py-5">
            <label class="block text-sm font-medium text-slate-700 mb-2">Current Value</label>
            <input 
              type="${inputType}" 
              id="edit-input-field" 
              step="${inputStep}" 
              class="w-full px-4 py-3 text-lg font-semibold text-slate-900 bg-slate-50 border-2 border-slate-300 rounded-xl focus:border-indigo-500 focus:bg-white focus:outline-none transition-all" 
              value="${currentValue}"
            >
            <p class="mt-2 text-xs text-slate-500">Press Enter to save or Esc to cancel</p>
            ${calculationPreview}
          </div>
          <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
            <button id="cancel-edit-modal-btn" class="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button id="save-edit-modal-btn" class="px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/20">
              Save Changes
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modal = document.getElementById('edit-value-modal');
    const inputField = modal.querySelector('#edit-input-field');
    const saveBtn = modal.querySelector('#save-edit-modal-btn');
    const cancelBtn = modal.querySelector('#cancel-edit-modal-btn');

    // Add animation
    const modalContent = modal.querySelector('.relative');
    modalContent.style.transform = 'scale(0.95)';
    modalContent.style.opacity = '0';
    modalContent.style.transition = 'all 0.2s ease-out';
    setTimeout(() => {
      modalContent.style.transform = 'scale(1)';
      modalContent.style.opacity = '1';
      inputField.focus();
      inputField.select();
    }, 10);
    
    // Update calculation preview in real-time
    if (affectsTotalGross) {
      inputField.addEventListener('input', function() {
        const newValue = parseFloat(this.value) || 0;
        let newPosGross = posGrossSales;
        let newCiGross = ciGrossSales;
        
        if (fieldName === 'pos_gross_sales') {
          newPosGross = newValue;
        } else if (fieldName === 'ci_regular_gross_sales') {
          newCiGross = newValue;
        }
        
        const newTotal = newPosGross + newCiGross;
        
        document.getElementById('preview-total').textContent = 
          '₱' + newTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('preview-pos').textContent = 
          '₱' + newPosGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('preview-ci').textContent = 
          '₱' + newCiGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      });
    }

    // Save function
    function saveValue() {
      const newValue = inputField.value;
      if (newValue !== currentValue) {
        // Remove edit modal first
        modal.remove();
        // Then show confirmation modal
        setTimeout(() => {
          if (typeof window.showConfirmationModal !== 'undefined') {
            window.showConfirmationModal({
              oldValue: formatValue(parseFloat(currentValue), fieldName),
              newValue: formatValue(parseFloat(newValue), fieldName),
              fieldName: formattedFieldName,
              onConfirm: () => {
                if (typeof window.saveEdit !== 'undefined') {
                  window.saveEdit(reportId, fieldName, newValue, cell);
                }
              },
              onCancel: () => {}
            });
          } else {
            // Fallback: directly save without confirmation
            if (typeof window.saveEdit !== 'undefined') {
              window.saveEdit(reportId, fieldName, newValue, cell);
            }
          }
        }, 50);
      } else {
        modal.remove();
      }
    }

    // Cancel function
    function closeModal() {
      modalContent.style.transform = 'scale(0.95)';
      modalContent.style.opacity = '0';
      setTimeout(() => {
        modal.remove();
      }, 200);
    }

    // Event listeners
    saveBtn.addEventListener('click', function() {
      saveValue();
    });
    
    cancelBtn.addEventListener('click', function() {
      closeModal();
    });

    // Enter to save, Esc to cancel
    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveValue();
      } else if (e.key === 'Escape') {
        closeModal();
      }
    });

    // Close on backdrop click
    const backdrop = modal.querySelector('.absolute');
    if (backdrop) {
      backdrop.addEventListener('click', function() {
        closeModal();
      });
    }
  }

  window.showConfirmationModal = function(options) {
    const {
      oldValue = '',
      newValue = '',
      fieldName = 'this value',
      onConfirm,
      onCancel
    } = options;

    // Remove existing modal
    const existingModal = document.getElementById('edit-confirm-modal');
    if (existingModal) existingModal.remove();

    const modalHTML = `
      <div id="edit-confirm-modal" class="fixed inset-0 z-[100] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
        <div class="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
          <div class="px-5 py-4 border-b border-slate-200">
            <h3 class="text-base font-bold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              Confirm Changes
            </h3>
          </div>
          <div class="px-5 py-4">
            <p class="text-sm text-slate-600 mb-4">Are you sure you want to save changes to <span class="font-medium text-slate-900">${fieldName}</span>?</p>
            <div class="bg-slate-50 rounded-xl p-4 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-slate-500 uppercase">Old Value</span>
                <span class="text-sm font-semibold text-slate-700">${oldValue || '-'}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-emerald-600 uppercase">New Value</span>
                <span class="text-sm font-bold text-emerald-600">${newValue}</span>
              </div>
            </div>
          </div>
          <div class="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
            <button id="cancel-confirm-btn" class="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button id="confirm-save-btn" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/20">
              Save Changes
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modal = document.getElementById('edit-confirm-modal');
    const confirmBtn = modal.querySelector('#confirm-save-btn');
    const cancelBtn = modal.querySelector('#cancel-confirm-btn');

    // Add animation
    const modalContent = modal.querySelector('.relative');
    modalContent.style.transform = 'scale(0.95)';
    modalContent.style.opacity = '0';
    modalContent.style.transition = 'all 0.2s ease-out';
    setTimeout(() => {
      modalContent.style.transform = 'scale(1)';
      modalContent.style.opacity = '1';
    }, 10);

    confirmBtn.addEventListener('click', () => {
      modal.remove();
      if (onConfirm) onConfirm();
    });

    cancelBtn.addEventListener('click', () => {
      modal.remove();
      if (onCancel) onCancel();
    });

    // Close on backdrop click
    modal.querySelector('.absolute').addEventListener('click', () => {
      modal.remove();
      if (onCancel) onCancel();
    });

    // ESC key to cancel, Enter key to confirm
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', keyHandler);
        if (onCancel) onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        modal.remove();
        document.removeEventListener('keydown', keyHandler);
        if (onConfirm) onConfirm();
      }
    };
    document.addEventListener('keydown', keyHandler);
    
    // Auto-focus the confirm button for better UX
    setTimeout(() => confirmBtn.focus(), 100);
  }

  function formatFieldName(fieldName) {
    return fieldName
      .replace(/_/g, ' ')
      .replace(/(\w+)/g, word => word.charAt(0).toUpperCase() + word.slice(1));
  }

  function formatValue(value, fieldName) {
    const tcFields = ['gds_tc', 'grab_tc', 'foodpanda_tc', 'boothselling_tc',
                      'bulk_order_tc', 'reseller_tc', 'tieup_tc', 'ambulant_tc', 'gow_tc', 'other_sbi_tc',
                      'ending_inv_gc', 'ending_inv_rolls', 'ending_inv_premium'];
    
    const percentageFields = ['vs_tgt', 'mtd_vs_tgt', 'mtd_vs_ly', 'ar', 'vs_ly', 'spoilage_percentage', 'discount_percentage'];
    
    if (tcFields.includes(fieldName)) {
      return parseInt(value).toLocaleString();
    } else if (percentageFields.includes(fieldName)) {
      return parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    }
    return '₱' + parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  window.saveEdit = function(reportId, fieldName, newValue, cell) {
    fetch('/cluster-manager/raw-data/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        report_id: reportId,
        field_name: fieldName,
        value: newValue
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // Update cell with new value
        const formattedValue = formatValue(parseFloat(newValue), fieldName);
        cell.innerHTML = formattedValue + globalPencilIcon;
        cell.querySelector('.edit-icon').classList.add('opacity-0');
        showToast('Value updated successfully', 'success');
        
        // Update totals after editing
        setTimeout(() => {
          window.location.reload();
        }, 500);
      } else {
        showToast(data.error || 'Failed to update value', 'error');
      }
    })
    .catch(error => {
      console.error('Error:', error);
      showToast('An error occurred while saving', 'error');
    });
  }
  
  // Totals and performance values now come from backend-rendered summary data.
});

