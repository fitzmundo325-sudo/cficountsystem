const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('main-content');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const toggleDesktop = document.getElementById('toggle-desktop');
const toggleMobile = document.getElementById('toggle-mobile');
const sidebarNav = sidebar ? sidebar.querySelector('nav.custom-scrollbar') : null;
let sidebarScrollHideTimer;
let sidebarScrollbarThumb = null;

function ensureSidebarScrollbarThumb() {
    if (!sidebar || sidebarScrollbarThumb) return sidebarScrollbarThumb;
    sidebarScrollbarThumb = document.createElement('div');
    sidebarScrollbarThumb.className = 'sidebar-scrollbar-thumb';
    sidebar.appendChild(sidebarScrollbarThumb);
    return sidebarScrollbarThumb;
}

function updateSidebarScrollbar(showThumb = false) {
    if (!sidebar || !sidebarNav) return;
    const thumb = ensureSidebarScrollbarThumb();
    if (!thumb) return;

    const scrollHeight = sidebarNav.scrollHeight;
    const viewHeight = sidebarNav.clientHeight;
    if (scrollHeight <= viewHeight + 1) {
        thumb.classList.remove('is-visible');
        return;
    }

    const sidebarRect = sidebar.getBoundingClientRect();
    const navRect = sidebarNav.getBoundingClientRect();
    const trackTop = navRect.top - sidebarRect.top;
    const trackHeight = navRect.height;
    const thumbHeight = Math.max(32, Math.round((viewHeight / scrollHeight) * trackHeight));
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const scrollRatio = sidebarNav.scrollTop / Math.max(1, scrollHeight - viewHeight);
    const thumbTop = trackTop + Math.round(scrollRatio * maxThumbTop);

    thumb.style.top = `${thumbTop}px`;
    thumb.style.height = `${thumbHeight}px`;

    if (showThumb) {
        thumb.classList.add('is-visible');
        clearTimeout(sidebarScrollHideTimer);
        sidebarScrollHideTimer = setTimeout(function() {
            thumb.classList.remove('is-visible');
        }, 1600);
    }
}

function restoreSidebarScroll() {
    if (!sidebarNav) return;
    const savedScroll = parseInt(localStorage.getItem('sidebarScrollTop'), 10);
    if (!Number.isNaN(savedScroll)) {
        sidebarNav.scrollTop = savedScroll;
    }

    const activeItem = sidebarNav.querySelector('.nav-item.bg-slate-800');
    if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

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

if (sidebarNav) {
    sidebarNav.addEventListener('scroll', function() {
        localStorage.setItem('sidebarScrollTop', sidebarNav.scrollTop);
        updateSidebarScrollbar(true);
    });
}

// Initialize sidebar state on page load
loadSidebarState();
restoreSidebarScroll();
updateSidebarScrollbar(false);

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
  document.body.classList.add('mobile-sidebar-open');
});

// Close Mobile Drawer
sidebarOverlay.addEventListener('click', () => {
  sidebar.classList.add('-translate-x-full');
  sidebarOverlay.classList.add('hidden');
  document.body.classList.remove('mobile-sidebar-open');
});
    
// Auto-adjust margin on resize
window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
        sidebar.classList.remove('-translate-x-full');
        sidebarOverlay.classList.add('hidden');
        document.body.classList.remove('mobile-sidebar-open');
        if (sidebar.classList.contains('sidebar-collapsed')) {
            mainContent.style.marginLeft = '80px';
        } else {
            mainContent.style.marginLeft = '16rem';
        }
    } else {
        mainContent.style.marginLeft = '0';
        if (sidebar.classList.contains('-translate-x-full')) {
            document.body.classList.remove('mobile-sidebar-open');
        }
    }
    updateSidebarScrollbar(false);
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

// Stores submenu is always visible (no toggle needed)

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
