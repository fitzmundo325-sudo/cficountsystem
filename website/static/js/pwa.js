(function () {
  let deferredInstallPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function getButtons() {
    return Array.from(document.querySelectorAll('.pwa-install-btn'));
  }

  function setButtonState() {
    const installed = isStandalone();
    getButtons().forEach((button) => {
      button.classList.toggle('hidden', installed);
      button.disabled = installed;
      button.setAttribute('aria-disabled', installed ? 'true' : 'false');
    });
  }

  function showInstallHelp() {
    const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent || '');
    const message = isApple && isSafari
      ? 'To install on Mac Safari, open File > Add to Dock. On iPhone or iPad, use Share > Add to Home Screen.'
      : 'Use your browser menu and choose Install iDashboard or Add to desktop.';

    if (window.toast && typeof window.toast.show === 'function') {
      window.toast.show(message, 'info', 7000);
      return;
    }

    window.alert(message);
  }

  async function installApp() {
    if (!deferredInstallPrompt) {
      showInstallHelp();
      return;
    }

    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    setButtonState();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    setButtonState();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setButtonState();
    if (window.toast && typeof window.toast.show === 'function') {
      window.toast.show('iDashboard installed successfully.', 'success');
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    setButtonState();
    getButtons().forEach((button) => {
      button.addEventListener('click', installApp);
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        if (window.toast && typeof window.toast.show === 'function') {
          window.toast.show('Install support is not available in this browser session.', 'warning');
        }
      });
    }
  });
})();
