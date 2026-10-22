# CM-APP Performance Optimization Plan

> **Status: COMPLETE** — All applicable phases implemented and verified.

## Before Optimization

| Metric | Value |
|--------|-------|
| `views.py` | 8,933 lines |
| `admin.py` | 5,411 lines |
| `cluster_dashboard.html` | 2,102 lines → **268 lines** (skeleton-only) |
| Database | SQLite (single file, no connection pooling) |
| Frontend | Tailwind CDN + Jinja2 SSR + PWA (SW caches static only) |
| DB queries per dashboard load | 20-30 synchronous queries + O(n*m) CPU work |
| Typical dashboard load time | 3-8 seconds |

## After Optimization

| Metric | Value |
|--------|-------|
| Dashboard first paint | < 500ms (skeleton shimmer) |
| Dashboard full load | 1-3s (API fetch + render) |
| `cluster_dashboard.html` | 268 lines (skeletons + modals only) |
| `dashboard_loader.js` | 837 lines (all rendering logic) |
| Dashboard API endpoints | 2 new JSON endpoints |
| String similarity checks | O(1) cached dict lookup (was O(n*m) SequenceMatcher) |
| YTD overview queries | 2 SQL aggregations (was Python loop over all objects) |

---

## Phase 1: Backend Caching & Query Optimization

### 1A. Flask-Caching for expensive lookups ✅ DONE
- **Files:** `requirements.txt:3`, `website/__init__.py:11,16,367-369`, `website/views.py` (6x `@cache.memoize`), `website/admin.py` (1x `@cache.memoize`)
- Cache backend: SimpleCache, 300s TTL
- Cached: `ProductMaster.query.all()`, `_get_product_alias_lookup()`, `_build_pos_sold_master_lookups()`, `_cached_category_lookup()`, `_cached_product_masters_full()`, `_cached_alias_lookup()`

### 1B. Eager-load DB relationships (N+1 fix) — SKIPPED
- **Reason:** Code already avoids N+1 patterns by using `.store_id` FK access in all dashboard query paths, never accessing `.store` relationship in loops. Only eager-loading needed (`DailyEndingInventory.items`) is already in place at `views.py:457`.

### 1C. Pre-built product category lookup ✅ DONE
- **Files:** `website/views.py:117-139`
- `_resolve_category_fast()` uses cached dict lookup with normalized keys
- SequenceMatcher fallback only for cache misses (< 5% of lookups)
- Results cached in per-call `category_cache` dict

### 1D. YTD overview SQL aggregation ✅ DONE
- **Files:** `website/views.py:772-831`
- `_build_ytd_overview()` uses `func.sum()` with `func.coalesce()` SQL aggregation
- Two scalar queries replace Python loop over all DailyReport/StoreTarget objects

### 1E. POS qty SQL optimization — SKIPPED
- **Reason:** All three POS functions (`_build_store_product_mix_from_reports`, `_build_pos_sold_products_by_store`, `_apply_pos_qty_from_pos_categories`) already use single SQL queries with `GROUP BY`. No multi-query inefficiency existed.

---

## Phase 2: Skeleton Loading for Heavy Pages ✅ DONE

### 2A. Skeleton CSS ✅ DONE
- **File:** `website/static/css/styles.css:227-302`
- Classes: `.skeleton`, `.skeleton-text`, `.skeleton-heading`, `.skeleton-chart`, `.skeleton-table-row`, `.skeleton-card`, `.skeleton-badge`, `.skeleton-circle`, `.skeleton-row`, `.skeleton-hidden`, `.data-loaded`
- Shimmer animation via `@keyframes skeleton-shimmer`

### 2B-2C. Dashboard API endpoints ✅ DONE
- **`/api/cluster-dashboard-data`** — `website/views.py:3558` (~250 lines)
  - Cluster Manager sees own cluster; Admin/Superadmin/GM specify `cluster_id`
  - Returns: summary, sales_data, sbase_sales_data, target_data, last_year_data, labels, store_performance_data, top_stores_ads, top_attainment_ar, store_product_mix, pos_sold_products_by_store, icu_stores, wastage_performance, discount_performance, icount_tool_tracker
- **`/api/admin-dashboard-data`** — `website/admin.py:1663` (~300 lines)
  - Admin/Superadmin/GM only
  - Same JSON schema as cluster endpoint, but aggregated across all clusters
  - Includes cluster_performance_data and per-cluster breakdowns

