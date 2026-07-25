(function () {
  'use strict';

  const overlay = document.getElementById('spa-loading-overlay');
  const mainContent = document.getElementById('main-content');

  function showLoading() {
    if (overlay) overlay.classList.add('spa-visible');
  }

  function hideLoading() {
    if (overlay) overlay.classList.remove('spa-visible');
  }

  function updateSidebarActiveLink(targetUrl) {
    const targetPath = new URL(targetUrl, window.location.origin).pathname;
    document.querySelectorAll('nav a.nav-item[href]').forEach((link) => {
      const linkPath = new URL(link.href, window.location.origin).pathname;
      const isActive = (linkPath === targetPath) || (linkPath !== '/' && targetPath.startsWith(linkPath));
      if (isActive) {
        link.classList.add('bg-slate-800', 'text-white');
        link.classList.remove('hover:bg-slate-800', 'hover:text-white');
        const iconDiv = link.querySelector('.shrink-0');
        if (iconDiv) { iconDiv.classList.add('text-white'); iconDiv.classList.remove('text-slate-400'); }
      } else {
        link.classList.remove('bg-slate-800', 'text-white');
        link.classList.add('hover:bg-slate-800', 'hover:text-white');
        const iconDiv = link.querySelector('.shrink-0');
        if (iconDiv) { iconDiv.classList.remove('text-white'); iconDiv.classList.add('text-slate-400'); }
      }
    });
  }

  function navigateSpa(url, isPopState) {
    if (!mainContent) {
      if (!isPopState) window.location.href = url;
      return;
    }

    const fullUrl = new URL(url, window.location.origin).toString();
    showLoading();
    updateSidebarActiveLink(fullUrl);

    fetch(fullUrl)
      .then((res) => {
        if (!res.ok) throw new Error('Network error');
        return res.text();
      })
      .then((html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const newMain = doc.getElementById('main-content');
        const newTitle = doc.querySelector('title');

        if (newTitle) document.title = newTitle.textContent;

        if (newMain) {
          mainContent.innerHTML = newMain.innerHTML;
          if (!isPopState) window.history.pushState({}, '', fullUrl);

          // Re-execute scripts so standard event listeners set up
          Array.from(mainContent.querySelectorAll('script')).forEach((oldScript) => {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach((attr) => newScript.setAttribute(attr.name, attr.value));
            newScript.appendChild(document.createTextNode(oldScript.innerHTML));
            oldScript.parentNode.replaceChild(newScript, oldScript);
          });

          if (typeof window.reloadDashboard === 'function') window.reloadDashboard(false);

          window.scrollTo({ top: 0, behavior: 'instant' });
        } else {
          window.location.href = fullUrl;
        }
      })
      .catch(() => {
        window.location.href = fullUrl;
      })
      .finally(() => {
        hideLoading();
      });
  }

  window.navigateSpa = navigateSpa;

  // Intercept normal sidebar links
  document.addEventListener('click', function (e) {
    const link = e.target.closest('nav a.nav-item[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('/logout') || href.startsWith('javascript:')) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    e.preventDefault();
    navigateSpa(link.href, false);
  });

  // Browser back/forward
  window.addEventListener('popstate', function () {
    navigateSpa(window.location.href, true);
  });
})();
