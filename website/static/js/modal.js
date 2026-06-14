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
 * @param {string} options.variant - Optional visual variant
 * @param {Function} options.onConfirm - Callback when confirmed
 * @param {Function} options.onCancel - Callback when cancelled
 */
function showConfirmationModal(options) {
  const {
    title = 'Confirm Changes',
    message = 'Are you sure you want to continue?',
    messageHtml = '',
    modalWidth = '390px',
    oldValue,
    newValue,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = '',
    onConfirm,
    onCancel
  } = options;
  const hasCustomBody = Boolean(String(messageHtml || '').trim());
  const hasValueComparison = Boolean(oldValue && newValue);
  const isInvenSyncVariant = variant === 'invensync';
  const defaultBodyHtml = `
    <div class="flex flex-col items-center text-center">
      <div class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h13"></path>
          <path d="m13 6 6 6-6 6"></path>
          <path d="M5 6v12"></path>
        </svg>
      </div>
      <h3 class="text-xl font-bold text-slate-900">${title}</h3>
      <p class="mt-2 text-sm leading-6 text-slate-600">${message}</p>
    </div>
  `;
  const standardModalInnerHtml = `
    <!-- Body -->
    <div class="px-6 pt-8 pb-6">
      ${hasCustomBody
        ? `
          <div class="flex flex-col items-center text-center">
            <div class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h13"></path>
                <path d="m13 6 6 6-6 6"></path>
                <path d="M5 6v12"></path>
              </svg>
            </div>
            <h3 class="text-xl font-bold text-slate-900">${title}</h3>
          </div>
          <div class="mt-4 text-sm text-slate-700" style="max-height:55vh;overflow-y:auto;">${messageHtml}</div>
        `
        : defaultBodyHtml
      }

      ${hasValueComparison ? `
      <div class="mt-5 bg-slate-50 rounded-lg p-3 space-y-2">
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
    <div class="px-6 py-4 border-t border-slate-200 grid grid-cols-2 gap-3">
      <button data-modal-cancel class="h-11 px-4 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
        ${cancelText}
      </button>
      <button data-modal-confirm class="h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-lg shadow-indigo-600/25">
        ${confirmText}
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14"></path>
          <path d="m13 5 7 7-7 7"></path>
        </svg>
      </button>
    </div>
  `;
  const invensyncModalInnerHtml = `
    <div class="bg-slate-900 px-6 py-5 flex items-center gap-4">
      <div class="flex-shrink-0 w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-white">
        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5"></path>
        </svg>
      </div>
      <div>
        <h3 class="text-white font-bold text-lg leading-tight">${title}</h3>
        <p class="text-slate-400 text-xs mt-0.5">Review before continuing</p>
      </div>
    </div>
    <div class="px-6 py-5 space-y-4">
      <div class="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-500 flex-shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 16v-4"></path>
          <path d="M12 8h.01"></path>
        </svg>
        <p class="text-sm leading-6 text-slate-700">${message}</p>
      </div>
      <p class="text-xs leading-5 text-slate-500">This action locks the beginning quantity column after saving.</p>
    </div>
    <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 grid grid-cols-2 gap-3">
      <button data-modal-cancel class="h-11 px-4 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors">
        ${cancelText}
      </button>
      <button data-modal-confirm class="h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors shadow-sm">
        ${confirmText}
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14"></path>
          <path d="m13 5 7 7-7 7"></path>
        </svg>
      </button>
    </div>
  `;

  // Remove existing confirmation modal if any
  const existingModal = document.getElementById('confirmation-modal');
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal HTML
  const modalHTML = `
    <div id="confirmation-modal" class="fixed inset-0 z-[1000] flex items-center justify-center hidden px-4">
      <!-- Backdrop -->
      <div data-modal-backdrop class="absolute inset-0 bg-black/60 backdrop-blur-[1px] opacity-0 transition-opacity duration-300"></div>
      
      <!-- Modal Content -->
      <div data-modal-content class="relative bg-white ${isInvenSyncVariant ? 'rounded-2xl' : 'rounded-xl'} shadow-2xl w-full scale-95 opacity-0 transition-all duration-300 overflow-hidden" style="max-width: ${modalWidth};">
        ${isInvenSyncVariant ? invensyncModalInnerHtml : standardModalInnerHtml}
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
