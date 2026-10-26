/**
 * Tiger Farm — Main Application Router & Shared Utilities
 * Strict database-first state: The SQLite database is the single source of truth.
 */

const App = {
  state: {
    currentView: 'dashboard',
    user: null,
    categories: [],
    units: [],
    products: [],
    suppliers: [],
    fields: [],
    unreadCount: 0,
  },

  views: {},

  init() {
    this.bindEvents();
    this.checkAuth().then(authed => {
      if (authed) {
        this.loadMetadata();
        this.handleRouting();
        this.startNotificationPoller();
      }
    });
  },

  // ── Authentication & Initial Load ──────────────────────────────────────────
  async checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        window.location.href = '/';
        return false;
      }
      const data = await res.json();
      this.state.user = data.user || data.data;
      this.renderUser();
      return true;
    } catch (err) {
      console.error('Auth error:', err);
      window.location.href = '/';
      return false;
    }
  },

  renderUser() {
    const u = this.state.user;
    if (!u) return;
    const nameEl = document.getElementById('userName');
    const roleEl = document.getElementById('userRole');
    const avatarEl = document.getElementById('userAvatar');
    if (nameEl) nameEl.textContent = u.full_name || u.username;
    if (roleEl) roleEl.textContent = (u.role || 'manager').toUpperCase();
    if (avatarEl) avatarEl.textContent = (u.username || 'A')[0].toUpperCase();
  },

  async loadMetadata() {
    try {
      const [catsRes, unitsRes, prodsRes, suppRes, fldRes] = await Promise.all([
        fetch('/api/categories').then(r => r.json()).catch(() => ({ categories: [] })),
        fetch('/api/units').then(r => r.json()).catch(() => ({ units: [] })),
        fetch('/api/products?per_page=1000').then(r => r.json()).catch(() => ({ products: [] })),
        fetch('/api/suppliers').then(r => r.json()).catch(() => []),
        fetch('/api/fields').then(r => r.json()).catch(() => []),
      ]);

      this.state.categories = catsRes.categories || (Array.isArray(catsRes) ? catsRes : []);
      this.state.units = unitsRes.units || (Array.isArray(unitsRes) ? unitsRes : []);
      this.state.products = prodsRes.products || (Array.isArray(prodsRes) ? prodsRes : []);
      this.state.suppliers = Array.isArray(suppRes) ? suppRes : (suppRes.suppliers || suppRes.data || []);
      this.state.fields = Array.isArray(fldRes) ? fldRes : (fldRes.fields || fldRes.data || []);

      this.populateDropdowns();
    } catch (e) {
      console.error('Error loading metadata from database:', e);
    }
  },

  populateDropdowns() {
    // Categories dropdowns
    document.querySelectorAll('select[name="category_id"]').forEach(sel => {
      const current = sel.value;
      sel.innerHTML = '<option value="">Select category...</option>' +
        this.state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      if (current) sel.value = current;
    });

    // Units dropdowns
    document.querySelectorAll('select[name="unit_id"]').forEach(sel => {
      const current = sel.value;
      sel.innerHTML = '<option value="">Select unit...</option>' +
        this.state.units.map(u => `<option value="${u.id}">${u.name} (${u.symbol})</option>`).join('');
      if (current) sel.value = current;
    });

    // Products dropdowns in modals
    const prodOpts = '<option value="">Select product...</option>' +
      this.state.products.map(p =>
        `<option value="${p.id}" data-unit="${p.unit_id || ''}" data-stock="${p.current_quantity || 0}" data-symbol="${p.unit || ''}">${p.name} (Stock: ${p.current_quantity} ${p.unit || ''})</option>`
      ).join('');

    const purchaseProd = document.getElementById('purchaseProduct');
    if (purchaseProd) purchaseProd.innerHTML = prodOpts;

    const usageProd = document.getElementById('usageProduct');
    if (usageProd) usageProd.innerHTML = prodOpts;

    // Supplier datalist
    const supDl = document.getElementById('supplierDatalist');
    if (supDl) {
      supDl.innerHTML = this.state.suppliers.map(s => `<option value="${s.name}"></option>`).join('');
    }

    // Field datalist
    const fldDl = document.getElementById('fieldDatalist');
    if (fldDl) {
      fldDl.innerHTML = this.state.fields.map(f => `<option value="${f.name}"></option>`).join('');
    }
  },

  // ── Router ─────────────────────────────────────────────────────────────────
  navigate(viewName, params = {}) {
    window.location.hash = `#${viewName}`;
  },

  handleRouting() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    const [viewName] = hash.split('?');
    this.switchView(viewName || 'dashboard');
  },

  switchView(viewName) {
    if (!this.views[viewName]) {
      viewName = 'dashboard';
    }
    this.state.currentView = viewName;

    // Update active nav link
    document.querySelectorAll('.sidebar .nav-link, .mobile-nav .mobile-nav-item').forEach(el => {
      if (el.dataset.view === viewName) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // Update heading
    const titleMap = {
      dashboard: 'Dashboard',
      products: 'Products & Stock Management',
      purchases: 'Purchase History & Invoices',
      usage: 'Product Usage Records',
      analytics: 'Farm Analytics & Cost Trends',
      notifications: 'System Alerts & Warnings',
      reports: 'Reports & CSV Import/Export',
      settings: 'Settings & Farm Configuration',
    };
    const headEl = document.getElementById('pageHeading');
    if (headEl) headEl.textContent = titleMap[viewName] || 'Tiger Farm';

    // Auto-close mobile/tablet sidebar when route changes
    this.closeSidebar();

    // Render target view directly from database
    const mainView = document.getElementById('main-view');
    mainView.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    this.views[viewName].render(mainView);
  },

  registerView(name, viewObj) {
    this.views[name] = viewObj;
  },

  // ── Modals & Notifications ─────────────────────────────────────────────────
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('open');
      const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea');
      if (firstInput) setTimeout(() => firstInput.focus(), 50);
    }
  },

  closeModal(modalId) {
    const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
    if (modal) modal.classList.remove('open');
  },

  showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all .3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  startNotificationPoller() {
    this.fetchUnreadCount();
    setInterval(() => this.fetchUnreadCount(), 30000); // Poll every 30s
  },

  async fetchUnreadCount() {
    try {
      const res = await fetch('/api/notifications?unread_only=true&per_page=1');
      if (res.ok) {
        const data = await res.json();
        const badge = document.getElementById('navNotifBadge');
        if (badge) {
          if (data.unread_count > 0) {
            badge.textContent = data.unread_count;
            badge.style.display = 'inline-block';
          } else {
            badge.style.display = 'none';
          }
        }
      }
    } catch {}
  },

  // ── Sidebar Drawer for Mobile & Tablet ─────────────────────────────────────
  openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    document.body.classList.add('sidebar-open');
  },

  closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.classList.remove('sidebar-open');
  },

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
      this.closeSidebar();
    } else {
      this.openSidebar();
    }
  },

  // ── Global Event Bindings ──────────────────────────────────────────────────
  bindEvents() {
    window.addEventListener('hashchange', () => this.handleRouting());

    // Sidebar drawer toggles
    const btnToggleSidebar = document.getElementById('btnToggleSidebar');
    if (btnToggleSidebar) {
      btnToggleSidebar.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSidebar();
      });
    }

    const btnCloseSidebar = document.getElementById('btnCloseSidebar');
    if (btnCloseSidebar) {
      btnCloseSidebar.addEventListener('click', () => this.closeSidebar());
    }

    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => this.closeSidebar());
    }

    const btnMobileMore = document.getElementById('btnMobileMore');
    if (btnMobileMore) {
      btnMobileMore.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleSidebar();
      });
    }

    // Nav clicks
    document.addEventListener('click', (e) => {
      const navBtn = e.target.closest('[data-view]');
      if (navBtn) {
        e.preventDefault();
        this.navigate(navBtn.dataset.view);
      }

      // Close modal triggers
      if (e.target.matches('[data-close-modal]') || e.target.closest('[data-close-modal]')) {
        const modal = e.target.closest('.modal-overlay');
        if (modal) this.closeModal(modal);
      }

      // Backdrop click closes modal
      if (e.target.classList.contains('modal-overlay')) {
        this.closeModal(e.target);
      }
    });

    // Logout: Terminates user session only; never destroys farm database records
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        if (confirm('Are you sure you want to sign out? Your farm data remains completely safe.')) {
          await fetch('/api/auth/logout', { method: 'POST' });
          window.location.href = '/';
        }
      });
    }

    // Quick Purchase button
    const btnQP = document.getElementById('btnQuickPurchase');
    if (btnQP) {
      btnQP.addEventListener('click', () => {
        document.getElementById('formPurchase').reset();
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('purchaseDate').value = today;
        this.openModal('modalPurchase');
      });
    }

    // Quick Usage button
    const btnQU = document.getElementById('btnQuickUsage');
    if (btnQU) {
      btnQU.addEventListener('click', () => {
        document.getElementById('formUsage').reset();
        document.getElementById('usageStockHint').textContent = '';
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('usageDate').value = today;
        this.openModal('modalUsage');
      });
    }

    // Purchase product select auto-sets unit
    const pProd = document.getElementById('purchaseProduct');
    if (pProd) {
      pProd.addEventListener('change', () => {
        const opt = pProd.options[pProd.selectedIndex];
        if (opt && opt.dataset.unit) {
          document.getElementById('purchaseUnit').value = opt.dataset.unit;
        }
      });
    }

    // Auto price calculation for purchase
    const pQty = document.getElementById('purchaseQty');
    const pUnitPrice = document.getElementById('purchaseUnitPrice');
    const pTotalPrice = document.getElementById('purchaseTotalPrice');

    const calcPrice = () => {
      const q = parseFloat(pQty.value);
      const u = parseFloat(pUnitPrice.value);
      if (q > 0 && u > 0 && document.activeElement === pUnitPrice) {
        pTotalPrice.value = (q * u).toFixed(2);
      }
    };
    if (pQty && pUnitPrice) {
      pUnitPrice.addEventListener('input', calcPrice);
      pQty.addEventListener('input', calcPrice);
      pTotalPrice.addEventListener('input', () => {
        const q = parseFloat(pQty.value);
        const t = parseFloat(pTotalPrice.value);
        if (q > 0 && t > 0 && document.activeElement === pTotalPrice) {
          pUnitPrice.value = (t / q).toFixed(2);
        }
      });
    }

    // Usage product select shows current stock & sets unit
    const uProd = document.getElementById('usageProduct');
    if (uProd) {
      uProd.addEventListener('change', () => {
        const opt = uProd.options[uProd.selectedIndex];
        const hint = document.getElementById('usageStockHint');
        if (opt && opt.value) {
          hint.textContent = `Current Database Stock: ${opt.dataset.stock} ${opt.dataset.symbol}`;
          if (opt.dataset.unit) document.getElementById('usageUnit').value = opt.dataset.unit;
        } else {
          hint.textContent = '';
        }
      });
    }

    // Quick Purchase form submit — Strict database confirmation (Section 15)
    const fPurchase = document.getElementById('formPurchase');
    if (fPurchase) {
      fPurchase.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSubmitPurchase');
        btn.disabled = true;
        btn.textContent = 'Saving to Database...';

        const formData = new FormData(fPurchase);
        try {
          const res = await fetch('/api/purchases', {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            this.showToast(data.message || 'Purchase saved permanently to database!');
            this.closeModal('modalPurchase');
            await this.loadMetadata();
            if (this.views[this.state.currentView]?.refresh) {
              this.views[this.state.currentView].refresh();
            }
          } else {
            const err = data.message || data.error || 'Unable to save purchase. Please try again.';
            this.showToast(err, 'error');
          }
        } catch (err) {
          this.showToast('Server error while saving purchase: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Save Purchase';
        }
      });
    }

    // Quick Usage form submit — Strict database confirmation (Section 11, 12, 15)
    const fUsage = document.getElementById('formUsage');
    if (fUsage) {
      fUsage.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSubmitUsage');
        btn.disabled = true;
        btn.textContent = 'Deducting Stock...';

        const payload = {
          product_id: document.getElementById('usageProduct').value,
          quantity: document.getElementById('usageQty').value,
          unit_id: document.getElementById('usageUnit').value,
          usage_date: document.getElementById('usageDate').value,
          field_location: document.getElementById('usageField').value,
          reason: document.getElementById('usageReason').value,
          remarks: document.getElementById('usageRemarks').value,
        };

        try {
          const res = await fetch('/api/usages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            this.showToast(data.message || 'Usage recorded and stock deducted successfully!');
            this.closeModal('modalUsage');
            await this.loadMetadata();
            if (this.views[this.state.currentView]?.refresh) {
              this.views[this.state.currentView].refresh();
            }
          } else {
            const err = data.message || data.error || 'Unable to record usage.';
            this.showToast(err, 'error');
          }
        } catch (err) {
          this.showToast('Server error while recording usage: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Save Usage';
        }
      });
    }

    // Global Search
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = searchInput.value.trim();
          if (query) {
            window.location.hash = `#products?search=${encodeURIComponent(query)}`;
          }
        }
      });
    }
  },
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
