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
    packages: [],
    packagingTypes: ['Bag', 'Bottle', 'Pouch', 'Container', 'Drum', 'Loose'],
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
    const name = u.full_name || u.username;
    const role = (u.role || 'manager').toUpperCase();
    const letter = (u.username || 'A')[0].toUpperCase();

    ['userName', 'mobileUserName'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = name;
    });
    ['userRole', 'mobileUserRole'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = role;
    });
    ['userAvatar', 'topUserAvatar', 'mobileUserAvatar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = letter;
    });
  },

  async loadMetadata() {
    try {
      const [catsRes, unitsRes, prodsRes, suppRes, fldRes, pkgsRes, typesRes] = await Promise.all([
        fetch('/api/categories').then(r => r.json()).catch(() => ({ categories: [] })),
        fetch('/api/units').then(r => r.json()).catch(() => ({ units: [] })),
        fetch('/api/products?per_page=1000&status=all').then(r => r.json()).catch(() => ({ products: [] })),
        fetch('/api/suppliers').then(r => r.json()).catch(() => []),
        fetch('/api/fields').then(r => r.json()).catch(() => []),
        fetch('/api/packages').then(r => r.json()).catch(() => ({ packages: [] })),
        fetch('/api/packaging-types').then(r => r.json()).catch(() => ({ packaging_types: ['Bag', 'Bottle', 'Pouch', 'Container', 'Drum', 'Loose'] })),
      ]);

      this.state.categories = catsRes.categories || (Array.isArray(catsRes) ? catsRes : []);
      this.state.units = unitsRes.units || (Array.isArray(unitsRes) ? unitsRes : []);
      this.state.products = prodsRes.products || (Array.isArray(prodsRes) ? prodsRes : []);
      this.state.suppliers = Array.isArray(suppRes) ? suppRes : (suppRes.suppliers || suppRes.data || []);
      this.state.fields = Array.isArray(fldRes) ? fldRes : (fldRes.fields || fldRes.data || []);
      this.state.packages = pkgsRes.packages || pkgsRes.data || [];
      if (typesRes.packaging_types) this.state.packagingTypes = typesRes.packaging_types;

      this.populateDropdowns();
      this.setupPackagingCalculators();
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

    // Auto-close mobile/tablet sidebar and mobile hub modal when route changes
    this.closeSidebar();
    this.closeModal('modalMobileMenu');

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
      // Only auto-focus inputs on desktop; on mobile (<= 768px), auto-focusing immediately forces software keyboard & viewport zoom
      if (window.innerWidth > 768) {
        const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea');
        if (firstInput) setTimeout(() => firstInput.focus(), 50);
      }
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
        const count = data.unread_count || 0;
        ['navNotifBadge', 'topNotifBadge', 'bottomNotifBadge'].forEach(id => {
          const badge = document.getElementById(id);
          if (badge) {
            if (count > 0) {
              badge.textContent = count;
              badge.style.display = 'inline-block';
            } else {
              badge.style.display = 'none';
            }
          }
        });
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
        this.openModal('modalMobileMenu');
      });
    }

    const btnTopUser = document.getElementById('btnTopUser');
    if (btnTopUser) {
      btnTopUser.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openModal('modalMobileMenu');
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
    const handleLogout = async () => {
      if (confirm('Are you sure you want to sign out? Your farm data remains completely safe in the database.')) {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/';
      }
    };

    ['btnLogout', 'btnMobileLogout', 'btnMobileLogoutFooter'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', handleLogout);
    });

    // Quick Purchase button
    const btnQP = document.getElementById('btnQuickPurchase');
    if (btnQP) {
      btnQP.addEventListener('click', () => {
        const form = document.getElementById('formPurchase');
        form.reset();
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('purchaseDate').value = today;
        document.getElementById('purchaseCalcResult').textContent = '0 kg';
        this.openModal('modalPurchase');
        this.syncPurchasePackagingUI();
      });
    }

    // Quick Usage button
    const btnQU = document.getElementById('btnQuickUsage');
    if (btnQU) {
      btnQU.addEventListener('click', () => {
        const form = document.getElementById('formUsage');
        form.reset();
        document.getElementById('usageStockHint').textContent = '';
        document.getElementById('usageCalcResult').textContent = '0 kg';
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('usageDate').value = today;
        this.openModal('modalUsage');
        this.syncUsagePackagingUI();
      });
    }

    // Quick Purchase form submit — Strict database confirmation
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

    // Quick Usage form submit — Strict database confirmation
    const fUsage = document.getElementById('formUsage');
    if (fUsage) {
      fUsage.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSubmitUsage');
        btn.disabled = true;
        btn.textContent = 'Deducting Stock...';

        const payload = {
          product_id: document.getElementById('usageProduct').value,
          packaging_type: document.getElementById('usagePkgType').value,
          package_size: document.getElementById('usagePkgSize').value,
          package_unit: document.getElementById('usagePkgUnit').value,
          package_count: document.getElementById('usagePkgCount').value,
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

    // Package Master modal form submit
    const fPkg = document.getElementById('formPackage');
    if (fPkg) {
      fPkg.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSubmitPackage');
        btn.disabled = true;
        btn.textContent = 'Saving Package Size...';

        const editId = document.getElementById('packageEditId').value;
        const payload = {
          package_size: parseFloat(document.getElementById('pkgSize').value) || 0,
          unit_symbol: document.getElementById('pkgUnit').value,
          packaging_type: document.getElementById('pkgPackagingType').value,
          is_active: document.getElementById('pkgStatus').value === 'true',
        };

        const url = editId ? `/api/packages/${editId}` : '/api/packages';
        const method = editId ? 'PUT' : 'POST';

        try {
          const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            this.showToast(data.message || 'Package size saved to Package Master!');
            this.closeModal('modalPackage');
            await this.loadMetadata();
            if (this.views.settings?.refresh) this.views.settings.refresh();
          } else {
            this.showToast(data.message || 'Failed to save package size.', 'error');
          }
        } catch (err) {
          this.showToast('Error: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Save Package Size';
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

  // ── Packaging & Stock Calculation Logic (Sections 1 to 11) ─────────────────
  setupPackagingCalculators() {
    // 1. Purchase packaging setup
    const pProd = document.getElementById('purchaseProduct');
    const pPkgType = document.getElementById('purchasePkgType');
    const pPkgSize = document.getElementById('purchasePkgSize');
    const pPkgCount = document.getElementById('purchasePkgCount');
    const pUnitPrice = document.getElementById('purchaseUnitPrice');
    const pTotalPrice = document.getElementById('purchaseTotalPrice');

    const pLooseQty = document.getElementById('purchaseLooseQty');

    pProd?.addEventListener('change', () => this.syncPurchasePackagingUI());
    pPkgType?.addEventListener('change', () => this.syncPurchasePackagingUI());
    pPkgSize?.addEventListener('change', () => this.recalcPurchaseTotal());
    pPkgCount?.addEventListener('input', () => this.recalcPurchaseTotal());
    pLooseQty?.addEventListener('input', () => this.recalcPurchaseTotal());

    if (pPkgCount && pUnitPrice) {
      pUnitPrice.addEventListener('input', () => {
        const count = parseFloat(pPkgCount.value) || 0;
        const rate = parseFloat(pUnitPrice.value) || 0;
        if (count > 0 && rate > 0) {
          pTotalPrice.value = (count * rate).toFixed(2);
        }
      });

      pTotalPrice?.addEventListener('input', () => {
        const count = parseFloat(pPkgCount.value) || 0;
        const total = parseFloat(pTotalPrice.value) || 0;
        if (count > 0 && total > 0) {
          pUnitPrice.value = (total / count).toFixed(2);
        }
      });
    }

    // 2. Usage packaging setup
    const uProd = document.getElementById('usageProduct');
    const uPkgType = document.getElementById('usagePkgType');
    const uPkgSize = document.getElementById('usagePkgSize');
    const uPkgCount = document.getElementById('usagePkgCount');

    uProd?.addEventListener('change', () => this.syncUsagePackagingUI());
    uPkgType?.addEventListener('change', () => this.syncUsagePackagingSizes());
    uPkgSize?.addEventListener('change', () => this.recalcUsageTotal());
    uPkgCount?.addEventListener('input', () => this.recalcUsageTotal());

    // 3. Package Master modal live preview setup
    const pkgTypeIn = document.getElementById('pkgPackagingType');
    const pkgSizeIn = document.getElementById('pkgSize');
    const pkgUnitIn = document.getElementById('pkgUnit');
    const pkgPreview = document.getElementById('pkgPreviewText');

    const updatePkgPreview = () => {
      if (!pkgPreview) return;
      const type = pkgTypeIn?.value || 'Bag';
      const size = pkgSizeIn?.value || '50';
      const unit = pkgUnitIn?.value || 'kg';
      if (type.toLowerCase() === 'loose') {
        pkgPreview.textContent = `Loose (${unit.toUpperCase()})`;
      } else {
        pkgPreview.textContent = `${size} ${unit} ${type}`;
      }
    };
    [pkgTypeIn, pkgSizeIn, pkgUnitIn].forEach(el => el?.addEventListener('input', updatePkgPreview));
    [pkgTypeIn, pkgSizeIn, pkgUnitIn].forEach(el => el?.addEventListener('change', updatePkgPreview));
  },

  syncPurchasePackagingUI() {
    const pProd = document.getElementById('purchaseProduct');
    const pPkgType = document.getElementById('purchasePkgType');
    const pPkgSize = document.getElementById('purchasePkgSize');
    const pPkgSizeGroup = document.getElementById('purchasePkgSizeGroup');
    const pCountLabel = document.getElementById('purchasePkgCountLabel');
    const pPriceLabel = document.getElementById('purchasePriceLabel');
    const pUnitHidden = document.getElementById('purchaseUnit');
    const pPkgUnitHidden = document.getElementById('purchasePkgUnit');

    if (!pProd || !pPkgType || !pPkgSize) return;

    const prodId = pProd.value;
    const prod = this.state.products.find(p => p.id == prodId);
    const baseUnit = (prod && prod.unit) ? prod.unit.toLowerCase() : 'kg';
    const isLiquid = (baseUnit === 'l' || baseUnit === 'ml' || (prod && prod.name.toLowerCase().includes('liquid')));

    if (pUnitHidden && prod) pUnitHidden.value = prod.unit_id || '';

    // If user just picked product and hasn't changed packaging type, select smart default
    if (document.activeElement === pProd) {
      pPkgType.value = (prod && prod.default_packaging_type) ? prod.default_packaging_type : (isLiquid ? 'Bottle' : 'Bag');
    }

    const selType = pPkgType.value;

    if (selType.toLowerCase() === 'loose') {
      if (pPkgSizeGroup) pPkgSizeGroup.style.display = 'none';
      if (pCountLabel) pCountLabel.textContent = `4. Quantity (${prod ? prod.unit : 'KG'} Loose) *`;
      if (pPriceLabel) pPriceLabel.textContent = `Unit Price (₹ per ${prod ? prod.unit : 'KG'})`;
      if (pPkgUnitHidden) pPkgUnitHidden.value = prod ? prod.unit : 'kg';
    } else {
      if (pPkgSizeGroup) pPkgSizeGroup.style.display = 'block';
      if (pCountLabel) pCountLabel.textContent = `4. Quantity (Number of ${selType}s) *`;
      if (pPriceLabel) pPriceLabel.textContent = `Unit Price (₹ per ${selType})`;

      // Populate package sizes for selected packaging type
      let matching = this.state.packages.filter(p => p.packaging_type.toLowerCase() === selType.toLowerCase());
      if (isLiquid) {
        const liquidMatches = matching.filter(p => ['l', 'ml'].includes(p.unit_symbol.toLowerCase()));
        if (liquidMatches.length) matching = liquidMatches;
      } else {
        const weightMatches = matching.filter(p => ['kg', 'g', 'ton'].includes(p.unit_symbol.toLowerCase()));
        if (weightMatches.length) matching = weightMatches;
      }

      pPkgSize.innerHTML = matching.map(p =>
        `<option value="${p.package_size}" data-unit="${p.unit_symbol}" data-multiplier="${p.base_multiplier}">${p.label || `${p.package_size} ${p.unit_symbol} ${p.packaging_type}`}</option>`
      ).join('');

      // Auto select product's configured default bag size
      if (prod && prod.default_package_size) {
        const found = matching.find(p => p.package_size == prod.default_package_size);
        if (found) {
          pPkgSize.value = found.package_size;
          if (pPkgUnitHidden) pPkgUnitHidden.value = found.unit_symbol;
        } else if (matching.length && pPkgUnitHidden) {
          pPkgUnitHidden.value = matching[0].unit_symbol;
        }
      } else if (matching.length && pPkgUnitHidden) {
        pPkgUnitHidden.value = matching[0].unit_symbol;
      }

      // Auto select default quantity (e.g. 1 Bag)
      const pPkgCount = document.getElementById('purchasePkgCount');
      if (document.activeElement === pProd && prod && prod.default_package_count && pPkgCount) {
        pPkgCount.value = prod.default_package_count;
      }
    }

    this.recalcPurchaseTotal();
  },

  recalcPurchaseTotal() {
    const pProd = document.getElementById('purchaseProduct');
    const pPkgType = document.getElementById('purchasePkgType');
    const pPkgSize = document.getElementById('purchasePkgSize');
    const pPkgCount = document.getElementById('purchasePkgCount');
    const pUnitPrice = document.getElementById('purchaseUnitPrice');
    const pTotalPrice = document.getElementById('purchaseTotalPrice');
    const pQtyHidden = document.getElementById('purchaseQty');
    const pPkgUnitHidden = document.getElementById('purchasePkgUnit');
    const pCalcResult = document.getElementById('purchaseCalcResult');

    if (!pProd || !pPkgType || !pPkgCount || !pCalcResult) return;

    const prod = this.state.products.find(p => p.id == pProd.value);
    const baseSym = (prod && prod.unit) ? prod.unit : 'kg';
    const pkgType = pPkgType.value || 'Bag';
    const count = parseFloat(pPkgCount.value) || 0;

    const looseIn = document.getElementById('purchaseLooseQty');
    const looseQty = parseFloat(looseIn?.value) || 0;

    if (pkgType.toLowerCase() === 'loose') {
      const totLoose = (count > 0 ? count : looseQty);
      pQtyHidden.value = totLoose;
      if (pPkgUnitHidden) pPkgUnitHidden.value = baseSym;
      pCalcResult.innerHTML = `<strong>${totLoose} ${baseSym} Loose</strong>`;
    } else {
      const opt = pPkgSize.options[pPkgSize.selectedIndex];
      if (opt && opt.value) {
        const size = parseFloat(opt.value) || 0;
        const unit = opt.dataset.unit || baseSym;
        const mult = parseFloat(opt.dataset.multiplier) || size;
        const bagTotal = Math.round(count * mult * 10000) / 10000;
        const grandTotal = Math.round((bagTotal + looseQty) * 10000) / 10000;
        pQtyHidden.value = grandTotal;
        if (pPkgUnitHidden) pPkgUnitHidden.value = unit;

        const noun = count === 1 ? pkgType : (pkgType.endsWith('s') ? pkgType : pkgType + 's');
        if (looseQty > 0) {
          pCalcResult.innerHTML = `<strong>${count} × ${size} ${unit} ${noun} = ${bagTotal} ${baseSym} + ${looseQty} ${baseSym} Loose = Total Added Stock: ${grandTotal} ${baseSym}</strong>`;
        } else {
          pCalcResult.innerHTML = `<strong>${count} × ${size} ${unit} ${noun} = ${bagTotal} ${baseSym}</strong>`;
        }
      } else {
        pQtyHidden.value = looseQty;
        pCalcResult.innerHTML = looseQty > 0 ? `<strong>${looseQty} ${baseSym} Loose</strong>` : `<strong>0 ${baseSym}</strong>`;
      }
    }

    // Update prices if needed
    if (count > 0 && pUnitPrice && pTotalPrice) {
      const rate = parseFloat(pUnitPrice.value) || 0;
      if (rate > 0 && document.activeElement === pUnitPrice) {
        pTotalPrice.value = (count * rate).toFixed(2);
      }
    }
  },

  syncUsagePackagingUI() {
    const uProd = document.getElementById('usageProduct');
    const uStockHint = document.getElementById('usageStockHint');
    const uPkgType = document.getElementById('usagePkgType');
    const uUnitHidden = document.getElementById('usageUnit');

    if (!uProd) return;
    const prod = this.state.products.find(p => p.id == uProd.value);

    if (prod) {
      if (uStockHint) {
        let breakdownText = '';
        if (prod.package_breakdown && prod.package_breakdown.length) {
          breakdownText = ' • Packages: ' + prod.package_breakdown.map(b => b.description).join(', ');
        }
        uStockHint.textContent = `Current Stock: ${prod.current_quantity} ${prod.unit || ''}${breakdownText}`;
      }
      if (uUnitHidden) uUnitHidden.value = prod.unit_id || '';

      const isLiquid = (prod.unit || '').toLowerCase() === 'l' || prod.name.toLowerCase().includes('liquid');
      if (uPkgType) uPkgType.value = (prod && prod.default_packaging_type) ? prod.default_packaging_type : (isLiquid ? 'Bottle' : 'Bag');
    } else {
      if (uStockHint) uStockHint.textContent = '';
    }

    this.syncUsagePackagingSizes();
  },

  syncUsagePackagingSizes() {
    const uProd = document.getElementById('usageProduct');
    const uPkgType = document.getElementById('usagePkgType');
    const uPkgSize = document.getElementById('usagePkgSize');
    const uPkgSizeGroup = document.getElementById('usagePkgSizeGroup');
    const uCountLabel = document.getElementById('usagePkgCountLabel');
    const uPkgUnitHidden = document.getElementById('usagePkgUnit');

    if (!uProd || !uPkgType || !uPkgSize) return;

    const prod = this.state.products.find(p => p.id == uProd.value);
    const baseUnit = (prod && prod.unit) ? prod.unit.toLowerCase() : 'kg';
    const isLiquid = (baseUnit === 'l' || baseUnit === 'ml' || (prod && prod.name.toLowerCase().includes('liquid')));
    const selType = uPkgType.value;

    if (selType.toLowerCase() === 'loose') {
      if (uPkgSizeGroup) uPkgSizeGroup.style.display = 'none';
      if (uCountLabel) uCountLabel.textContent = `4. Quantity Used (${prod ? prod.unit : 'KG'} Loose) *`;
      if (uPkgUnitHidden) uPkgUnitHidden.value = prod ? prod.unit : 'kg';
    } else {
      if (uPkgSizeGroup) uPkgSizeGroup.style.display = 'block';
      if (uCountLabel) uCountLabel.textContent = `4. Quantity Used (Number of ${selType}s) *`;

      // Check if product has specific stock breakdown for this package type
      let options = [];
      if (prod && prod.package_breakdown && prod.package_breakdown.length) {
        const typeBreakdown = prod.package_breakdown.filter(b => b.packaging_type.toLowerCase() === selType.toLowerCase());
        if (typeBreakdown.length) {
          options = typeBreakdown.map(b => ({
            package_size: b.package_size,
            unit_symbol: b.unit_symbol,
            base_multiplier: (b.total_quantity && b.package_count) ? (b.total_quantity / b.package_count) : b.package_size,
            label: `${b.package_size} ${b.unit_symbol} (In Stock: ${b.package_count} ${selType}s)`
          }));
        }
      }

      if (!options.length) {
        let matching = this.state.packages.filter(p => p.packaging_type.toLowerCase() === selType.toLowerCase());
        if (isLiquid) {
          const liquidMatches = matching.filter(p => ['l', 'ml'].includes(p.unit_symbol.toLowerCase()));
          if (liquidMatches.length) matching = liquidMatches;
        } else {
          const weightMatches = matching.filter(p => ['kg', 'g', 'ton'].includes(p.unit_symbol.toLowerCase()));
          if (weightMatches.length) matching = weightMatches;
        }
        options = matching;
      }

      uPkgSize.innerHTML = options.map(p =>
        `<option value="${p.package_size}" data-unit="${p.unit_symbol}" data-multiplier="${p.base_multiplier}">${p.label || `${p.package_size} ${p.unit_symbol} ${selType}`}</option>`
      ).join('');

      // Auto select product's configured default bag size
      if (prod && prod.default_package_size) {
        const found = options.find(p => p.package_size == prod.default_package_size);
        if (found) {
          uPkgSize.value = found.package_size;
          if (uPkgUnitHidden) uPkgUnitHidden.value = found.unit_symbol;
        } else if (options.length && uPkgUnitHidden) {
          uPkgUnitHidden.value = options[0].unit_symbol;
        }
      } else if (options.length && uPkgUnitHidden) {
        uPkgUnitHidden.value = options[0].unit_symbol;
      }

      // Auto select default quantity (e.g. 1 Bag)
      const uPkgCount = document.getElementById('usagePkgCount');
      if (document.activeElement === uProd && prod && prod.default_package_count && uPkgCount) {
        uPkgCount.value = prod.default_package_count;
      }
    }

    this.recalcUsageTotal();
  },

  recalcUsageTotal() {
    const uProd = document.getElementById('usageProduct');
    const uPkgType = document.getElementById('usagePkgType');
    const uPkgSize = document.getElementById('usagePkgSize');
    const uPkgCount = document.getElementById('usagePkgCount');
    const uQtyHidden = document.getElementById('usageQty');
    const uPkgUnitHidden = document.getElementById('usagePkgUnit');
    const uCalcResult = document.getElementById('usageCalcResult');

    if (!uProd || !uPkgType || !uPkgCount || !uCalcResult) return;

    const prod = this.state.products.find(p => p.id == uProd.value);
    const baseSym = (prod && prod.unit) ? prod.unit : 'kg';
    const pkgType = uPkgType.value || 'Bag';
    const count = parseFloat(uPkgCount.value) || 0;

    if (pkgType.toLowerCase() === 'loose') {
      uQtyHidden.value = count;
      if (uPkgUnitHidden) uPkgUnitHidden.value = baseSym;
      uCalcResult.innerHTML = `<strong>${count} ${baseSym} Loose</strong>`;
    } else {
      const opt = uPkgSize.options[uPkgSize.selectedIndex];
      if (opt && opt.value) {
        const size = parseFloat(opt.value) || 0;
        const unit = opt.dataset.unit || baseSym;
        const mult = parseFloat(opt.dataset.multiplier) || size;
        const total = Math.round(count * mult * 10000) / 10000;
        uQtyHidden.value = total;
        if (uPkgUnitHidden) uPkgUnitHidden.value = unit;

        const noun = count === 1 ? pkgType : (pkgType.endsWith('s') ? pkgType : pkgType + 's');
        uCalcResult.innerHTML = `<strong>${count} × ${size} ${unit} ${noun} = ${total} ${baseSym}</strong>`;
      } else {
        uQtyHidden.value = 0;
        uCalcResult.innerHTML = `<strong>0 ${baseSym}</strong>`;
      }
    }
  },
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());

