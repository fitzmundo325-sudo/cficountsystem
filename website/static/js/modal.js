/**
 * Reusable Modal Component
 * Creates and manages modal dialogs with animations
 */

class Modal {
  constructor(modalId) {
    this.modal = document.getElementById(modalId);
    if (!this.modal) {
      console.error(`Modal with id "${modalId}" not found`);
      return;
    }
    
    this.backdrop = this.modal.querySelector('[data-modal-backdrop]');
    this.content = this.modal.querySelector('[data-modal-content]');
    this.closeButtons = this.modal.querySelectorAll('[data-modal-close]');
    this.form = this.modal.querySelector('form');
    
    this.init();
  }
  
  init() {
    // Add close event listeners to all close buttons
    this.closeButtons.forEach(btn => {
      btn.addEventListener('click', () => this.close());
    });
    
    // Close on backdrop click
    if (this.backdrop) {
      this.backdrop.addEventListener('click', () => this.close());
    }
    
    // Close on ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        this.close();
      }
    });
    
    // Add input focus animations if form exists
    if (this.form) {
      this.addInputAnimations();
    }
  }
  
  open() {
    this.modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    // Trigger animation
    setTimeout(() => {
      if (this.backdrop) {
        this.backdrop.classList.remove('opacity-0');
        this.backdrop.classList.add('opacity-100');
      }
      if (this.content) {
        this.content.classList.remove('scale-95', 'opacity-0');
        this.content.classList.add('scale-100', 'opacity-100');
      }
    }, 10);
  }
  
  close() {
    if (this.backdrop) {
      this.backdrop.classList.remove('opacity-100');
      this.backdrop.classList.add('opacity-0');
    }
    if (this.content) {
      this.content.classList.remove('scale-100', 'opacity-100');
      this.content.classList.add('scale-95', 'opacity-0');
    }
    
    setTimeout(() => {
      this.modal.classList.add('hidden');
      document.body.style.overflow = 'auto';
      if (this.form) {
        this.form.reset();
      }
    }, 300);
  }
  
  addInputAnimations() {
    const inputs = this.form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      input.addEventListener('focus', function() {
        this.parentElement.classList.add('scale-[1.02]');
        this.parentElement.style.transition = 'transform 0.2s ease';
      });
      
      input.addEventListener('blur', function() {
        this.parentElement.classList.remove('scale-[1.02]');
      });
    });
  }
  
  shakeElement(element) {
    element.classList.add('animate-shake');
    element.style.borderColor = '#ef4444';
    setTimeout(() => {
      element.classList.remove('animate-shake');
      element.style.borderColor = '';
    }, 500);
  }
  
  showError(message) {
    // You can customize this to show error messages in a better way
    alert(message);
  }
  
  showSuccess(message) {
    // You can customize this to show success messages in a better way
    alert(message);
  }
}

/**
 * Create a confirmation modal dynamically
 * @param {Object} options - Configuration options
 * @param {string} options.title - Modal title
 * @param {string} options.message - Modal message
 * @param {string} options.messageHtml - Optional rich HTML body (overrides message)
 * @param {string} options.modalWidth - Optional max-width (e.g. "760px")
 * @param {string} options.oldValue - Old value to display
 * @param {string} options.newValue - New value to display
 * @param {string} options.confirmText - Confirm button label
 * @param {string} options.cancelText - Cancel button label
 * @param {Function} options.onConfirm - Callback when confirmed
 * @param {Function} options.onCancel - Callback when cancelled
 */
function showConfirmationModal(options) {
  const {
    title = 'Confirm Changes',
    message = 'Are you sure you want to continue?',
    messageHtml = '',
    modalWidth = '360px',
    oldValue,
    newValue,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel
  } = options;
  const hasCustomBody = Boolean(String(messageHtml || '').trim());
  const hasValueComparison = Boolean(oldValue && newValue);
  const defaultBodyHtml = `
    <div class="flex flex-col items-center text-center py-1">
      <div class="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 9v4"></path>
          <path d="M12 17h.01"></path>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        </svg>
      </div>
      <p class="text-base font-semibold text-slate-900">${message}</p>
    </div>
  `;

  // Remove existing confirmation modal if any
  const existingModal = document.getElementById('confirmation-modal');
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal HTML
  const modalHTML = `
    <div id="confirmation-modal" class="fixed inset-0 z-50 flex items-center justify-center hidden">
      <!-- Backdrop -->
      <div data-modal-backdrop class="absolute inset-0 bg-black/50 opacity-0 transition-opacity duration-300"></div>
      
      <!-- Modal Content -->
      <div data-modal-content class="relative bg-white rounded-2xl shadow-2xl w-full mx-4 scale-95 opacity-0 transition-all duration-300" style="max-width: ${modalWidth};">
        <!-- Header -->
        <div class="px-5 py-3 border-b border-slate-200">
          <h3 class="text-base font-bold text-slate-900">${title}</h3>
        </div>
        
        <!-- Body -->
        <div class="px-5 py-3">
          ${hasCustomBody
            ? `<div class="text-sm text-slate-700 mb-3" style="max-height:55vh;overflow-y:auto;">${messageHtml}</div>`
            : `<div class="mb-3">${defaultBodyHtml}</div>`
          }
          
          ${hasValueComparison ? `
          <div class="bg-slate-50 rounded-lg p-3 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-slate-500 uppercase">Old Value</span>
              <span class="text-sm font-semibold text-slate-700">${oldValue}</span>
            </div>
            <div class="border-t border-slate-200"></div>
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-indigo-600 uppercase">New Value</span>
              <span class="text-sm font-bold text-indigo-600">${newValue}</span>
            </div>
          </div>
          ` : ''}
        </div>
        
        <!-- Footer -->
        <div class="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button data-modal-cancel class="px-3 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
            ${cancelText}
          </button>
          <button data-modal-confirm class="px-3 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-lg shadow-indigo-600/20">
            ${confirmText}
          </button>
        </div>
      </div>
    </div>
  `;

  // Insert modal into body
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Get modal elements
  const modal = document.getElementById('confirmation-modal');
  const backdrop = modal.querySelector('[data-modal-backdrop]');
  const content = modal.querySelector('[data-modal-content]');
  const confirmBtn = modal.querySelector('[data-modal-confirm]');
  const cancelBtn = modal.querySelector('[data-modal-cancel]');

  // Function to close modal
  function closeModal() {
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    
    setTimeout(() => {
      modal.remove();
      document.body.style.overflow = 'auto';
    }, 300);
  }

  // Open modal with animation
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  
  setTimeout(() => {
    backdrop.classList.remove('opacity-0');
    backdrop.classList.add('opacity-100');
    content.classList.remove('scale-95', 'opacity-0');
    content.classList.add('scale-100', 'opacity-100');
  }, 10);

  // Event listeners
  confirmBtn.addEventListener('click', () => {
    closeModal();
    if (onConfirm) onConfirm();
  });

  cancelBtn.addEventListener('click', () => {
    closeModal();
    if (onCancel) onCancel();
  });

  backdrop.addEventListener('click', () => {
    closeModal();
    if (onCancel) onCancel();
  });

  // ESC key to close
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      if (onCancel) onCancel();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Modal;
}
