// ===================================================
// Sidebar collapse logic (desktop) + mobile open/close
// ===================================================


 (function () {
  let html = document.documentElement;

  // Top-bar toggle — mobile only (opens overlay)
  let inlineBtn = document.getElementById('sidebar-toggle-btn');
  let overlay   = document.getElementById('sidebar-overlay');
  if (inlineBtn) {
    inlineBtn.addEventListener('click', () => {
      if (window.innerWidth < 1024) {
        html.classList.toggle('sidebar-open');
      }
    });
  }

  // Close sidebar when overlay is clicked
  if (overlay) {
    overlay.addEventListener('click', () => {
      html.classList.remove('sidebar-open');
      overlay.classList.add('hidden');
    });
  }

  // Keep overlay visibility in sync with sidebar-open class
  let observer = new MutationObserver(() => {
    if (overlay) overlay.classList.toggle('hidden', !html.classList.contains('sidebar-open'));
  });
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
})();


// ===================================================
// Dark mode toggle =========================
// ===================================================


    (function () {
      let button = document.getElementById('admin-theme-toggle');
      if (!button) return;
      let themeColor = document.querySelector('meta[name="theme-color"]');

      function refresh() {
        let dark = document.documentElement.classList.contains('admin-dark');
        button.querySelector('[data-admin-theme-sun]').classList.toggle('hidden', dark);
        button.querySelector('[data-admin-theme-moon]').classList.toggle('hidden', !dark);
        button.querySelector('[data-admin-theme-label]').textContent = dark ? 'Light Theme' : 'Dark Theme';
        button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
        if (themeColor) themeColor.content = dark ? '#020617' : '#0f172a';
      }

      button.addEventListener('click', () => {
        let dark = document.documentElement.classList.toggle('admin-dark');
        try { localStorage.setItem('adminTheme', dark ? 'dark' : 'light'); } catch (e) {}
        refresh();
        if (document.querySelector('.admin-dashboard-surface canvas')) {
          setTimeout(() => window.location.reload(), 80);
        }
      });
      refresh();
    })();



// ===================================================
// Store type switch         =========================
// ===================================================

    (function () {
      let buttons = Array.from(document.querySelectorAll('.store-scope-btn'));
      if (!buttons.length) return;

      function updateStyles(activeScope) {
        buttons.forEach(btn => {
          let selected = (btn.getAttribute('data-scope') || 'official').toLowerCase() === activeScope;
          btn.classList.toggle('bg-indigo-500', selected);
          btn.classList.toggle('text-white', selected);
          btn.classList.toggle('text-slate-300', !selected);
          btn.classList.toggle('hover:bg-slate-800', !selected);
          btn.classList.toggle('hover:text-white', !selected);
        });
      }

      buttons.forEach(btn => {
        btn.addEventListener('click', function () {
          let scope = (this.getAttribute('data-scope') || 'official').toLowerCase();
          document.cookie = `store_scope=${encodeURIComponent(scope)}; path=/; max-age=${60*60*24*365}; samesite=lax`;
          updateStyles(scope);
          let url = new URL(window.location.href);
          if (url.searchParams.has('store_id')) {
            url.searchParams.delete('store_id');
            window.history.replaceState({}, '', url.toString());
          }
          if (typeof window.reloadDashboard === 'function') {
            window.reloadDashboard(true);
          } else {
            window.location.reload();
          }
        });
      });
    })();
	


// Extra Sidebar checks ===============

function isSidebarHidden() {
    let sidebar = document.getElementById('sidebar');
    if (!sidebar) return true;


    // Geometry-based check (thorough)
    let rect = sidebar.getBoundingClientRect();
    return rect.right <= 10;
}


if(isSidebarHidden()){
	_("general_container").style.marginLeft = "0px";
}
