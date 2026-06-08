/**
 * Reusable Toast Notification System
 * Displays flash messages with animations
 */

class Toast {
  constructor() {
    this.container = null;
    this.queue = [];
    this.isShowing = false;
    
    // Initialize container when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.container = this.createContainer();
      });
    } else {
      this.container = this.createContainer();
    }
  }

  createContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none';
      document.body.appendChild(container);
    }
    return container;
  }

  show(message, category = 'info', duration = 4000) {
    // Ensure container is created
    if (!this.container) {
      this.container = this.createContainer();
    }
    
    const toast = this.createToast(message, category);
    this.container.appendChild(toast);

    // Trigger animation
    setTimeout(() => {
      toast.classList.remove('translate-x-full', 'opacity-0');
      toast.classList.add('translate-x-0', 'opacity-100');
    }, 10);

    // Auto dismiss
    const timeoutId = setTimeout(() => {
      this.dismiss(toast);
    }, duration);

    // Manual dismiss
    const closeBtn = toast.querySelector('[data-toast-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        clearTimeout(timeoutId);
        this.dismiss(toast);
      });
    }

    return toast;
  }

  createToast(message, category) {
    const toast = document.createElement('div');
    toast.className = `toast-item pointer-events-auto transform transition-all duration-300 ease-out translate-x-full opacity-0 flex items-start gap-3 p-4 rounded-xl shadow-lg backdrop-blur-sm max-w-md ${this.getCategoryStyles(category)}`;
    
    const config = this.getCategoryConfig(category);
    
    toast.innerHTML = `
      <!-- Icon -->
      <div class="shrink-0 mt-0.5">
        ${config.icon}
      </div>
      
      <!-- Content -->
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold ${config.titleColor}">${config.title}</p>
        <p class="text-sm ${config.messageColor} mt-0.5">${message}</p>
      </div>
      
      <!-- Close Button -->
      <button data-toast-close class="shrink-0 p-1 rounded-lg hover:bg-black/5 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${config.closeColor}">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    `;
    
    return toast;
  }

  getCategoryStyles(category) {
    const styles = {
      success: 'bg-emerald-50 border border-emerald-200',
      error: 'bg-red-50 border border-red-200',
      warning: 'bg-amber-50 border border-amber-200',
      info: 'bg-blue-50 border border-blue-200'
    };
    return styles[category] || styles.info;
  }

  getCategoryConfig(category) {
    const configs = {
      success: {
        title: 'Success',
        titleColor: 'text-emerald-900',
        messageColor: 'text-emerald-700',
        closeColor: 'text-emerald-600',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-600">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>`
      },
      error: {
        title: 'Error',
        titleColor: 'text-red-900',
        messageColor: 'text-red-700',
        closeColor: 'text-red-600',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-600">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" x2="9" y1="9" y2="15"/>
          <line x1="9" x2="15" y1="9" y2="15"/>
        </svg>`
      },
      warning: {
        title: 'Warning',
        titleColor: 'text-amber-900',
        messageColor: 'text-amber-700',
        closeColor: 'text-amber-600',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-600">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
          <line x1="12" x2="12" y1="9" y2="13"/>
          <line x1="12" x2="12.01" y1="17" y2="17"/>
        </svg>`
      },
      info: {
        title: 'Info',
        titleColor: 'text-blue-900',
        messageColor: 'text-blue-700',
        closeColor: 'text-blue-600',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-600">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" x2="12" y1="16" y2="12"/>
          <line x1="12" x2="12.01" y1="8" y2="8"/>
        </svg>`
      }
    };
    return configs[category] || configs.info;
  }

  dismiss(toast) {
    toast.classList.remove('translate-x-0', 'opacity-100');
    toast.classList.add('translate-x-full', 'opacity-0');
    
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  // Convenience methods
  success(message, duration) {
    return this.show(message, 'success', duration);
  }

  error(message, duration) {
    return this.show(message, 'error', duration);
  }

  warning(message, duration) {
    return this.show(message, 'warning', duration);
  }

  info(message, duration) {
    return this.show(message, 'info', duration);
  }

  // Clear all toasts
  clearAll() {
    const toasts = this.container.querySelectorAll('.toast-item');
    toasts.forEach(toast => this.dismiss(toast));
  }
}

// Create global instance
window.toast = window.toast || new Toast();
var toast = window.toast;

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Toast;
}
