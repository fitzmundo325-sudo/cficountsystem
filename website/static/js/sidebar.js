const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('main-content');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const toggleDesktop = document.getElementById('toggle-desktop');
const toggleMobile = document.getElementById('toggle-mobile');

// Load sidebar state from localStorage on page load
function loadSidebarState() {
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed && window.innerWidth >= 1024) {
        sidebar.classList.add('sidebar-collapsed');
        mainContent.style.marginLeft = '80px';
        toggleDesktop.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
    }
}

// Save sidebar state to localStorage
function saveSidebarState(isCollapsed) {
    localStorage.setItem('sidebarCollapsed', isCollapsed);
}

// Initialize sidebar state on page load
loadSidebarState();

// Toggle Desktop (Collapsed/Expanded)
toggleDesktop.addEventListener('click', () => {
    sidebar.classList.toggle('sidebar-collapsed');
    
    if (sidebar.classList.contains('sidebar-collapsed')) {
        mainContent.style.marginLeft = '80px';
        toggleDesktop.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
        saveSidebarState(true);
    } else {
        mainContent.style.marginLeft = '16rem'; 
        toggleDesktop.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
        saveSidebarState(false);
    }
});

// Toggle Mobile Drawer
toggleMobile.addEventListener('click', () => {
  sidebar.classList.remove('-translate-x-full');
  sidebarOverlay.classList.remove('hidden');
});

// Close Mobile Drawer
sidebarOverlay.addEventListener('click', () => {
  sidebar.classList.add('-translate-x-full');
  sidebarOverlay.classList.add('hidden');
});
    
// Auto-adjust margin on resize
window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
        sidebar.classList.remove('-translate-x-full');
        sidebarOverlay.classList.add('hidden');
        if (sidebar.classList.contains('sidebar-collapsed')) {
            mainContent.style.marginLeft = '80px';
        } else {
            mainContent.style.marginLeft = '16rem';
        }
    } else {
        mainContent.style.marginLeft = '0';
    }
});

// Dynamic tooltip positioning for collapsed sidebar
const navItems = document.querySelectorAll('.nav-item[data-tooltip]');

navItems.forEach(item => {
    item.addEventListener('mouseenter', function(e) {
        if (sidebar.classList.contains('sidebar-collapsed')) {
            const rect = this.getBoundingClientRect();
            const tooltip = window.getComputedStyle(this, '::after');
            const arrow = window.getComputedStyle(this, '::before');
            
            // Set CSS custom properties for positioning
            this.style.setProperty('--tooltip-top', `${rect.top + rect.height / 2}px`);
            this.style.setProperty('--tooltip-left', `${rect.right + 12}px`);
            this.style.setProperty('--arrow-top', `${rect.top + rect.height / 2}px`);
            this.style.setProperty('--arrow-left', `${rect.right + 6}px`);
        }
    });
});

// Stores submenu toggle
const storesMenuToggle = document.getElementById('stores-menu-toggle');
const storesSubmenu = document.getElementById('stores-submenu');
const storesChevron = document.getElementById('stores-chevron');

if (storesMenuToggle && storesSubmenu) {
    storesMenuToggle.addEventListener('click', () => {
        storesSubmenu.classList.toggle('hidden');
        storesChevron.classList.toggle('rotate-180');
    });
}

// TAF submenu toggle
const tafMenuToggle = document.getElementById('taf-menu-toggle');
const tafSubmenu = document.getElementById('taf-submenu');
const tafChevron = document.getElementById('taf-chevron');

if (tafMenuToggle && tafSubmenu) {
    tafMenuToggle.addEventListener('click', () => {
        tafSubmenu.classList.toggle('hidden');
        tafChevron.classList.toggle('rotate-180');
    });
}
