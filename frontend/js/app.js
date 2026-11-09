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
    packagingTypes: ['Bag', 'Bottle', 'Pouch', 'Container', 'Drum', 'Box', 'Can', 'Bundle', 'Pieces', 'Packet', 'Loose', 'Custom'],
    unreadCount: 0,
  },

  views: {},

  init() {
    // Purge any legacy Service Worker and clear stale browser CacheStorage
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          registration.unregister();
        }
      }).catch(() => {});
    }
    if ('caches' in window) {
      caches.keys().then(names => {
        for (let name of names) {
          caches.delete(name);
        }
      }).catch(() => {});
    }

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

      // Load distinct crop seasons
      fetch('/api/usages/seasons').then(r => r.json()).then(data => {
        const dl = document.getElementById('cropSeasonDatalist');
        if (dl && data.seasons) {
          dl.innerHTML = data.seasons.map(s => `<option value="${s}">`).join('');
        }
      }).catch(() => {});
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

    // Package Master modal unit dropdown (includes customized units)
    const pkgUnitSel = document.getElementById('pkgUnit');
    if (pkgUnitSel) {
      const current = pkgUnitSel.value || 'kg';
      const baseUnits = [
        { symbol: 'kg', name: 'kg (Kilogram)' },
        { symbol: 'g', name: 'g (Gram)' },
        { symbol: 'L', name: 'L (Liter)' },
        { symbol: 'ml', name: 'ml (Milliliter)' },
        { symbol: 'Ton', name: 'Ton' },
        { symbol: 'Unit', name: 'Unit' },
      ];
      (this.state.units || []).forEach(u => {
        if (!baseUnits.some(b => b.symbol.toLowerCase() === u.symbol.toLowerCase())) {
          baseUnits.push({ symbol: u.symbol, name: `${u.symbol} (${u.name})` });
        }
      });
      pkgUnitSel.innerHTML = baseUnits.map(b => `<option value="${b.symbol}">${b.name}</option>`).join('');
      if (current) pkgUnitSel.value = current;
    }

    // Products dropdowns in modals grouped by Category & Unit (KG vs Liter)
    const catGroups = {};
    (this.state.categories || []).forEach(c => { catGroups[c.name] = []; });
    catGroups['General / Other'] = [];

    this.state.products.forEach(p => {
      const cName = p.category || 'General / Other';
      if (!catGroups[cName]) catGroups[cName] = [];
      catGroups[cName].push(p);
    });

    let prodOpts = '<option value="">-- Select Product --</option>';
    Object.keys(catGroups).forEach(catName => {
      const prods = catGroups[catName];
      if (prods.length > 0) {
        prodOpts += `<optgroup label="🏷️ ${catName}">`;
        prods.forEach(p => {
          const uSym = (p.unit || 'kg').toUpperCase();
          const isLiquid = uSym === 'L' || uSym === 'ML';
          const typeLabel = isLiquid ? '💧 Liter' : '🌱 KG';
          const pkgDesc = p.default_package_size ? ` (${p.default_package_size} ${p.default_package_unit || p.unit || ''} ${p.default_packaging_type || ''})` : '';
          prodOpts += `<option value="${p.id}" data-unit="${p.unit_id || ''}" data-symbol="${p.unit || 'kg'}" data-stock="${p.current_quantity || 0}" data-category="${p.category || ''}" data-pkg-type="${p.default_packaging_type || ''}" data-pkg-size="${p.default_package_size || ''}">${p.name} [${typeLabel}${pkgDesc}] — Stock: ${p.current_quantity} ${p.unit || ''}</option>`;
        });
        prodOpts += '</optgroup>';
      }
    });

    const purchaseProd = document.getElementById('purchaseProduct');
    if (purchaseProd) purchaseProd.innerHTML = prodOpts;

    const usageProd = document.getElementById('usageProduct');
    if (usageProd) usageProd.innerHTML = prodOpts;

    const adjustProd = document.getElementById('adjustProduct');
    if (adjustProd) adjustProd.innerHTML = prodOpts;

    const reorderProd = document.getElementById('reorderProduct');
    if (reorderProd) reorderProd.innerHTML = prodOpts;

    const addStockProd = document.getElementById('addStockProduct');
    if (addStockProd) addStockProd.innerHTML = prodOpts;

    const editStockProd = document.getElementById('editStockProduct');
    if (editStockProd) editStockProd.innerHTML = prodOpts;

    // Supplier datalist
    const supDl = document.getElementById('supplierDatalist');
    if (supDl) {
      supDl.innerHTML = this.state.suppliers.map(s => `<option value="${s.name}"></option>`).join('');
    }
    const reorderSupDl = document.getElementById('reorderSupplierDatalist');
    if (reorderSupDl) {
      reorderSupDl.innerHTML = this.state.suppliers.map(s => `<option value="${s.name}"></option>`).join('');
    }

    // Field datalist
    const fldDl = document.getElementById('fieldDatalist');
    if (fldDl) {
      fldDl.innerHTML = this.state.fields.map(f => `<option value="${f.name}"></option>`).join('');
    }

    // Dynamic Product Unit / Package Options from Database
    this.populateProductUnitPackages();
  },

  populateProductUnitPackages() {
    const sel = document.getElementById('productUnitPackage');
    if (!sel) return;

    const currentSelectedOpt = sel.options[sel.selectedIndex];
    const currentDataSize = currentSelectedOpt ? currentSelectedOpt.dataset.size : null;
    const currentDataType = currentSelectedOpt ? currentSelectedOpt.dataset.type : null;
    const currentDataUnit = currentSelectedOpt ? currentSelectedOpt.dataset.unit : null;

    const packages = this.state.packages || [];
    const units = this.state.units || [];

    const bagPkgs = [];
    const bottlePkgs = [];
    const pouchPkgs = [];
    const containerPkgs = [];
    const otherPkgs = [];

    packages.forEach(p => {
      if (p.is_active === false) return;
      const type = (p.packaging_type || '').toLowerCase();
      const unit = (p.unit_symbol || '').toLowerCase();
      if (type === 'bag' || (!['bottle', 'pouch', 'container', 'drum'].includes(type) && ['kg', 'g', 'gm'].includes(unit))) {
        bagPkgs.push(p);
      } else if (type === 'bottle' || ['l', 'ml', 'lt', 'liter', 'litre'].includes(unit)) {
        bottlePkgs.push(p);
      } else if (type === 'pouch' || type === 'packet') {
        pouchPkgs.push(p);
      } else if (type === 'container' || type === 'drum' || type === 'box') {
        containerPkgs.push(p);
      } else {
        otherPkgs.push(p);
      }
    });

    const makeOpt = (p) => {
      const isLoose = (p.packaging_type || '').toLowerCase() === 'loose';
      const label = p.label || (isLoose ? `Loose (${p.unit_symbol})` : `${p.package_size} ${p.unit_symbol} ${p.packaging_type}`);
      const val = `pkg_${p.id}`;
      const baseU = p.base_unit || (['l','ml','lt','liter','litre'].includes((p.unit_symbol||'').toLowerCase()) ? 'L' : 'kg');
      return `<option value="${val}" data-id="${p.id}" data-type="${p.packaging_type}" data-size="${p.package_size}" data-unit="${p.unit_symbol}" data-base="${baseU}" data-mult="${p.base_multiplier || p.package_size}">${label}</option>`;
    };

    let html = '';

    if (bagPkgs.length > 0) {
      html += '<optgroup label="📦 BAG / KG PACKAGES">';
      bagPkgs.forEach(p => { html += makeOpt(p); });
      html += '</optgroup>';
    }

    if (bottlePkgs.length > 0) {
      html += '<optgroup label="💧 LIQUID / BOTTLE PACKAGES">';
      bottlePkgs.forEach(p => { html += makeOpt(p); });
      html += '</optgroup>';
    }

    if (pouchPkgs.length > 0) {
      html += '<optgroup label="🛍️ POUCH / PACKET PACKAGES">';
      pouchPkgs.forEach(p => { html += makeOpt(p); });
      html += '</optgroup>';
    }

    if (containerPkgs.length > 0) {
      html += '<optgroup label="🛢️ CONTAINER / DRUM PACKAGES">';
      containerPkgs.forEach(p => { html += makeOpt(p); });
      html += '</optgroup>';
    }

    if (otherPkgs.length > 0) {
      html += '<optgroup label="🌱 OTHER REUSABLE PACKAGES">';
      otherPkgs.forEach(p => { html += makeOpt(p); });
      html += '</optgroup>';
    }

    // Direct / Generic / Custom Units
    html += '<optgroup label="⚖️ MEASUREMENT UNITS & CUSTOM UNITS">';
    units.forEach(u => {
      const uSym = u.symbol || u.name;
      const uSymLower = uSym.toLowerCase();
      let baseUnit = uSym;
      let mult = 1.0;
      if (['kg', 'kilogram'].includes(uSymLower)) { baseUnit = 'kg'; mult = 1.0; }
      else if (['g', 'gm', 'gram'].includes(uSymLower)) { baseUnit = 'kg'; mult = 0.001; }
      else if (['mg', 'milligram'].includes(uSymLower)) { baseUnit = 'kg'; mult = 0.000001; }
      else if (['ton', 'tonne'].includes(uSymLower)) { baseUnit = 'Ton'; mult = 1000.0; }
      else if (['l', 'lt', 'liter', 'litre'].includes(uSymLower)) { baseUnit = 'L'; mult = 1.0; }
      else if (['ml', 'milliliter'].includes(uSymLower)) { baseUnit = 'L'; mult = 0.001; }
      
      html += `<option value="gen_${u.id}_${uSymLower}" data-type="Unit" data-size="1" data-unit="${uSym}" data-base="${baseUnit}" data-mult="${mult}">${u.name} (${uSym})</option>`;
    });
    html += '</optgroup>';

    sel.innerHTML = html;

    // Restore previously selected option or select default (25 kg Bag)
    let restored = false;
    if (currentDataType && currentDataSize) {
      for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        if (o.dataset.type === currentDataType && 
            Math.abs(parseFloat(o.dataset.size) - parseFloat(currentDataSize)) < 0.001 &&
            (o.dataset.unit || '').toLowerCase() === (currentDataUnit || '').toLowerCase()) {
          sel.selectedIndex = i;
          restored = true;
          break;
        }
      }
    }
    if (!restored) {
      const defaultOpt = Array.from(sel.options).find(o => 
        (o.dataset.type || '').toLowerCase() === 'bag' && Math.abs(parseFloat(o.dataset.size) - 25) < 0.001
      ) || sel.options[0];
      if (defaultOpt) sel.value = defaultOpt.value;
    }
  },

  setSelectCaseInsensitive(selectEl, targetValue) {
    if (!selectEl || targetValue === undefined || targetValue === null) return false;
    const targetStr = String(targetValue).trim().toLowerCase();
    for (let i = 0; i < selectEl.options.length; i++) {
      const opt = selectEl.options[i];
      if (opt.value.trim().toLowerCase() === targetStr || opt.text.trim().toLowerCase() === targetStr) {
        selectEl.selectedIndex = i;
        return true;
      }
    }
    for (let i = 0; i < selectEl.options.length; i++) {
      const opt = selectEl.options[i];
      if ((opt.dataset.unit && opt.dataset.unit.trim().toLowerCase() === targetStr) ||
          (opt.dataset.symbol && opt.dataset.symbol.trim().toLowerCase() === targetStr)) {
        selectEl.selectedIndex = i;
        return true;
      }
    }
    return false;
  },

  openPackageModal(packageId = null) {
    const form = document.getElementById('formPackage');
    if (form) form.reset();
    const idInput = document.getElementById('packageEditId');
    const titleEl = document.getElementById('modalPackageTitle');
    const statusSel = document.getElementById('pkgStatus');
    
    if (packageId) {
      const pkg = (this.state.packages || []).find(p => p.id === parseInt(packageId, 10));
      if (pkg) {
        if (idInput) idInput.value = pkg.id;
        if (titleEl) titleEl.textContent = 'Edit Package Size / Unit';
        const typeEl = document.getElementById('pkgPackagingType');
        if (typeEl) typeEl.value = pkg.packaging_type;
        const sizeEl = document.getElementById('pkgSize');
        if (sizeEl) sizeEl.value = pkg.package_size;
        const unitEl = document.getElementById('pkgUnit');
        if (unitEl) this.setSelectCaseInsensitive(unitEl, pkg.unit_symbol);
        if (statusSel) statusSel.value = pkg.is_active ? 'true' : 'false';
        this.updatePkgPreview();
        this.openModal('modalPackage');
        return;
      }
    }
    if (idInput) idInput.value = '';
    if (titleEl) titleEl.textContent = 'Add Package Size / Unit';
    if (statusSel) statusSel.value = 'true';
    this.updatePkgPreview();
    this.openModal('modalPackage');
  },

  updatePkgPreview() {
    const pkgPreview = document.getElementById('pkgPreviewText');
    if (!pkgPreview) return;
    const type = document.getElementById('pkgPackagingType')?.value || 'Bag';
    const size = document.getElementById('pkgSize')?.value || '50';
    const unit = document.getElementById('pkgUnit')?.value || 'kg';
    if (type.toLowerCase() === 'loose') {
      pkgPreview.textContent = `Loose (${unit.toUpperCase()})`;
    } else {
      pkgPreview.textContent = `${size} ${unit} ${type}`;
    }
  },

  // ── Router ─────────────────────────────────────────────────────────────────
  navigate(viewName, params = {}) {
    let hash = `#${viewName}`;
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      hash += `?${qs}`;
    }
    window.location.hash = hash;
  },

  handleRouting() {
    const raw = window.location.hash.replace('#', '') || 'dashboard';
    const [viewName, queryString] = raw.split('?');
    if (viewName === 'settings' && queryString && window.SettingsView) {
      const params = new URLSearchParams(queryString);
      const tab = params.get('tab');
      if (tab) window.SettingsView.tab = tab;
    }
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
      reorders: 'Stock Reorders & Replenishment',
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
    if (modal) {
      modal.classList.remove('open');
      if (modal.id === 'modalPackage') {
        const idIn = document.getElementById('packageEditId');
        if (idIn) idIn.value = '';
        const f = document.getElementById('formPackage');
        if (f) f.reset();
      }
      if (modal.id === 'modalUnit') {
        const idIn = document.getElementById('unitEditId');
        if (idIn) idIn.value = '';
        const f = document.getElementById('formUnit');
        if (f) f.reset();
      }
    }
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
    setInterval(() => this.fetchUnreadCount(), 10000); // Fast 10s poll for immediate stock warnings
    // Request browser notification permission if not yet decided
    if ('Notification' in window && Notification.permission === 'default') {
      setTimeout(() => Notification.requestPermission(), 3000);
    }
  },

  async fetchUnreadCount() {
    try {
      const res = await fetch('/api/notifications?unread_only=true&per_page=10');
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

        // Update Pending Reorders Badge
        fetch('/api/reorders?status=Pending&per_page=1')
          .then(r => r.json())
          .then(rData => {
            const reorderBadge = document.getElementById('navReorderBadge');
            if (reorderBadge) {
              const pendingCount = rData.pending_count || 0;
              if (pendingCount > 0) {
                reorderBadge.textContent = pendingCount;
                reorderBadge.style.display = 'inline-block';
              } else {
                reorderBadge.style.display = 'none';
              }
            }
          })
          .catch(() => {});

        // Trigger Immediate Stock Alerts
        const urgentAlerts = data.urgent_alerts || (data.notifications || []).filter(n => n.type === 'low_stock' || n.type === 'out_of_stock');
        if (urgentAlerts.length > 0) {
          if (!this.state.seenAlertIds) this.state.seenAlertIds = new Set();
          urgentAlerts.forEach(alert => {
            if (!this.state.seenAlertIds.has(alert.id)) {
              this.state.seenAlertIds.add(alert.id);
              this.showImmediateStockAlert(alert);
            }
          });
        }
      }
    } catch {}
  },

  showImmediateStockAlert(alert) {
    const isOut = alert.type === 'out_of_stock';
    const toast = document.createElement('div');
    toast.className = 'toast toast-error toast-stock-alert';
    toast.style.cssText = `
      background: ${isOut ? '#991b1b' : '#b45309'}; 
      color: #fff; 
      padding: 0.9rem 1.1rem; 
      border-radius: 8px; 
      box-shadow: 0 10px 25px rgba(0,0,0,0.35); 
      border: 1.5px solid ${isOut ? '#fca5a5' : '#fcd34d'}; 
      margin-bottom: 0.6rem; 
      max-width: 420px;
    `;
    const waText = encodeURIComponent(`🚨 Tiger Farm Stock Alert: ${alert.title}\n${alert.message}\nPlease arrange stock delivery.`);
    toast.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
        <strong style="font-size:0.92rem; display:flex; align-items:center; gap:0.35rem;">
          <span>${isOut ? '⛔' : '⚠️'}</span> ${alert.title}
        </strong>
        <button style="background:none; border:none; color:#fff; font-size:1.2rem; cursor:pointer; line-height:1; opacity:0.8;" onclick="this.closest('.toast-stock-alert').remove()">&times;</button>
      </div>
      <div style="font-size:0.83rem; margin:0.35rem 0 0.65rem; opacity:0.95; line-height:1.35;">
        ${alert.message}
      </div>
      <div style="display:flex; gap:0.4rem; justify-content:flex-end; align-items:center;">
        <a href="https://wa.me/?text=${waText}" target="_blank" class="btn btn-sm" style="background:#25D366; color:#fff; border:none; padding:0.25rem 0.6rem; font-size:0.75rem;">📲 WhatsApp Alert</a>
        <button class="btn btn-sm" style="background:#fff; color:#991b1b; font-weight:700; border:none; padding:0.25rem 0.65rem; font-size:0.75rem;" onclick="App.triggerReorderFromAlert(${alert.product_id}); this.closest('.toast-stock-alert').remove();">+ Reorder Now</button>
      </div>
    `;
    const container = document.getElementById('toastContainer');
    if (container) container.appendChild(toast);

    // Browser Native Push Notification (Desktop & Mobile)
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`🚨 ${alert.title}`, {
          body: alert.message,
          icon: '/favicon.ico',
        });
      } catch (_) {}
    }
  },

  triggerReorderFromAlert(productId) {
    if (!productId) return;
    const form = document.getElementById('formPurchase');
    if (form) form.reset();
    const today = new Date().toISOString().split('T')[0];
    const dIn = document.getElementById('purchaseDate');
    if (dIn) dIn.value = today;

    const pSelect = document.getElementById('purchaseProduct');
    if (pSelect) {
      pSelect.value = productId;
      if (typeof this.syncPurchasePackagingUI === 'function') {
        this.syncPurchasePackagingUI(true);
      }
    }
    this.openModal('modalPurchase');
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
        const view = navBtn.dataset.view;
        const tab = navBtn.dataset.tab;
        if (view === 'settings' && tab && window.SettingsView) {
          window.SettingsView.tab = tab;
        }
        this.navigate(view, tab ? { tab } : {});
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
        try {
          sessionStorage.clear();
          localStorage.clear();
        } catch (_) {}
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/';
      }
    };

    ['btnLogout', 'btnMobileLogout', 'btnMobileLogoutFooter'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', handleLogout);
    });

    // Helper: Offset Date for Quick Selection
    const getOffsetDate = (daysAgo = 0) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().split('T')[0];
    };

    // Quick Date chips for Purchase Modal
    document.getElementById('btnPurchDateToday')?.addEventListener('click', () => {
      const el = document.getElementById('purchaseDate');
      if (el) { el.value = getOffsetDate(0); el.style.borderColor = ''; }
    });
    document.getElementById('btnPurchDateYesterday')?.addEventListener('click', () => {
      const el = document.getElementById('purchaseDate');
      if (el) { el.value = getOffsetDate(1); el.style.borderColor = ''; }
    });
    document.getElementById('btnPurchDatePrev')?.addEventListener('click', () => {
      const el = document.getElementById('purchaseDate');
      if (el) { el.value = getOffsetDate(2); el.style.borderColor = ''; }
    });

    // Quick Date chips for Usage Modal
    document.getElementById('btnUsageDateToday')?.addEventListener('click', () => {
      const el = document.getElementById('usageDate');
      if (el) { el.value = getOffsetDate(0); el.style.borderColor = ''; }
    });
    document.getElementById('btnUsageDateYesterday')?.addEventListener('click', () => {
      const el = document.getElementById('usageDate');
      if (el) { el.value = getOffsetDate(1); el.style.borderColor = ''; }
    });
    document.getElementById('btnUsageDatePrev')?.addEventListener('click', () => {
      const el = document.getElementById('usageDate');
      if (el) { el.value = getOffsetDate(2); el.style.borderColor = ''; }
    });

    // Clear alert border on date change
    ['purchaseDate', 'usageDate'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        e.target.style.borderColor = '';
      });
    });

    // Steppers (+ / - buttons) for Purchase Quantity
    document.getElementById('btnPurchasePlus')?.addEventListener('click', () => {
      const inEl = document.getElementById('purchasePkgCount');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 0;
      inEl.value = Math.max(1, Math.round(cur + 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('btnPurchaseMinus')?.addEventListener('click', () => {
      const inEl = document.getElementById('purchasePkgCount');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 1;
      inEl.value = Math.max(1, Math.round(cur - 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Steppers (+ / - buttons) for Usage Quantity
    document.getElementById('btnUsagePlus')?.addEventListener('click', () => {
      const inEl = document.getElementById('usagePkgCount');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 0;
      inEl.value = Math.max(1, Math.round(cur + 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('btnUsageMinus')?.addEventListener('click', () => {
      const inEl = document.getElementById('usagePkgCount');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 1;
      inEl.value = Math.max(1, Math.round(cur - 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Steppers (+ / - buttons) for Product Bag Quantity
    document.getElementById('btnProductBagPlus')?.addEventListener('click', () => {
      const inEl = document.getElementById('productBagQuantity');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 0;
      inEl.value = Math.max(0, Math.round(cur + 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('btnProductBagMinus')?.addEventListener('click', () => {
      const inEl = document.getElementById('productBagQuantity');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 0;
      inEl.value = Math.max(0, Math.round(cur - 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Steppers (+ / - buttons) for Stock Adjustment Quantity
    document.getElementById('btnAdjustPlus')?.addEventListener('click', () => {
      const inEl = document.getElementById('adjustPkgCount');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 0;
      inEl.value = Math.max(1, Math.round(cur + 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('btnAdjustMinus')?.addEventListener('click', () => {
      const inEl = document.getElementById('adjustPkgCount');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 1;
      inEl.value = Math.max(1, Math.round(cur - 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Quick Date chips for Adjustment Modal
    document.getElementById('btnAdjustDateToday')?.addEventListener('click', () => {
      const el = document.getElementById('adjustDate');
      if (el) { el.value = getOffsetDate(0); el.style.borderColor = ''; }
    });
    document.getElementById('btnAdjustDateYesterday')?.addEventListener('click', () => {
      const el = document.getElementById('adjustDate');
      if (el) { el.value = getOffsetDate(1); el.style.borderColor = ''; }
    });

    // Quick Date chips & Steppers for Reorders
    document.getElementById('btnReorderDateToday')?.addEventListener('click', () => {
      const el = document.getElementById('reorderDate');
      if (el) { el.value = getOffsetDate(0); el.style.borderColor = ''; }
    });
    document.getElementById('btnReorderDateYesterday')?.addEventListener('click', () => {
      const el = document.getElementById('reorderDate');
      if (el) { el.value = getOffsetDate(1); el.style.borderColor = ''; }
    });
    document.getElementById('btnReorderPlus')?.addEventListener('click', () => {
      const inEl = document.getElementById('reorderPkgCount');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 0;
      inEl.value = Math.max(1, Math.round(cur + 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('btnReorderMinus')?.addEventListener('click', () => {
      const inEl = document.getElementById('reorderPkgCount');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 1;
      inEl.value = Math.max(1, Math.round(cur - 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Steppers for Receive Reorder
    document.getElementById('btnReceivePlus')?.addEventListener('click', () => {
      const inEl = document.getElementById('receiveReorderQty');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 0;
      inEl.value = Math.round((cur + 1) * 100) / 100;
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('btnReceiveMinus')?.addEventListener('click', () => {
      const inEl = document.getElementById('receiveReorderQty');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 1;
      inEl.value = Math.max(0.01, Math.round((cur - 1) * 100) / 100);
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Steppers for Add Stock
    document.getElementById('btnAddStockPlus')?.addEventListener('click', () => {
      const inEl = document.getElementById('addStockCount');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 0;
      inEl.value = Math.max(1, Math.round(cur + 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('btnAddStockMinus')?.addEventListener('click', () => {
      const inEl = document.getElementById('addStockCount');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 1;
      inEl.value = Math.max(1, Math.round(cur - 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Quick Date chips for Add Stock
    document.getElementById('btnAddStockDateToday')?.addEventListener('click', () => {
      const el = document.getElementById('addStockDate');
      if (el) { el.value = getOffsetDate(0); el.style.borderColor = ''; }
    });
    document.getElementById('btnAddStockDateYesterday')?.addEventListener('click', () => {
      const el = document.getElementById('addStockDate');
      if (el) { el.value = getOffsetDate(1); el.style.borderColor = ''; }
    });

    // Steppers for Edit Stock
    document.getElementById('btnEditStockPlus')?.addEventListener('click', () => {
      const inEl = document.getElementById('editStockTargetQty');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 0;
      inEl.value = Math.max(0, Math.round(cur + 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('btnEditStockMinus')?.addEventListener('click', () => {
      const inEl = document.getElementById('editStockTargetQty');
      if (!inEl) return;
      const cur = parseFloat(inEl.value) || 0;
      inEl.value = Math.max(0, Math.round(cur - 1));
      inEl.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Quick Date chips for Edit Stock
    document.getElementById('btnEditStockDateToday')?.addEventListener('click', () => {
      const el = document.getElementById('editStockDate');
      if (el) { el.value = getOffsetDate(0); el.style.borderColor = ''; }
    });
    document.getElementById('btnEditStockDateYesterday')?.addEventListener('click', () => {
      const el = document.getElementById('editStockDate');
      if (el) { el.value = getOffsetDate(1); el.style.borderColor = ''; }
    });

    // Payment status change toggle due date
    document.getElementById('purchasePaymentStatus')?.addEventListener('change', (e) => {
      const dueGroup = document.getElementById('purchaseDueDateGroup');
      if (dueGroup) {
        dueGroup.style.display = (e.target.value === 'Pending Credit' || e.target.value === 'Partial') ? 'block' : 'none';
      }
    });

    // Price comparison on unit price input
    document.getElementById('purchaseUnitPrice')?.addEventListener('input', () => {
      this.recalcRateComparison();
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

    // Quick Purchase form submit — Strict database confirmation & compulsory date check
    const fPurchase = document.getElementById('formPurchase');
    if (fPurchase) {
      fPurchase.addEventListener('submit', async (e) => {
        e.preventDefault();

        const purchDateIn = document.getElementById('purchaseDate');
        if (!purchDateIn || !purchDateIn.value.trim()) {
          this.showToast('Purchase Date is compulsory! Please select the date.', 'error');
          if (purchDateIn) {
            purchDateIn.focus();
            purchDateIn.style.borderColor = 'var(--red)';
          }
          return;
        }

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

    // Quick Usage form submit — Strict database confirmation & compulsory date check
    const fUsage = document.getElementById('formUsage');
    if (fUsage) {
      fUsage.addEventListener('submit', async (e) => {
        e.preventDefault();

        const usageDateIn = document.getElementById('usageDate');
        if (!usageDateIn || !usageDateIn.value.trim()) {
          this.showToast('Usage Date is compulsory! Please select the date.', 'error');
          if (usageDateIn) {
            usageDateIn.focus();
            usageDateIn.style.borderColor = 'var(--red)';
          }
          return;
        }

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
          crop_season: document.getElementById('usageCropSeason')?.value || '',
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
            const pkgData = data.package || data.data;
            this.showToast(data.message || (editId ? 'Package size updated successfully.' : 'Package size added to Package Master!'));
            this.closeModal('modalPackage');
            await this.loadMetadata();

            // Auto-select in Add/Edit Product dropdown if product modal is open
            const prodModal = document.getElementById('modalProduct');
            if (prodModal && prodModal.classList.contains('open') && pkgData) {
              const sel = document.getElementById('productUnitPackage');
              if (sel) {
                for (let i = 0; i < sel.options.length; i++) {
                  const o = sel.options[i];
                  if ((o.dataset.id && parseInt(o.dataset.id, 10) === pkgData.id) ||
                      (o.dataset.type === pkgData.packaging_type &&
                       Math.abs(parseFloat(o.dataset.size) - parseFloat(pkgData.package_size)) < 0.001 &&
                       (o.dataset.unit || '').toLowerCase() === (pkgData.unit_symbol || '').toLowerCase())) {
                    sel.selectedIndex = i;
                    if (typeof window.updateOpeningStockCalc === 'function') {
                      window.updateOpeningStockCalc();
                    }
                    break;
                  }
                }
              }
            }

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

    // Stock Adjustment form submit
    const fAdjust = document.getElementById('formAdjustment');
    if (fAdjust) {
      fAdjust.addEventListener('submit', async (e) => {
        e.preventDefault();
        const adjustDateIn = document.getElementById('adjustDate');
        if (!adjustDateIn || !adjustDateIn.value.trim()) {
          this.showToast('Adjustment Date is compulsory! Please select the date.', 'error');
          if (adjustDateIn) {
            adjustDateIn.focus();
            adjustDateIn.style.borderColor = 'var(--red)';
          }
          return;
        }

        const btn = document.getElementById('btnSubmitAdjustment');
        btn.disabled = true;
        btn.textContent = 'Recording Adjustment...';

        const payload = {
          product_id: document.getElementById('adjustProduct').value,
          adjustment_type: document.getElementById('adjustType').value,
          reason: document.getElementById('adjustReason').value,
          packaging_type: document.getElementById('adjustPkgType').value,
          package_size: document.getElementById('adjustPkgSize').value,
          package_unit: document.getElementById('adjustPkgUnit').value,
          package_count: document.getElementById('adjustPkgCount').value,
          quantity: document.getElementById('adjustQty').value,
          adjustment_date: document.getElementById('adjustDate').value,
          remarks: document.getElementById('adjustRemarks').value,
        };

        try {
          const res = await fetch('/api/stock/adjust', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            this.showToast(data.message || 'Stock adjustment recorded successfully!');
            this.closeModal('modalAdjustment');
            await this.loadMetadata();
            if (this.views[this.state.currentView]?.refresh) {
              this.views[this.state.currentView].refresh();
            }
          } else {
            this.showToast(data.message || data.error || 'Adjustment failed.', 'error');
          }
        } catch (err) {
          this.showToast('Server error during adjustment: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Confirm Adjustment';
        }
      });
    }

    // Form Reorder Submit
    const fReorder = document.getElementById('formReorder');
    if (fReorder) {
      fReorder.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rProdIn = document.getElementById('reorderProduct');
        const rDateIn = document.getElementById('reorderDate');
        const rCountIn = document.getElementById('reorderPkgCount');
        if (!rProdIn || !rProdIn.value) {
          this.showToast('Please select a product to reorder.', 'error');
          return;
        }
        if (!rDateIn || !rDateIn.value.trim()) {
          this.showToast('Reorder Date is compulsory! Please select the date.', 'error');
          rDateIn?.focus();
          return;
        }
        const count = parseFloat(rCountIn?.value) || 0;
        if (count <= 0) {
          this.showToast('Please enter a valid reorder quantity greater than zero.', 'error');
          rCountIn?.focus();
          return;
        }

        const btn = document.getElementById('btnSubmitReorder');
        btn.disabled = true;
        btn.textContent = 'Saving Reorder Request...';

        const payload = {
          product_id: parseInt(rProdIn.value, 10),
          packaging_type: document.getElementById('reorderPkgType')?.value || 'Bag',
          package_size: parseFloat(document.getElementById('reorderPkgSize')?.value) || 0,
          package_count: count,
          reorder_date: rDateIn.value,
          expected_delivery_date: document.getElementById('reorderExpectedDelivery')?.value || null,
          supplier_name: document.getElementById('reorderSupplier')?.value || null,
          unit_price: parseFloat(document.getElementById('reorderUnitPrice')?.value) || null,
          notes: document.getElementById('reorderNotes')?.value || null,
        };

        try {
          const res = await fetch('/api/reorders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            this.showToast(data.message || 'Reorder request created successfully (Status: Pending)!');
            this.closeModal('modalReorder');
            await this.loadMetadata();
            if (this.views[this.state.currentView]?.refresh) {
              this.views[this.state.currentView].refresh();
            }
          } else {
            this.showToast(data.message || data.error || 'Failed to create reorder.', 'error');
          }
        } catch (err) {
          this.showToast('Error saving reorder: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Save Reorder Request';
        }
      });
    }

    // Form Receive Reorder Submit
    const fReceive = document.getElementById('formReceiveReorder');
    if (fReceive) {
      fReceive.addEventListener('submit', async (e) => {
        e.preventDefault();
        const reorderId = document.getElementById('receiveReorderId')?.value;
        const qtyIn = document.getElementById('receiveReorderQty');
        const qty = parseFloat(qtyIn?.value) || 0;
        if (!reorderId) {
          this.showToast('Missing reorder ID.', 'error');
          return;
        }
        if (qty <= 0) {
          this.showToast('Please enter a received quantity greater than 0.', 'error');
          qtyIn?.focus();
          return;
        }

        const btn = document.getElementById('btnConfirmReceive');
        btn.disabled = true;
        btn.textContent = 'Updating Inventory Stock...';

        try {
          const res = await fetch(`/api/reorders/${reorderId}/receive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ received_quantity: qty }),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            this.showToast(data.message || `Reorder #${reorderId} received and stock updated!`);
            this.closeModal('modalReceiveReorder');
            await this.loadMetadata();
            if (this.views[this.state.currentView]?.refresh) {
              this.views[this.state.currentView].refresh();
            }
          } else {
            this.showToast(data.message || data.error || 'Failed to receive reorder.', 'error');
          }
        } catch (err) {
          this.showToast('Error receiving reorder: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Confirm & Update Stock';
        }
      });
    }

    // Dedicated Add Stock Submit (Step 2)
    const fAddStock = document.getElementById('formAddStock');
    if (fAddStock) {
      fAddStock.addEventListener('submit', async (e) => {
        e.preventDefault();
        const prodIn = document.getElementById('addStockProduct');
        const dateIn = document.getElementById('addStockDate');
        const countIn = document.getElementById('addStockCount');

        if (!prodIn || !prodIn.value) {
          this.showToast('Please select a product.', 'error');
          return;
        }
        if (!dateIn || !dateIn.value.trim()) {
          this.showToast('Date is compulsory! Please select the date.', 'error');
          dateIn?.focus();
          return;
        }
        const count = parseFloat(countIn?.value) || 0;
        if (count <= 0) {
          this.showToast('Please enter a quantity greater than zero.', 'error');
          countIn?.focus();
          return;
        }

        const btn = document.getElementById('btnSubmitAddStock');
        btn.disabled = true;
        btn.textContent = 'Saving Stock to Database...';

        const payload = {
          product_id: parseInt(prodIn.value, 10),
          packaging_type: document.getElementById('addStockPkgType')?.value || 'Bag',
          package_size: parseFloat(document.getElementById('addStockPkgSize')?.value) || 0,
          package_count: count,
          adjustment_date: dateIn.value,
          reason: document.getElementById('addStockReason')?.value || 'Physical Count Surplus',
          remarks: document.getElementById('addStockRemarks')?.value || '',
        };

        try {
          const res = await fetch('/api/stock/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            this.showToast(data.message || 'Stock successfully added and verified in database!');
            this.closeModal('modalAddStock');
            await this.loadMetadata();
            if (this.views[this.state.currentView]?.refresh) {
              this.views[this.state.currentView].refresh();
            }
          } else {
            this.showToast(data.message || data.error || 'Failed to add stock.', 'error');
          }
        } catch (err) {
          this.showToast('Error adding stock: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Add Stock Permanently';
        }
      });
    }

    // Dedicated Edit Stock Submit (Step 2)
    const fEditStock = document.getElementById('formEditStock');
    if (fEditStock) {
      fEditStock.addEventListener('submit', async (e) => {
        e.preventDefault();
        const prodIn = document.getElementById('editStockProduct');
        const dateIn = document.getElementById('editStockDate');
        const targetIn = document.getElementById('editStockTargetQty');

        if (!prodIn || !prodIn.value) {
          this.showToast('Please select a product.', 'error');
          return;
        }
        if (!dateIn || !dateIn.value.trim()) {
          this.showToast('Date is compulsory! Please select the date.', 'error');
          dateIn?.focus();
          return;
        }
        const targetQty = parseFloat(targetIn?.value);
        if (isNaN(targetQty) || targetQty < 0) {
          this.showToast('Please enter a valid stock quantity (0 or greater).', 'error');
          targetIn?.focus();
          return;
        }

        const btn = document.getElementById('btnSubmitEditStock');
        btn.disabled = true;
        btn.textContent = 'Updating Stock in Database...';

        const payload = {
          product_id: parseInt(prodIn.value, 10),
          target_quantity: targetQty,
          adjustment_date: dateIn.value,
          reason: document.getElementById('editStockReason')?.value || 'Physical Audit Reconciliation',
          remarks: document.getElementById('editStockRemarks')?.value || '',
        };

        try {
          const res = await fetch('/api/stock/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            this.showToast(data.message || 'Stock record corrected successfully!');
            this.closeModal('modalEditStock');
            await this.loadMetadata();
            if (this.views[this.state.currentView]?.refresh) {
              this.views[this.state.currentView].refresh();
            }
          } else {
            this.showToast(data.message || data.error || 'Failed to edit stock.', 'error');
          }
        } catch (err) {
          this.showToast('Error editing stock: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Save Stock Correction';
        }
      });
    }
    document.getElementById('btnCopyDigest')?.addEventListener('click', () => {
      const content = document.getElementById('digestContent')?.textContent || '';
      if (!content) return;
      navigator.clipboard.writeText(content).then(() => {
        this.showToast('Daily Farm Digest copied to clipboard!');
      }).catch(() => {
        this.showToast('Failed to copy to clipboard.', 'error');
      });
    });

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

    pProd?.addEventListener('change', () => {
      this.syncPurchasePackagingUI();
      this.checkLastPurchasePrice(pProd.value);
    });
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

    // 3. Stock Adjustment packaging setup
    const aProd = document.getElementById('adjustProduct');
    const aPkgType = document.getElementById('adjustPkgType');
    const aPkgSize = document.getElementById('adjustPkgSize');
    const aPkgCount = document.getElementById('adjustPkgCount');
    const aType = document.getElementById('adjustType');

    aProd?.addEventListener('change', () => this.syncAdjustPackagingUI());
    aPkgType?.addEventListener('change', () => this.syncAdjustPackagingSizes());
    aPkgSize?.addEventListener('change', () => this.recalcAdjustTotal());
    aPkgCount?.addEventListener('input', () => this.recalcAdjustTotal());
    aType?.addEventListener('change', () => {
      const badge = document.getElementById('adjustCalcBadge');
      if (badge) {
        if (aType.value === 'addition') {
          badge.textContent = 'Stock Addition';
          badge.style.background = 'var(--green-mid)';
        } else {
          badge.textContent = 'Stock Deduction';
          badge.style.background = 'var(--red)';
        }
      }
      this.recalcAdjustTotal();
    });

    // 4. Reorder packaging setup
    const rProd = document.getElementById('reorderProduct');
    const rPkgType = document.getElementById('reorderPkgType');
    const rPkgSize = document.getElementById('reorderPkgSize');
    const rPkgCount = document.getElementById('reorderPkgCount');

    rProd?.addEventListener('change', () => this.syncReorderPackagingUI());
    rPkgType?.addEventListener('change', () => this.syncReorderPackagingSizes());
    rPkgSize?.addEventListener('change', () => this.recalcReorderTotal());
    rPkgCount?.addEventListener('input', () => this.recalcReorderTotal());

    // 5. Add Stock packaging setup
    const asProd = document.getElementById('addStockProduct');
    const asPkgType = document.getElementById('addStockPkgType');
    const asPkgSize = document.getElementById('addStockPkgSize');
    const asCount = document.getElementById('addStockCount');

    asProd?.addEventListener('change', () => this.syncAddStockPackagingUI());
    asPkgType?.addEventListener('change', () => this.syncAddStockPackagingSizes());
    asPkgSize?.addEventListener('change', () => this.recalcAddStockTotal());
    asCount?.addEventListener('input', () => this.recalcAddStockTotal());

    // 6. Edit Stock setup
    const esProd = document.getElementById('editStockProduct');
    const esTarget = document.getElementById('editStockTargetQty');

    esProd?.addEventListener('change', () => this.syncEditStockUI());
    esTarget?.addEventListener('input', () => this.recalcEditStockDiff());

    this.initVoiceTyping();

    // Quick Add Package from Add Product modal
    document.getElementById('btnQuickAddPackage')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openPackageModal();
    });

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

  syncPurchasePackagingUI(forceDefault = false) {
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
    const catName = (prod && prod.category) ? prod.category.toLowerCase() : '';
    const isLiquid = (baseUnit === 'l' || baseUnit === 'ml' || baseUnit === 'liter' || baseUnit === 'litre' || catName.includes('liquid') || (prod && prod.name.toLowerCase().includes('liquid')));

    if (pUnitHidden && prod) pUnitHidden.value = prod.unit_id || '';

    // Rebuild packaging type options matching this product category (Liquid vs Solid)
    const prevType = pPkgType.value;
    if (isLiquid) {
      pPkgType.innerHTML = `
        <option value="Bottle">Bottle (Liter / L / ml)</option>
        <option value="Container">Can / Container (Liter / L)</option>
        <option value="Drum">Drum / Barrel (Liter / L)</option>
        <option value="Pouch">Pouch / Packet (L / ml)</option>
        <option value="Loose">Loose / Direct Liters (L)</option>
      `;
    } else {
      pPkgType.innerHTML = `
        <option value="Bag">Bag (KG Packages)</option>
        <option value="Pouch">Pouch / Packet (KG / g)</option>
        <option value="Container">Box / Container (KG)</option>
        <option value="Drum">Drum (KG)</option>
        <option value="Loose">Loose / Direct Kilograms (KG)</option>
      `;
    }

    if (forceDefault || document.activeElement === pProd || !prevType) {
      const smartDefault = (prod && prod.default_packaging_type) ? prod.default_packaging_type : (isLiquid ? 'Bottle' : 'Bag');
      pPkgType.value = smartDefault;
    } else {
      const hasPrev = Array.from(pPkgType.options).some(o => o.value.toLowerCase() === prevType.toLowerCase());
      pPkgType.value = hasPrev ? prevType : (isLiquid ? 'Bottle' : 'Bag');
    }

    const selType = pPkgType.value || (isLiquid ? 'Bottle' : 'Bag');

    if (selType.toLowerCase() === 'loose') {
      if (pPkgSizeGroup) pPkgSizeGroup.style.display = 'none';
      const uLabel = isLiquid ? 'Liters (L)' : 'Kilograms (KG)';
      if (pCountLabel) pCountLabel.textContent = `4. Quantity (${uLabel} Direct) *`;
      if (pPriceLabel) pPriceLabel.textContent = `Unit Price (₹ per ${isLiquid ? 'Liter' : 'KG'})`;
      if (pPkgUnitHidden) pPkgUnitHidden.value = isLiquid ? 'L' : 'kg';
    } else {
      if (pPkgSizeGroup) pPkgSizeGroup.style.display = 'block';
      const unitTag = isLiquid ? 'L' : 'KG';
      const noun = isLiquid ? (selType === 'Bottle' ? 'Bottles' : `${selType}s`) : (selType === 'Bag' ? 'Bags' : `${selType}s`);
      if (pCountLabel) pCountLabel.textContent = `4. Quantity (Number of ${noun}) *`;
      if (pPriceLabel) pPriceLabel.textContent = `Unit Price (₹ per ${selType})`;

      // Populate package sizes for selected packaging type
      let matching = (this.state.packages || []).filter(p => p.packaging_type.toLowerCase() === selType.toLowerCase());
      if (isLiquid) {
        const liquidMatches = matching.filter(p => ['l', 'ml', 'litre', 'liter'].includes(p.unit_symbol.toLowerCase()));
        if (liquidMatches.length) matching = liquidMatches;
      } else {
        const weightMatches = matching.filter(p => ['kg', 'g', 'gm', 'ton'].includes(p.unit_symbol.toLowerCase()));
        if (weightMatches.length) matching = weightMatches;
      }

      // If no pre-configured sizes exist for this type, provide standard fallback sizes
      if (!matching.length) {
        if (isLiquid) {
          matching = [
            { package_size: 10, unit_symbol: 'ml', base_multiplier: 0.01, packaging_type: selType, label: `10 ml ${selType}` },
            { package_size: 25, unit_symbol: 'ml', base_multiplier: 0.025, packaging_type: selType, label: `25 ml ${selType}` },
            { package_size: 50, unit_symbol: 'ml', base_multiplier: 0.05, packaging_type: selType, label: `50 ml ${selType}` },
            { package_size: 100, unit_symbol: 'ml', base_multiplier: 0.1, packaging_type: selType, label: `100 ml ${selType}` },
            { package_size: 250, unit_symbol: 'ml', base_multiplier: 0.25, packaging_type: selType, label: `250 ml ${selType}` },
            { package_size: 500, unit_symbol: 'ml', base_multiplier: 0.5, packaging_type: selType, label: `500 ml ${selType}` },
            { package_size: 1, unit_symbol: 'L', base_multiplier: 1, packaging_type: selType, label: `1 L ${selType}` },
            { package_size: 2, unit_symbol: 'L', base_multiplier: 2, packaging_type: selType, label: `2 L ${selType}` },
            { package_size: 3, unit_symbol: 'L', base_multiplier: 3, packaging_type: selType, label: `3 L ${selType}` },
            { package_size: 5, unit_symbol: 'L', base_multiplier: 5, packaging_type: selType, label: `5 L ${selType}` },
            { package_size: 10, unit_symbol: 'L', base_multiplier: 10, packaging_type: selType, label: `10 L ${selType}` },
          ];
        } else {
          matching = [
            { package_size: 50, unit_symbol: 'g', base_multiplier: 0.05, packaging_type: selType, label: `50 g ${selType}` },
            { package_size: 100, unit_symbol: 'g', base_multiplier: 0.1, packaging_type: selType, label: `100 g ${selType}` },
            { package_size: 200, unit_symbol: 'g', base_multiplier: 0.2, packaging_type: selType, label: `200 g ${selType}` },
            { package_size: 250, unit_symbol: 'g', base_multiplier: 0.25, packaging_type: selType, label: `250 g ${selType}` },
            { package_size: 500, unit_symbol: 'g', base_multiplier: 0.5, packaging_type: selType, label: `500 g ${selType}` },
            { package_size: 1, unit_symbol: 'kg', base_multiplier: 1, packaging_type: selType, label: `1 kg ${selType}` },
            { package_size: 2, unit_symbol: 'kg', base_multiplier: 2, packaging_type: selType, label: `2 kg ${selType}` },
            { package_size: 5, unit_symbol: 'kg', base_multiplier: 5, packaging_type: selType, label: `5 kg ${selType}` },
            { package_size: 10, unit_symbol: 'kg', base_multiplier: 10, packaging_type: selType, label: `10 kg ${selType}` },
            { package_size: 20, unit_symbol: 'kg', base_multiplier: 20, packaging_type: selType, label: `20 kg ${selType}` },
            { package_size: 25, unit_symbol: 'kg', base_multiplier: 25, packaging_type: selType, label: `25 kg ${selType}` },
            { package_size: 40, unit_symbol: 'kg', base_multiplier: 40, packaging_type: selType, label: `40 kg ${selType}` },
            { package_size: 45, unit_symbol: 'kg', base_multiplier: 45, packaging_type: selType, label: `45 kg ${selType}` },
            { package_size: 50, unit_symbol: 'kg', base_multiplier: 50, packaging_type: selType, label: `50 kg ${selType}` },
          ];
        }
      }

      pPkgSize.innerHTML = matching.map(p =>
        `<option value="${p.package_size}" data-unit="${p.unit_symbol}" data-multiplier="${p.base_multiplier}">${p.label || `${p.package_size} ${p.unit_symbol} ${p.packaging_type}`}</option>`
      ).join('');

      // Auto select product's configured default bag/bottle size
      if (prod && prod.default_package_size) {
        const found = matching.find(p => Math.abs(p.package_size - prod.default_package_size) < 0.001);
        if (found) {
          pPkgSize.value = found.package_size;
          if (pPkgUnitHidden) pPkgUnitHidden.value = found.unit_symbol;
        } else if (matching.length && pPkgUnitHidden) {
          pPkgUnitHidden.value = matching[0].unit_symbol;
        }
      } else if (matching.length && pPkgUnitHidden) {
        pPkgUnitHidden.value = matching[0].unit_symbol;
      }

      // Auto select default quantity (e.g. 1 Bag or default count)
      const pPkgCount = document.getElementById('purchasePkgCount');
      if (prod && pPkgCount && (forceDefault || document.activeElement === pProd || !pPkgCount.value)) {
        pPkgCount.value = prod.default_package_count || 1;
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
          const liquidMatches = matching.filter(p => ['l', 'ml', 'litre', 'liter'].includes(p.unit_symbol.toLowerCase()));
          if (liquidMatches.length) matching = liquidMatches;
        } else {
          const weightMatches = matching.filter(p => ['kg', 'g', 'gm', 'ton'].includes(p.unit_symbol.toLowerCase()));
          if (weightMatches.length) matching = weightMatches;
        }
        if (!matching.length) {
          if (isLiquid) {
            matching = [
              { package_size: 10, unit_symbol: 'ml', base_multiplier: 0.01, packaging_type: selType, label: `10 ml ${selType}` },
              { package_size: 25, unit_symbol: 'ml', base_multiplier: 0.025, packaging_type: selType, label: `25 ml ${selType}` },
              { package_size: 50, unit_symbol: 'ml', base_multiplier: 0.05, packaging_type: selType, label: `50 ml ${selType}` },
              { package_size: 100, unit_symbol: 'ml', base_multiplier: 0.1, packaging_type: selType, label: `100 ml ${selType}` },
              { package_size: 250, unit_symbol: 'ml', base_multiplier: 0.25, packaging_type: selType, label: `250 ml ${selType}` },
              { package_size: 500, unit_symbol: 'ml', base_multiplier: 0.5, packaging_type: selType, label: `500 ml ${selType}` },
              { package_size: 1, unit_symbol: 'L', base_multiplier: 1, packaging_type: selType, label: `1 L ${selType}` },
              { package_size: 2, unit_symbol: 'L', base_multiplier: 2, packaging_type: selType, label: `2 L ${selType}` },
              { package_size: 5, unit_symbol: 'L', base_multiplier: 5, packaging_type: selType, label: `5 L ${selType}` },
            ];
          } else {
            matching = [
              { package_size: 50, unit_symbol: 'g', base_multiplier: 0.05, packaging_type: selType, label: `50 g ${selType}` },
              { package_size: 100, unit_symbol: 'g', base_multiplier: 0.1, packaging_type: selType, label: `100 g ${selType}` },
              { package_size: 200, unit_symbol: 'g', base_multiplier: 0.2, packaging_type: selType, label: `200 g ${selType}` },
              { package_size: 250, unit_symbol: 'g', base_multiplier: 0.25, packaging_type: selType, label: `250 g ${selType}` },
              { package_size: 500, unit_symbol: 'g', base_multiplier: 0.5, packaging_type: selType, label: `500 g ${selType}` },
              { package_size: 1, unit_symbol: 'kg', base_multiplier: 1, packaging_type: selType, label: `1 kg ${selType}` },
              { package_size: 2, unit_symbol: 'kg', base_multiplier: 2, packaging_type: selType, label: `2 kg ${selType}` },
              { package_size: 5, unit_symbol: 'kg', base_multiplier: 5, packaging_type: selType, label: `5 kg ${selType}` },
              { package_size: 10, unit_symbol: 'kg', base_multiplier: 10, packaging_type: selType, label: `10 kg ${selType}` },
              { package_size: 25, unit_symbol: 'kg', base_multiplier: 25, packaging_type: selType, label: `25 kg ${selType}` },
              { package_size: 50, unit_symbol: 'kg', base_multiplier: 50, packaging_type: selType, label: `50 kg ${selType}` },
            ];
          }
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

  // ── Stock Adjustment UI Sync & Calculations ──────────────────────────────
  syncAdjustPackagingUI() {
    const aProd = document.getElementById('adjustProduct');
    const aStockHint = document.getElementById('adjustStockHint');
    const aPkgType = document.getElementById('adjustPkgType');
    const aPkgUnitHidden = document.getElementById('adjustPkgUnit');
    const aUnitHidden = document.getElementById('adjustUnit');

    if (!aProd || !aPkgType) return;
    const prodId = aProd.value;
    const prod = this.state.products.find(p => p.id == prodId);
    if (!prod) {
      if (aStockHint) aStockHint.textContent = '';
      return;
    }

    const baseUnit = (prod.unit || 'kg').toLowerCase();
    const isLiquid = (baseUnit === 'l' || baseUnit === 'ml' || baseUnit === 'liter' || (prod.name || '').toLowerCase().includes('liquid'));

    if (aStockHint) {
      aStockHint.textContent = `Current Database Stock: ${prod.current_quantity} ${prod.unit || ''} (Min Threshold: ${prod.minimum_stock} ${prod.unit || ''})`;
    }
    if (aUnitHidden) aUnitHidden.value = prod.unit_id || '';

    // Rebuild packaging types
    if (isLiquid) {
      aPkgType.innerHTML = `
        <option value="Bottle" selected>Bottle (L / ml)</option>
        <option value="Container">Container / Can (L)</option>
        <option value="Drum">Drum (L)</option>
        <option value="Pouch">Pouch (L / ml)</option>
        <option value="Loose">Loose (L)</option>
      `;
    } else {
      aPkgType.innerHTML = `
        <option value="Bag" selected>Bag (kg Packages)</option>
        <option value="Pouch">Pouch / Packet (kg / g)</option>
        <option value="Container">Container / Box (kg)</option>
        <option value="Drum">Drum (kg)</option>
        <option value="Loose">Loose (kg)</option>
      `;
    }

    if (prod.default_packaging_type) {
      const opt = Array.from(aPkgType.options).find(o => o.value.toLowerCase() === prod.default_packaging_type.toLowerCase());
      if (opt) aPkgType.value = opt.value;
    }

    this.syncAdjustPackagingSizes();
  },

  syncAdjustPackagingSizes() {
    const aProd = document.getElementById('adjustProduct');
    const aPkgType = document.getElementById('adjustPkgType');
    const aPkgSize = document.getElementById('adjustPkgSize');
    const aPkgSizeGroup = document.getElementById('adjustPkgSizeGroup');
    const aPkgCountLabel = document.getElementById('adjustPkgCountLabel');
    const aPkgUnitHidden = document.getElementById('adjustPkgUnit');

    if (!aPkgType || !aPkgSize) return;

    const prodId = aProd?.value;
    const prod = this.state.products.find(p => p.id == prodId);
    const baseUnit = (prod && prod.unit) ? prod.unit.toLowerCase() : 'kg';
    const isLiquid = (baseUnit === 'l' || baseUnit === 'ml' || baseUnit === 'liter' || (prod && prod.name.toLowerCase().includes('liquid')));
    const selType = aPkgType.value || 'Bag';

    if (selType.toLowerCase() === 'loose') {
      if (aPkgSizeGroup) aPkgSizeGroup.style.display = 'none';
      if (aPkgCountLabel) aPkgCountLabel.textContent = `Quantity to Adjust (${isLiquid ? 'Liters Direct' : 'Kilograms Direct'}) *`;
      if (aPkgUnitHidden) aPkgUnitHidden.value = isLiquid ? 'L' : 'kg';
    } else {
      if (aPkgSizeGroup) aPkgSizeGroup.style.display = 'block';
      const noun = isLiquid ? (selType === 'Bottle' ? 'Bottles' : `${selType}s`) : (selType === 'Bag' ? 'Bags' : `${selType}s`);
      if (aPkgCountLabel) aPkgCountLabel.textContent = `Quantity to Adjust (Number of ${noun}) *`;

      let matching = (this.state.packages || []).filter(p => p.packaging_type.toLowerCase() === selType.toLowerCase());
      if (isLiquid) {
        const lMatches = matching.filter(p => ['l', 'ml', 'litre', 'liter'].includes(p.unit_symbol.toLowerCase()));
        if (lMatches.length) matching = lMatches;
      } else {
        const wMatches = matching.filter(p => ['kg', 'g', 'gm', 'ton'].includes(p.unit_symbol.toLowerCase()));
        if (wMatches.length) matching = wMatches;
      }

      if (!matching.length) {
        matching = isLiquid
          ? [
              { package_size: 10, unit_symbol: 'ml', base_multiplier: 0.01, label: `10 ml ${selType}` },
              { package_size: 25, unit_symbol: 'ml', base_multiplier: 0.025, label: `25 ml ${selType}` },
              { package_size: 50, unit_symbol: 'ml', base_multiplier: 0.05, label: `50 ml ${selType}` },
              { package_size: 100, unit_symbol: 'ml', base_multiplier: 0.1, label: `100 ml ${selType}` },
              { package_size: 250, unit_symbol: 'ml', base_multiplier: 0.25, label: `250 ml ${selType}` },
              { package_size: 500, unit_symbol: 'ml', base_multiplier: 0.5, label: `500 ml ${selType}` },
              { package_size: 1, unit_symbol: 'L', base_multiplier: 1, label: `1 L ${selType}` },
              { package_size: 2, unit_symbol: 'L', base_multiplier: 2, label: `2 L ${selType}` },
              { package_size: 5, unit_symbol: 'L', base_multiplier: 5, label: `5 L ${selType}` },
            ]
          : [
              { package_size: 50, unit_symbol: 'g', base_multiplier: 0.05, label: `50 g ${selType}` },
              { package_size: 100, unit_symbol: 'g', base_multiplier: 0.1, label: `100 g ${selType}` },
              { package_size: 200, unit_symbol: 'g', base_multiplier: 0.2, label: `200 g ${selType}` },
              { package_size: 250, unit_symbol: 'g', base_multiplier: 0.25, label: `250 g ${selType}` },
              { package_size: 500, unit_symbol: 'g', base_multiplier: 0.5, label: `500 g ${selType}` },
              { package_size: 1, unit_symbol: 'kg', base_multiplier: 1, label: `1 kg ${selType}` },
              { package_size: 2, unit_symbol: 'kg', base_multiplier: 2, label: `2 kg ${selType}` },
              { package_size: 5, unit_symbol: 'kg', base_multiplier: 5, label: `5 kg ${selType}` },
              { package_size: 10, unit_symbol: 'kg', base_multiplier: 10, label: `10 kg ${selType}` },
              { package_size: 25, unit_symbol: 'kg', base_multiplier: 25, label: `25 kg ${selType}` },
              { package_size: 50, unit_symbol: 'kg', base_multiplier: 50, label: `50 kg ${selType}` },
            ];
      }

      aPkgSize.innerHTML = matching.map(p =>
        `<option value="${p.package_size}" data-unit="${p.unit_symbol}" data-multiplier="${p.base_multiplier}">${p.label || `${p.package_size} ${p.unit_symbol} ${selType}`}</option>`
      ).join('');

      if (prod && prod.default_package_size) {
        const found = matching.find(p => p.package_size == prod.default_package_size);
        if (found) {
          aPkgSize.value = found.package_size;
          if (aPkgUnitHidden) aPkgUnitHidden.value = found.unit_symbol;
        } else if (matching.length && aPkgUnitHidden) {
          aPkgUnitHidden.value = matching[0].unit_symbol;
        }
      } else if (matching.length && aPkgUnitHidden) {
        aPkgUnitHidden.value = matching[0].unit_symbol;
      }
    }

    this.recalcAdjustTotal();
  },

  recalcAdjustTotal() {
    const aProd = document.getElementById('adjustProduct');
    const aPkgType = document.getElementById('adjustPkgType');
    const aPkgSize = document.getElementById('adjustPkgSize');
    const aPkgCount = document.getElementById('adjustPkgCount');
    const aQtyHidden = document.getElementById('adjustQty');
    const aPkgUnitHidden = document.getElementById('adjustPkgUnit');
    const aCalcResult = document.getElementById('adjustCalcResult');
    const aType = document.getElementById('adjustType');

    if (!aProd || !aPkgType || !aPkgCount || !aCalcResult) return;

    const prod = this.state.products.find(p => p.id == aProd.value);
    const baseSym = (prod && prod.unit) ? prod.unit : 'kg';
    const pkgType = aPkgType.value || 'Bag';
    const count = parseFloat(aPkgCount.value) || 0;
    const isDeduction = (aType?.value || 'deduction') === 'deduction';
    const sign = isDeduction ? '−' : '+';

    if (pkgType.toLowerCase() === 'loose') {
      aQtyHidden.value = count;
      if (aPkgUnitHidden) aPkgUnitHidden.value = baseSym;
      aCalcResult.innerHTML = `<strong>${sign}${count} ${baseSym} Loose</strong>`;
    } else {
      const opt = aPkgSize.options[aPkgSize.selectedIndex];
      if (opt && opt.value) {
        const size = parseFloat(opt.value) || 0;
        const unit = opt.dataset.unit || baseSym;
        const mult = parseFloat(opt.dataset.multiplier) || size;
        const total = Math.round(count * mult * 10000) / 10000;
        aQtyHidden.value = total;
        if (aPkgUnitHidden) aPkgUnitHidden.value = unit;

        const noun = count === 1 ? pkgType : (pkgType.endsWith('s') ? pkgType : pkgType + 's');
        aCalcResult.innerHTML = `<strong>${sign}${count} × ${size} ${unit} ${noun} = ${sign}${total} ${baseSym}</strong>`;
      } else {
        aQtyHidden.value = 0;
        aCalcResult.innerHTML = `<strong>0 ${baseSym}</strong>`;
      }
    }
  },

  openAdjustmentModal(productId = null) {
    const form = document.getElementById('formAdjustment');
    if (form) form.reset();

    const dIn = document.getElementById('adjustDate');
    if (dIn) dIn.value = new Date().toISOString().split('T')[0];

    const prodSel = document.getElementById('adjustProduct');
    if (prodSel && productId) {
      prodSel.value = productId;
    }
    this.syncAdjustPackagingUI();
    this.openModal('modalAdjustment');
  },

  // ── Reorder Stock UI Sync & Calculations (Step 4) ──────────────────────────
  syncReorderPackagingUI(forceDefault = false) {
    const rProd = document.getElementById('reorderProduct');
    const rPkgType = document.getElementById('reorderPkgType');
    const rStockHint = document.getElementById('reorderCurrentStockHint');
    const rStockVal = document.getElementById('reorderCurrentStockVal');

    if (!rProd || !rPkgType) return;
    const prodId = rProd.value;
    const prod = this.state.products.find(p => p.id == prodId);

    if (rStockHint && rStockVal) {
      if (prod) {
        rStockVal.textContent = `${prod.current_quantity} ${prod.unit || ''}`;
        rStockHint.style.display = 'block';
      } else {
        rStockHint.style.display = 'none';
      }
    }

    if (!prod) return;

    const baseUnit = (prod.unit || 'kg').toLowerCase();
    const isLiquid = (baseUnit === 'l' || baseUnit === 'ml' || baseUnit === 'liter' || (prod.name || '').toLowerCase().includes('liquid'));

    const prevType = rPkgType.value;
    if (isLiquid) {
      rPkgType.innerHTML = `
        <option value="Bottle">Bottle (Liter / L / ml)</option>
        <option value="Container">Can / Container (Liter / L)</option>
        <option value="Drum">Drum / Barrel (Liter / L)</option>
        <option value="Pouch">Pouch / Packet (L / ml)</option>
        <option value="Loose">Loose / Direct Liters (L)</option>
      `;
    } else {
      rPkgType.innerHTML = `
        <option value="Bag">Bag (KG Packages)</option>
        <option value="Pouch">Pouch / Packet (KG / g)</option>
        <option value="Container">Box / Container (KG)</option>
        <option value="Drum">Drum (KG)</option>
        <option value="Loose">Loose / Direct Kilograms (KG)</option>
      `;
    }

    if (forceDefault || document.activeElement === rProd || !prevType) {
      rPkgType.value = prod.default_packaging_type || (isLiquid ? 'Bottle' : 'Bag');
    } else {
      const hasPrev = Array.from(rPkgType.options).some(o => o.value.toLowerCase() === prevType.toLowerCase());
      rPkgType.value = hasPrev ? prevType : (isLiquid ? 'Bottle' : 'Bag');
    }

    this.syncReorderPackagingSizes();
  },

  syncReorderPackagingSizes() {
    const rProd = document.getElementById('reorderProduct');
    const rPkgType = document.getElementById('reorderPkgType');
    const rPkgSize = document.getElementById('reorderPkgSize');
    const rPkgSizeGroup = document.getElementById('reorderPkgSizeGroup');
    const rCountLabel = document.getElementById('reorderPkgCountLabel');

    if (!rProd || !rPkgType || !rPkgSize) return;

    const prod = this.state.products.find(p => p.id == rProd.value);
    const baseUnit = (prod && prod.unit) ? prod.unit.toLowerCase() : 'kg';
    const isLiquid = (baseUnit === 'l' || baseUnit === 'ml' || (prod && prod.name.toLowerCase().includes('liquid')));
    const selType = rPkgType.value || (isLiquid ? 'Bottle' : 'Bag');

    if (selType.toLowerCase() === 'loose') {
      if (rPkgSizeGroup) rPkgSizeGroup.style.display = 'none';
      const uLabel = isLiquid ? 'Liters (L)' : 'Kilograms (KG)';
      if (rCountLabel) rCountLabel.textContent = `4. Reorder Quantity (${uLabel} Direct) *`;
    } else {
      if (rPkgSizeGroup) rPkgSizeGroup.style.display = 'block';
      const noun = isLiquid ? (selType === 'Bottle' ? 'Bottles' : `${selType}s`) : (selType === 'Bag' ? 'Bags' : `${selType}s`);
      if (rCountLabel) rCountLabel.textContent = `4. Reorder Quantity (Number of ${noun}) *`;

      let matching = (this.state.packages || []).filter(p => p.packaging_type.toLowerCase() === selType.toLowerCase());
      if (isLiquid) {
        const liquidMatches = matching.filter(p => ['l', 'ml', 'litre', 'liter'].includes(p.unit_symbol.toLowerCase()));
        if (liquidMatches.length) matching = liquidMatches;
      } else {
        const weightMatches = matching.filter(p => ['kg', 'g', 'gm', 'ton'].includes(p.unit_symbol.toLowerCase()));
        if (weightMatches.length) matching = weightMatches;
      }

      if (!matching.length) {
        matching = isLiquid
          ? [
              { package_size: 10, unit_symbol: 'ml', base_multiplier: 0.01, label: `10 ml ${selType}` },
              { package_size: 25, unit_symbol: 'ml', base_multiplier: 0.025, label: `25 ml ${selType}` },
              { package_size: 50, unit_symbol: 'ml', base_multiplier: 0.05, label: `50 ml ${selType}` },
              { package_size: 100, unit_symbol: 'ml', base_multiplier: 0.1, label: `100 ml ${selType}` },
              { package_size: 250, unit_symbol: 'ml', base_multiplier: 0.25, label: `250 ml ${selType}` },
              { package_size: 500, unit_symbol: 'ml', base_multiplier: 0.5, label: `500 ml ${selType}` },
              { package_size: 1, unit_symbol: 'L', base_multiplier: 1, label: `1 L ${selType}` },
              { package_size: 2, unit_symbol: 'L', base_multiplier: 2, label: `2 L ${selType}` },
              { package_size: 5, unit_symbol: 'L', base_multiplier: 5, label: `5 L ${selType}` },
            ]
          : [
              { package_size: 50, unit_symbol: 'g', base_multiplier: 0.05, label: `50 g ${selType}` },
              { package_size: 100, unit_symbol: 'g', base_multiplier: 0.1, label: `100 g ${selType}` },
              { package_size: 200, unit_symbol: 'g', base_multiplier: 0.2, label: `200 g ${selType}` },
              { package_size: 250, unit_symbol: 'g', base_multiplier: 0.25, label: `250 g ${selType}` },
              { package_size: 500, unit_symbol: 'g', base_multiplier: 0.5, label: `500 g ${selType}` },
              { package_size: 1, unit_symbol: 'kg', base_multiplier: 1, label: `1 kg ${selType}` },
              { package_size: 2, unit_symbol: 'kg', base_multiplier: 2, label: `2 kg ${selType}` },
              { package_size: 5, unit_symbol: 'kg', base_multiplier: 5, label: `5 kg ${selType}` },
              { package_size: 10, unit_symbol: 'kg', base_multiplier: 10, label: `10 kg ${selType}` },
              { package_size: 25, unit_symbol: 'kg', base_multiplier: 25, label: `25 kg ${selType}` },
              { package_size: 50, unit_symbol: 'kg', base_multiplier: 50, label: `50 kg ${selType}` },
            ];
      }

      rPkgSize.innerHTML = matching.map(p =>
        `<option value="${p.package_size}" data-unit="${p.unit_symbol}" data-multiplier="${p.base_multiplier}">${p.label || `${p.package_size} ${p.unit_symbol} ${selType}`}</option>`
      ).join('');

      if (prod && prod.default_package_size) {
        const found = matching.find(p => Math.abs(p.package_size - prod.default_package_size) < 0.001);
        if (found) rPkgSize.value = found.package_size;
      }
    }

    this.recalcReorderTotal();
  },

  recalcReorderTotal() {
    const rProd = document.getElementById('reorderProduct');
    const rPkgType = document.getElementById('reorderPkgType');
    const rPkgSize = document.getElementById('reorderPkgSize');
    const rPkgCount = document.getElementById('reorderPkgCount');
    const rCalcResult = document.getElementById('reorderCalcResult');

    if (!rProd || !rPkgType || !rPkgCount || !rCalcResult) return;

    const prod = this.state.products.find(p => p.id == rProd.value);
    const baseSym = (prod && prod.unit) ? prod.unit : 'kg';
    const pkgType = rPkgType.value || 'Bag';
    const count = parseFloat(rPkgCount.value) || 0;

    if (pkgType.toLowerCase() === 'loose') {
      rCalcResult.innerHTML = `<strong>${count} ${baseSym} Loose</strong>`;
    } else {
      const opt = rPkgSize.options[rPkgSize.selectedIndex];
      if (opt && opt.value) {
        const size = parseFloat(opt.value) || 0;
        const unit = opt.dataset.unit || baseSym;
        const mult = parseFloat(opt.dataset.multiplier) || size;
        const total = Math.round(count * mult * 10000) / 10000;
        const noun = count === 1 ? pkgType : (pkgType.endsWith('s') ? pkgType : pkgType + 's');
        rCalcResult.innerHTML = `<strong>${count} × ${size} ${unit} ${noun} = ${total} ${baseSym}</strong>`;
      } else {
        rCalcResult.innerHTML = `<strong>0 ${baseSym}</strong>`;
      }
    }
  },

  openReorderModal(productId = null) {
    const form = document.getElementById('formReorder');
    if (form) form.reset();

    const dIn = document.getElementById('reorderDate');
    if (dIn) dIn.value = new Date().toISOString().split('T')[0];

    const countIn = document.getElementById('reorderPkgCount');
    if (countIn) countIn.value = '1';

    const prodSel = document.getElementById('reorderProduct');
    if (prodSel && productId) {
      prodSel.value = productId;
    }
    this.syncReorderPackagingUI(true);
    this.openModal('modalReorder');
  },

  openReceiveReorderModal(reorder) {
    if (!reorder) return;
    const form = document.getElementById('formReceiveReorder');
    if (form) form.reset();

    const idIn = document.getElementById('receiveReorderId');
    if (idIn) idIn.value = reorder.id;

    const prodName = document.getElementById('receiveProdName');
    if (prodName) prodName.textContent = reorder.product_name || `Product #${reorder.product_id}`;

    const summaryText = document.getElementById('receiveSummaryText');
    if (summaryText) summaryText.textContent = `${reorder.quantity} (${reorder.package_summary || reorder.packaging_type || ''})`;

    const suppName = document.getElementById('receiveSupplierName');
    if (suppName) suppName.textContent = reorder.supplier_name || 'N/A';

    const remaining = reorder.remaining_quantity != null ? reorder.remaining_quantity : (reorder.quantity - (reorder.received_quantity || 0));
    const qtyIn = document.getElementById('receiveReorderQty');
    if (qtyIn) qtyIn.value = Math.max(0, remaining);

    const hint = document.getElementById('receiveRemainingHint');
    if (hint) hint.textContent = `Total pending to receive: ${remaining}`;

    this.openModal('modalReceiveReorder');
  },

  // ── Dedicated Add Stock UI Sync & Helpers (Step 2) ────────────────────────
  syncAddStockPackagingUI(forceDefault = false) {
    const aProd = document.getElementById('addStockProduct');
    const aPkgType = document.getElementById('addStockPkgType');
    const aStockHint = document.getElementById('addStockCurrentHint');
    const aStockVal = document.getElementById('addStockCurrentVal');

    if (!aProd || !aPkgType) return;
    const prodId = aProd.value;
    const prod = this.state.products.find(p => p.id == prodId);

    if (aStockHint && aStockVal) {
      if (prod) {
        aStockVal.textContent = `${prod.current_quantity} ${prod.unit || ''}`;
        aStockHint.style.display = 'block';
      } else {
        aStockHint.style.display = 'none';
      }
    }

    if (!prod) return;

    const baseUnit = (prod.unit || 'kg').toLowerCase();
    const isLiquid = (baseUnit === 'l' || baseUnit === 'ml' || baseUnit === 'liter' || (prod.name || '').toLowerCase().includes('liquid'));

    const prevType = aPkgType.value;
    if (isLiquid) {
      aPkgType.innerHTML = `
        <option value="Bottle">Bottle (Liter / L / ml)</option>
        <option value="Container">Can / Container (Liter / L)</option>
        <option value="Drum">Drum / Barrel (Liter / L)</option>
        <option value="Pouch">Pouch / Packet (L / ml)</option>
        <option value="Loose">Loose / Direct Liters (L)</option>
      `;
    } else {
      aPkgType.innerHTML = `
        <option value="Bag">Bag (KG Packages)</option>
        <option value="Pouch">Pouch / Packet (KG / g)</option>
        <option value="Container">Box / Container (KG)</option>
        <option value="Drum">Drum (KG)</option>
        <option value="Loose">Loose / Direct Kilograms (KG)</option>
      `;
    }

    if (forceDefault || document.activeElement === aProd || !prevType) {
      aPkgType.value = prod.default_packaging_type || (isLiquid ? 'Bottle' : 'Bag');
    } else {
      const hasPrev = Array.from(aPkgType.options).some(o => o.value.toLowerCase() === prevType.toLowerCase());
      aPkgType.value = hasPrev ? prevType : (isLiquid ? 'Bottle' : 'Bag');
    }

    this.syncAddStockPackagingSizes();
  },

  syncAddStockPackagingSizes() {
    const aProd = document.getElementById('addStockProduct');
    const aPkgType = document.getElementById('addStockPkgType');
    const aPkgSize = document.getElementById('addStockPkgSize');
    const aPkgSizeGroup = document.getElementById('addStockPkgSizeGroup');
    const aCountLabel = document.getElementById('addStockCountLabel');

    if (!aProd || !aPkgType || !aPkgSize) return;

    const prod = this.state.products.find(p => p.id == aProd.value);
    const baseUnit = (prod && prod.unit) ? prod.unit.toLowerCase() : 'kg';
    const isLiquid = (baseUnit === 'l' || baseUnit === 'ml' || (prod && prod.name.toLowerCase().includes('liquid')));
    const selType = aPkgType.value || (isLiquid ? 'Bottle' : 'Bag');

    if (selType.toLowerCase() === 'loose') {
      if (aPkgSizeGroup) aPkgSizeGroup.style.display = 'none';
      const uLabel = isLiquid ? 'Liters (L)' : 'Kilograms (KG)';
      if (aCountLabel) aCountLabel.textContent = `Quantity to Add (${uLabel} Direct) *`;
    } else {
      if (aPkgSizeGroup) aPkgSizeGroup.style.display = 'block';
      const noun = isLiquid ? (selType === 'Bottle' ? 'Bottles' : `${selType}s`) : (selType === 'Bag' ? 'Bags' : `${selType}s`);
      if (aCountLabel) aCountLabel.textContent = `Quantity to Add (Number of ${noun}) *`;

      let matching = (this.state.packages || []).filter(p => p.packaging_type.toLowerCase() === selType.toLowerCase());
      if (isLiquid) {
        const liquidMatches = matching.filter(p => ['l', 'ml', 'litre', 'liter'].includes(p.unit_symbol.toLowerCase()));
        if (liquidMatches.length) matching = liquidMatches;
      } else {
        const weightMatches = matching.filter(p => ['kg', 'g', 'gm', 'ton'].includes(p.unit_symbol.toLowerCase()));
        if (weightMatches.length) matching = weightMatches;
      }

      if (!matching.length) {
        matching = isLiquid
          ? [
              { package_size: 10, unit_symbol: 'ml', base_multiplier: 0.01, label: `10 ml ${selType}` },
              { package_size: 25, unit_symbol: 'ml', base_multiplier: 0.025, label: `25 ml ${selType}` },
              { package_size: 50, unit_symbol: 'ml', base_multiplier: 0.05, label: `50 ml ${selType}` },
              { package_size: 100, unit_symbol: 'ml', base_multiplier: 0.1, label: `100 ml ${selType}` },
              { package_size: 250, unit_symbol: 'ml', base_multiplier: 0.25, label: `250 ml ${selType}` },
              { package_size: 500, unit_symbol: 'ml', base_multiplier: 0.5, label: `500 ml ${selType}` },
              { package_size: 1, unit_symbol: 'L', base_multiplier: 1, label: `1 L ${selType}` },
              { package_size: 2, unit_symbol: 'L', base_multiplier: 2, label: `2 L ${selType}` },
              { package_size: 5, unit_symbol: 'L', base_multiplier: 5, label: `5 L ${selType}` },
            ]
          : [
              { package_size: 50, unit_symbol: 'g', base_multiplier: 0.05, label: `50 g ${selType}` },
              { package_size: 100, unit_symbol: 'g', base_multiplier: 0.1, label: `100 g ${selType}` },
              { package_size: 200, unit_symbol: 'g', base_multiplier: 0.2, label: `200 g ${selType}` },
              { package_size: 250, unit_symbol: 'g', base_multiplier: 0.25, label: `250 g ${selType}` },
              { package_size: 500, unit_symbol: 'g', base_multiplier: 0.5, label: `500 g ${selType}` },
              { package_size: 1, unit_symbol: 'kg', base_multiplier: 1, label: `1 kg ${selType}` },
              { package_size: 2, unit_symbol: 'kg', base_multiplier: 2, label: `2 kg ${selType}` },
              { package_size: 5, unit_symbol: 'kg', base_multiplier: 5, label: `5 kg ${selType}` },
              { package_size: 10, unit_symbol: 'kg', base_multiplier: 10, label: `10 kg ${selType}` },
              { package_size: 25, unit_symbol: 'kg', base_multiplier: 25, label: `25 kg ${selType}` },
              { package_size: 50, unit_symbol: 'kg', base_multiplier: 50, label: `50 kg ${selType}` },
            ];
      }

      aPkgSize.innerHTML = matching.map(p =>
        `<option value="${p.package_size}" data-unit="${p.unit_symbol}" data-multiplier="${p.base_multiplier}">${p.label || `${p.package_size} ${p.unit_symbol} ${selType}`}</option>`
      ).join('');

      if (prod && prod.default_package_size) {
        const found = matching.find(p => Math.abs(p.package_size - prod.default_package_size) < 0.001);
        if (found) aPkgSize.value = found.package_size;
      }
    }

    this.recalcAddStockTotal();
  },

  recalcAddStockTotal() {
    const aProd = document.getElementById('addStockProduct');
    const aPkgType = document.getElementById('addStockPkgType');
    const aPkgSize = document.getElementById('addStockPkgSize');
    const aCount = document.getElementById('addStockCount');
    const aCalcResult = document.getElementById('addStockCalcResult');

    if (!aProd || !aPkgType || !aCount || !aCalcResult) return;

    const prod = this.state.products.find(p => p.id == aProd.value);
    const baseSym = (prod && prod.unit) ? prod.unit : 'kg';
    const pkgType = aPkgType.value || 'Bag';
    const count = parseFloat(aCount.value) || 0;
    const currentStock = prod ? (prod.current_quantity || 0) : 0;

    let addedQty = 0;
    if (pkgType.toLowerCase() === 'loose') {
      addedQty = count;
    } else {
      const opt = aPkgSize.options[aPkgSize.selectedIndex];
      if (opt && opt.value) {
        const mult = parseFloat(opt.dataset.multiplier) || parseFloat(opt.value) || 0;
        addedQty = Math.round(count * mult * 10000) / 10000;
      }
    }

    const newTotal = Math.round((currentStock + addedQty) * 10000) / 10000;
    aCalcResult.innerHTML = `<strong>+${addedQty} ${baseSym} (New Balance: ${newTotal} ${baseSym})</strong>`;
  },

  openAddStockModal(productId = null) {
    const form = document.getElementById('formAddStock');
    if (form) form.reset();

    const dIn = document.getElementById('addStockDate');
    if (dIn) dIn.value = new Date().toISOString().split('T')[0];

    const countIn = document.getElementById('addStockCount');
    if (countIn) countIn.value = '1';

    const prodSel = document.getElementById('addStockProduct');
    if (prodSel && productId) {
      prodSel.value = productId;
    }
    this.syncAddStockPackagingUI(true);
    this.openModal('modalAddStock');
  },

  // ── Dedicated Edit Stock UI Sync & Helpers (Step 2) ───────────────────────
  syncEditStockUI() {
    const eProd = document.getElementById('editStockProduct');
    const eHint = document.getElementById('editStockCurrentHint');
    const eVal = document.getElementById('editStockCurrentVal');
    const eTarget = document.getElementById('editStockTargetQty');

    if (!eProd) return;
    const prodId = eProd.value;
    const prod = this.state.products.find(p => p.id == prodId);

    if (prod) {
      if (eVal) eVal.textContent = `${prod.current_quantity} ${prod.unit || ''}`;
      if (eHint) eHint.style.display = 'block';
      if (eTarget && (document.activeElement === eProd || !eTarget.value)) {
        eTarget.value = prod.current_quantity;
      }
    } else {
      if (eHint) eHint.style.display = 'none';
    }

    this.recalcEditStockDiff();
  },

  recalcEditStockDiff() {
    const eProd = document.getElementById('editStockProduct');
    const eTarget = document.getElementById('editStockTargetQty');
    const eDiffVal = document.getElementById('editStockDiffVal');
    const eDiffBadge = document.getElementById('editStockDiffBadge');

    if (!eProd || !eTarget || !eDiffVal) return;

    const prod = this.state.products.find(p => p.id == eProd.value);
    const baseSym = (prod && prod.unit) ? prod.unit : 'kg';
    const currentStock = prod ? (prod.current_quantity || 0) : 0;
    const targetStock = parseFloat(eTarget.value);

    if (isNaN(targetStock)) {
      eDiffVal.textContent = '0';
      if (eDiffBadge) {
        eDiffBadge.textContent = 'Adjustment';
        eDiffBadge.style.background = 'var(--text-mid)';
      }
      return;
    }

    const diff = Math.round((targetStock - currentStock) * 10000) / 10000;
    if (diff > 0) {
      eDiffVal.textContent = `+${diff} ${baseSym} (Stock Increase)`;
      if (eDiffBadge) {
        eDiffBadge.textContent = 'Addition';
        eDiffBadge.style.background = 'var(--green-mid)';
      }
    } else if (diff < 0) {
      eDiffVal.textContent = `${diff} ${baseSym} (Stock Deduction)`;
      if (eDiffBadge) {
        eDiffBadge.textContent = 'Deduction';
        eDiffBadge.style.background = 'var(--red)';
      }
    } else {
      eDiffVal.textContent = `0 ${baseSym} (No Change)`;
      if (eDiffBadge) {
        eDiffBadge.textContent = 'Identical';
        eDiffBadge.style.background = 'var(--text-mid)';
      }
    }
  },

  openEditStockModal(productId = null) {
    const form = document.getElementById('formEditStock');
    if (form) form.reset();

    const dIn = document.getElementById('editStockDate');
    if (dIn) dIn.value = new Date().toISOString().split('T')[0];

    const prodSel = document.getElementById('editStockProduct');
    if (prodSel && productId) {
      prodSel.value = productId;
    }
    this.syncEditStockUI();
    this.openModal('modalEditStock');
  },

  // ── Daily Farm Digest ─────────────────────────────────────────────────────
  async openDailyFarmDigest() {
    this.openModal('modalFarmDigest');
    const content = document.getElementById('digestContent');
    const waLink = document.getElementById('btnWhatsAppDigest');
    if (content) content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
      const res = await fetch('/api/dashboard/digest');
      if (res.ok) {
        const data = await res.json();
        const text = data.formatted_text || 'No operations recorded for today yet.';
        if (content) content.textContent = text;
        if (waLink) {
          waLink.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
        }
      } else {
        if (content) content.textContent = 'Failed to load digest summary from server.';
      }
    } catch (err) {
      if (content) content.textContent = 'Error loading digest: ' + err.message;
    }
  },

  // ── Price Comparison & Rate Tracking ─────────────────────────────────────
  async checkLastPurchasePrice(productId) {
    const compareBox = document.getElementById('purchaseRateCompare');
    if (!compareBox) return;

    if (!productId) {
      compareBox.style.display = 'none';
      compareBox.innerHTML = '';
      this.lastPurchaseData = null;
      return;
    }

    try {
      const res = await fetch(`/api/purchases/last-price?product_id=${productId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.last_price != null) {
          this.lastPurchaseData = data;
          compareBox.style.display = 'inline-block';
          compareBox.className = 'rate-compare-pill rate-same';
          const pkg = data.package_summary || `${data.packaging_type || 'Unit'}`;
          compareBox.innerHTML = `<span>📊 Last Paid: <strong>₹${data.last_price.toLocaleString('en-IN')}</strong> (${pkg} on ${data.purchase_date || 'prev purchase'})</span>`;
          this.recalcRateComparison();
        } else {
          this.lastPurchaseData = null;
          compareBox.style.display = 'none';
        }
      }
    } catch (_) {
      this.lastPurchaseData = null;
      compareBox.style.display = 'none';
    }
  },

  recalcRateComparison() {
    const compareBox = document.getElementById('purchaseRateCompare');
    const unitPriceIn = document.getElementById('purchaseUnitPrice');
    if (!compareBox || !this.lastPurchaseData || !unitPriceIn) return;

    const lastPrice = this.lastPurchaseData.last_price;
    const currentPrice = parseFloat(unitPriceIn.value) || 0;

    if (currentPrice <= 0 || lastPrice <= 0) {
      compareBox.className = 'rate-compare-pill rate-same';
      compareBox.innerHTML = `<span>📊 Last Paid: <strong>₹${lastPrice.toLocaleString('en-IN')}</strong> (${this.lastPurchaseData.purchase_date || ''})</span>`;
      return;
    }

    const diff = currentPrice - lastPrice;
    const pct = ((diff / lastPrice) * 100).toFixed(1);

    if (diff > 0.01) {
      compareBox.className = 'rate-compare-pill rate-up';
      compareBox.innerHTML = `<span>🔺 Rate increased by <strong>₹${diff.toFixed(2)} (+${pct}%)</strong> vs last purchase (₹${lastPrice})</span>`;
    } else if (diff < -0.01) {
      compareBox.className = 'rate-compare-pill rate-down';
      compareBox.innerHTML = `<span>🟢 Rate decreased by <strong>₹${Math.abs(diff).toFixed(2)} (${pct}%)</strong> vs last purchase (₹${lastPrice})</span>`;
    } else {
      compareBox.className = 'rate-compare-pill rate-same';
      compareBox.innerHTML = `<span>⚖️ Same rate as last purchase (₹${lastPrice})</span>`;
    }
  },

  // ── Web Speech API Voice Recognition ──────────────────────────────────────
  initVoiceTyping() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    document.querySelectorAll('.btn-voice').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!SpeechRecognition) {
          App.showToast('Speech Recognition not supported in this browser. Please type manually.', 'info');
          return;
        }

        const targetId = btn.dataset.target;
        const targetInput = document.getElementById(targetId);
        if (!targetInput) return;

        if (btn.classList.contains('listening')) {
          if (btn._recognition) {
            btn._recognition.stop();
          }
          return;
        }

        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = false;
          recognition.interimResults = true;
          recognition.lang = 'en-IN';

          btn._recognition = recognition;
          const statusSpan = btn.querySelector('.voice-status');

          recognition.onstart = () => {
            btn.classList.add('listening');
            if (statusSpan) statusSpan.textContent = 'Listening...';
          };

          recognition.onresult = (evt) => {
            const transcript = Array.from(evt.results)
              .map(result => result[0].transcript)
              .join('');
            if (evt.results[0].isFinal) {
              const currentVal = targetInput.value.trim();
              targetInput.value = currentVal ? `${currentVal} ${transcript}` : transcript;
              targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
          };

          recognition.onerror = () => {
            btn.classList.remove('listening');
            if (statusSpan) statusSpan.textContent = 'Speak';
          };

          recognition.onend = () => {
            btn.classList.remove('listening');
            if (statusSpan) statusSpan.textContent = 'Speak';
          };

          recognition.start();
        } catch (err) {
          btn.classList.remove('listening');
          App.showToast('Could not start microphone: ' + err.message, 'error');
        }
      };
    });
  },
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());