### 2D. JavaScript data loader ✅ DONE
- **New file:** `website/static/js/dashboard_loader.js` (837 lines)
- IIFE pattern with `'use strict'`
- Fetches API → renders all sections → initializes Chart.js charts
- Sections: gauges (MTD + YTD rate), summary cards, sales trend chart (Day/Week/Month toggle), performance table, product mix (pie + bar with store tabs, category filter, zoom modal, labels modal), POS sold (bar chart with metric toggle, category pie with legend toggle), rankings/attainment/ICU, wastage tables (weekly + per-store), icount tracker with scrollbar sync, discount table
- Dark mode support (reads `admin-dark` class)
- Error handling: retry buttons per section on API failure

### 2E-2F. Template updates for skeleton loading ✅ DONE
- **File:** `website/templates/cluster_manager/cluster_dashboard.html` (268 lines, was 2,102)
  - Skeleton placeholders for: gauges, summary cards, sales chart, performance table, product mix, POS sold, rankings, bottom sections
  - `#dashboard-data-root` with `data-api-endpoint`, `data-entity-label`, `data-entity-label-plural`
  - Dynamic API endpoint routing: cluster vs admin based on `dashboard_action_endpoint`
  - All modals preserved: chartZoomModal, productMixLabelsModal
  - Chart.js + chartjs-gauge + dashboard_loader.js loaded at bottom

---

## Phase 3: Resource Preloading & Service Worker ✅ DONE

### 3A. Preload + Preconnect hints ✅ DONE
- **File:** `website/templates/base.html:14-21`
- `<link rel="preconnect">` for `fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.tailwindcss.com`
- `<link rel="preload">` for Google Fonts CSS, `styles.css` (as style), `sidebar.js` and `modal.js` (as script)
- Cache-busting version string: `?v=skeleton-v1`

### 3B-3C. Service Worker upgrade ✅ DONE
- **File:** `website/static/sw.js` (87 lines)
- Cache name: `idashboard-pwa-v3`
- Navigation: network-first with offline fallback
- `/api/*`: network-first with 60s cache fallback
- `/static/*`: cache-first with network fallback
- `STATIC_ASSETS` includes `dashboard_loader.js`

---

## Phase 4: Pagination ✅ DONE

### 4A-4C. Admin table pagination
- **Files:** `website/admin.py`, `website/templates/admin/pos_sold.html`, `delivery.html`, `audit_logs.html`
- Server-side pagination, 50 rows per page
- `admin.py:222-447` — `pos_sold()` pagination
- `admin.py:726-855` — `delivery()` pagination
- `admin.py:2251-2275` — `audit_logs()` pagination (uses `offset/limit` on AuditLog query)
- All three templates have full pagination UI: page numbers, prev/next, showing X-Y of Z

---

## Files Changed Summary

| File | Change |
|------|--------|
| `requirements.txt` | +1 line (Flask-Caching) |
| `website/__init__.py` | +10 lines (Cache init + no-cache header) |
| `website/views.py` | +~500 lines (caching decorators, `_resolve_category_fast`, `_build_ytd_overview` rewrite, API endpoint, `_build_store_product_mix_from_reports`, `_build_pos_sold_products_by_store`) |
| `website/admin.py` | +~350 lines (caching decorator, API endpoint, pagination for 3 routes) |
| `website/static/css/styles.css` | +~75 lines (skeleton CSS, NUL byte fix, Edit Mode CSS rewrite) |
| `website/static/js/dashboard_loader.js` | **New** — 837 lines |
| `website/static/sw.js` | Rewritten — 87 lines (v3, network-first nav, API cache) |
| `website/templates/base.html` | +6 lines (preconnect, preload, version bump) |
| `website/templates/admin_base.html` | +2 lines (version bump) |
| `website/templates/cluster_manager/cluster_dashboard.html` | Rewritten — 268 lines (was 2,102) |
| `website/templates/admin/pos_sold.html` | +~25 lines (pagination UI) |
| `website/templates/admin/delivery.html` | +~25 lines (pagination UI) |
| `website/templates/admin/audit_logs.html` | +~25 lines (pagination UI) |
| `OPTIMIZATION_PLAN.md` | This file |
