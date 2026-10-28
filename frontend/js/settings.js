/**
 * Tiger Farm — Settings & Configuration View Controller
 */

const SettingsView = {
  tab: 'suppliers',

  async render(container) {
    this.container = container;
    this.renderLayout();
    await this.loadActiveTabContent();
  },

  refresh() {
    this.loadActiveTabContent();
  },

  renderLayout() {
    this.container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Settings & Farm Administration</h1>
          <small>Manage vendors, locations, category taxonomies, security, and database backup/restore.</small>
        </div>
      </div>

      <!-- Settings Navigation Tabs -->
      <div class="settings-tabs-bar">
        <button class="btn ${this.tab === 'packages' ? 'btn-primary' : 'btn-ghost'} btn-sm tab-btn" data-tab="packages">📦 Package / Unit Master</button>
        <button class="btn ${this.tab === 'suppliers' ? 'btn-primary' : 'btn-ghost'} btn-sm tab-btn" data-tab="suppliers">🏢 Suppliers</button>
        <button class="btn ${this.tab === 'categories' ? 'btn-primary' : 'btn-ghost'} btn-sm tab-btn" data-tab="categories">🏷️ Categories</button>
        <button class="btn ${this.tab === 'units' ? 'btn-primary' : 'btn-ghost'} btn-sm tab-btn" data-tab="units">⚖️ Units of Measure</button>
        <button class="btn ${this.tab === 'fields' ? 'btn-primary' : 'btn-ghost'} btn-sm tab-btn" data-tab="fields">📍 Field Plots</button>
        <button class="btn ${this.tab === 'backup' ? 'btn-primary' : 'btn-ghost'} btn-sm tab-btn" data-tab="backup">💾 Backup & Restore</button>
        <button class="btn ${this.tab === 'security' ? 'btn-primary' : 'btn-ghost'} btn-sm tab-btn" data-tab="security">🔒 Password</button>
      </div>

      <!-- Tab Content Area -->
      <div id="settingsTabContent">
        <div class="loading-overlay"><div class="spinner"></div></div>
      </div>
    `;

    this.bindTabButtons();
  },

  bindTabButtons() {
    this.container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.tab;
        this.renderLayout();
        this.loadActiveTabContent();
      });
    });
  },

  async loadActiveTabContent() {
    const content = document.getElementById('settingsTabContent');
    if (!content) return;

    switch (this.tab) {
      case 'packages':
        await this.renderPackagesTab(content);
        break;
      case 'suppliers':
        await this.renderSuppliersTab(content);
        break;
      case 'categories':
        await this.renderCategoriesTab(content);
        break;
      case 'units':
        await this.renderUnitsTab(content);
        break;
      case 'fields':
        await this.renderFieldsTab(content);
        break;
      case 'backup':
        this.renderBackupTab(content);
        break;
      case 'security':
        this.renderSecurityTab(content);
        break;
    }
  },

  // ── Tab: Package / Unit Master (Section 10) ─────────────────────────────────
  async renderPackagesTab(container) {
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
      const res = await fetch('/api/packages');
      const data = await res.json();
      const packages = data.packages || data.data || [];
      App.state.packages = packages;

      const packagingTypes = ['All', 'Bag', 'Bottle', 'Pouch', 'Container', 'Drum', 'Loose'];

      container.innerHTML = `
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.25rem; flex-wrap:wrap; gap:1rem;">
            <div>
              <h3 class="card-title" style="margin-bottom:0.25rem;">📦 Package / Unit Master</h3>
              <p style="color:var(--text-muted); font-size:0.875rem; margin:0;">
                Reusable package sizes & units across all products. Products and package sizes are strictly decoupled.
              </p>
            </div>
            <button class="btn btn-primary btn-sm" id="btnAddPackage"><span>+</span> Add Package Size</button>
          </div>

          <!-- Filter Toolbar -->
          <div style="display:flex; gap:0.75rem; align-items:center; margin-bottom:1rem; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-muted);">Packaging Type:</label>
              <select id="filterPackagingType" class="form-control" style="width:auto; padding:0.35rem 0.75rem; font-size:0.85rem;">
                ${packagingTypes.map(pt => `<option value="${pt}">${pt === 'All' ? 'All Types' : pt}</option>`).join('')}
              </select>
            </div>
            <div style="flex:1; min-width:200px;">
              <input type="text" id="searchPackageInput" class="form-control" placeholder="Search size, unit or type..." style="padding:0.35rem 0.75rem; font-size:0.85rem;" />
            </div>
          </div>

          <div class="table-wrap">
            <table id="packageMasterTable">
              <thead>
                <tr>
                  <th>Package Size</th>
                  <th>Unit</th>
                  <th>Packaging Type</th>
                  <th>Display Label</th>
                  <th>Base Equivalent</th>
                  <th>Status</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="packageMasterTbody">
                <!-- Dynamically populated -->
              </tbody>
            </table>
          </div>
        </div>
      `;

      const tbody = document.getElementById('packageMasterTbody');
      const filterType = document.getElementById('filterPackagingType');
      const searchInput = document.getElementById('searchPackageInput');

      const renderRows = () => {
        const typeVal = filterType.value;
        const searchVal = searchInput.value.trim().toLowerCase();

        const filtered = packages.filter(p => {
          if (typeVal !== 'All' && p.packaging_type !== typeVal) return false;
          if (searchVal) {
            const str = `${p.package_size} ${p.unit_symbol} ${p.packaging_type} ${p.label}`.toLowerCase();
            if (!str.includes(searchVal)) return false;
          }
          return true;
        });

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">No package sizes match the selected criteria.</td></tr>`;
          return;
        }

        tbody.innerHTML = filtered.map(p => {
          const isLoose = p.packaging_type === 'Loose';
          const sizeDisplay = isLoose ? '1' : `${p.package_size}`;
          const baseEq = p.base_multiplier === 1 ? `${p.package_size} ${p.base_unit}` : `${p.base_multiplier} ${p.base_unit}`;
          return `
            <tr>
              <td><strong>${sizeDisplay}</strong></td>
              <td><span class="badge badge-muted">${p.unit_symbol}</span></td>
              <td><span class="badge ${isLoose ? 'badge-yellow' : 'badge-green'}">${p.packaging_type}</span></td>
              <td><strong>${p.label}</strong></td>
              <td style="color:var(--text-muted); font-size:0.875rem;">${baseEq}</td>
              <td>
                <span class="badge ${p.is_active ? 'badge-green' : 'badge-danger'}">
                  ${p.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td style="text-align:right; white-space:nowrap;">
                <button class="btn btn-ghost btn-sm btn-edit-package" data-id="${p.id}" title="Edit Package Size">✏️ Edit</button>
                <button class="btn btn-danger btn-sm btn-del-package" data-id="${p.id}" data-label="${p.label}" title="Delete Package Size">🗑️</button>
              </td>
            </tr>
          `;
        }).join('');

        // Bind Edit buttons
        tbody.querySelectorAll('.btn-edit-package').forEach(btn => {
          btn.addEventListener('click', () => {
            const pId = parseInt(btn.dataset.id, 10);
            const targetPkg = packages.find(x => x.id === pId);
            if (!targetPkg) return;

            document.getElementById('modalPackageTitle').textContent = 'Edit Package Size / Unit';
            document.getElementById('packageEditId').value = targetPkg.id;
            document.getElementById('pkgPackagingType').value = targetPkg.packaging_type;
            document.getElementById('pkgSize').value = targetPkg.package_size;
            document.getElementById('pkgUnit').value = targetPkg.unit_symbol;
            document.getElementById('pkgStatus').value = targetPkg.is_active ? 'true' : 'false';

            App.openModal('modalPackage');
          });
        });

        // Bind Delete buttons
        tbody.querySelectorAll('.btn-del-package').forEach(btn => {
          btn.addEventListener('click', async () => {
            const pId = btn.dataset.id;
            const pLabel = btn.dataset.label;
            if (confirm(`Remove package size "${pLabel}" from Package Master?`)) {
              try {
                const r = await fetch(`/api/packages/${pId}`, { method: 'DELETE' });
                const d = await r.json();
                if (r.ok && d.success) {
                  App.showToast(`Package size "${pLabel}" removed.`);
                  await App.loadMetadata();
                  this.renderPackagesTab(container);
                } else {
                  App.showToast(d.message || 'Cannot delete package size', 'error');
                }
              } catch (err) {
                App.showToast('Network error deleting package size', 'error');
              }
            }
          });
        });
      };

      renderRows();

      filterType.addEventListener('change', renderRows);
      searchInput.addEventListener('input', renderRows);

      document.getElementById('btnAddPackage')?.addEventListener('click', () => {
        document.getElementById('formPackage').reset();
        document.getElementById('modalPackageTitle').textContent = 'Add Package Size / Unit';
        document.getElementById('packageEditId').value = '';
        document.getElementById('pkgStatus').value = 'true';
        App.openModal('modalPackage');
      });

    } catch (err) {
      container.innerHTML = `<div class="alert alert-error">Error loading Package Master: ${err.message}</div>`;
    }
  },

  // ── Tab 1: Suppliers ───────────────────────────────────────────────────────
  async renderSuppliersTab(container) {
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
      const res = await fetch('/api/suppliers');
      const suppliers = await res.json();
      App.state.suppliers = suppliers;

      container.innerHTML = `
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <h3 class="card-title" style="margin-bottom:0;">Vendor & Supplier Directory</h3>
            <button class="btn btn-primary btn-sm" id="btnAddSupplier"><span>+</span> Add Supplier</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Address</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${suppliers.map(s => `
                  <tr>
                    <td><strong>${s.name}</strong></td>
                    <td>${s.phone || '<span style="color:var(--muted);">—</span>'}</td>
                    <td>${s.email || '<span style="color:var(--muted);">—</span>'}</td>
                    <td>${s.address || '<span style="color:var(--muted);">—</span>'}</td>
                    <td style="text-align:right;">
                      <button class="btn btn-danger btn-sm btn-del-supplier" data-id="${s.id}" data-name="${s.name}">🗑️</button>
                    </td>
                  </tr>
                `).join('') || '<tr><td colspan="5" style="text-align:center;">No suppliers added yet.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;

      document.getElementById('btnAddSupplier')?.addEventListener('click', () => {
        document.getElementById('formSupplier').reset();
        App.openModal('modalSupplier');
      });

      container.querySelectorAll('.btn-del-supplier').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm(`Delete supplier "${btn.dataset.name}"?`)) {
            await fetch(`/api/suppliers/${btn.dataset.id}`, { method: 'DELETE' });
            App.showToast('Supplier deleted.');
            await App.loadMetadata();
            this.renderSuppliersTab(container);
          }
        });
      });

      const fSup = document.getElementById('formSupplier');
      if (fSup && !fSup.dataset.bound) {
        fSup.dataset.bound = 'true';
        fSup.addEventListener('submit', async (e) => {
          e.preventDefault();
          const payload = {
            name: document.getElementById('supplierName').value.trim(),
            phone: document.getElementById('supplierPhone').value.trim(),
            email: document.getElementById('supplierEmail').value.trim(),
            address: document.getElementById('supplierAddress').value.trim(),
          };
          const r = await fetch('/api/suppliers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (r.ok) {
            App.showToast('Supplier added.');
            App.closeModal('modalSupplier');
            await App.loadMetadata();
            SettingsView.renderSuppliersTab(container);
          } else {
            const err = await r.json();
            App.showToast(err.error || 'Failed to add supplier', 'error');
          }
        });
      }
    } catch (err) {
      container.innerHTML = `<div class="alert alert-error">Error loading suppliers: ${err.message}</div>`;
    }
  },

  // ── Tab 2: Categories ──────────────────────────────────────────────────────
  async renderCategoriesTab(container) {
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      const cats = data.categories || data || [];

      container.innerHTML = `
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <h3 class="card-title" style="margin-bottom:0;">Product Categories</h3>
            <button class="btn btn-primary btn-sm" id="btnAddCategory"><span>+</span> Add Category</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Color</th>
                  <th>Category Name</th>
                  <th>Description</th>
                  <th>Products Count</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${cats.map(c => `
                  <tr>
                    <td>
                      <span style="display:inline-block; width:16px; height:16px; border-radius:50%; background:${c.color || '#52B788'};"></span>
                    </td>
                    <td><strong>${c.name}</strong></td>
                    <td>${c.description || '<span style="color:var(--muted);">—</span>'}</td>
                    <td><span class="badge badge-green">${c.product_count || 0} products</span></td>
                    <td style="text-align:right;">
                      <button class="btn btn-danger btn-sm btn-del-category" data-id="${c.id}" data-name="${c.name}">🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      document.getElementById('btnAddCategory')?.addEventListener('click', () => {
        document.getElementById('formCategory').reset();
        App.openModal('modalCategory');
      });

      container.querySelectorAll('.btn-del-category').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm(`Delete category "${btn.dataset.name}"?`)) {
            const r = await fetch(`/api/categories/${btn.dataset.id}`, { method: 'DELETE' });
            const d = await r.json();
            if (r.ok) {
              App.showToast('Category deleted.');
              await App.loadMetadata();
              this.renderCategoriesTab(container);
            } else {
              App.showToast(d.error || 'Cannot delete category', 'error');
            }
          }
        });
      });

      const fCat = document.getElementById('formCategory');
      if (fCat && !fCat.dataset.bound) {
        fCat.dataset.bound = 'true';
        fCat.addEventListener('submit', async (e) => {
          e.preventDefault();
          const payload = {
            name: document.getElementById('catName').value.trim(),
            color: document.getElementById('catColor').value,
            description: document.getElementById('catDesc').value.trim(),
          };
          const r = await fetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (r.ok) {
            App.showToast('Category created.');
            App.closeModal('modalCategory');
            await App.loadMetadata();
            SettingsView.renderCategoriesTab(container);
          } else {
            const err = await r.json();
            App.showToast(err.error || 'Failed to create category', 'error');
          }
        });
      }
    } catch (err) {
      container.innerHTML = `<div class="alert alert-error">Error loading categories: ${err.message}</div>`;
    }
  },

  // ── Tab 3: Units ───────────────────────────────────────────────────────────
  async renderUnitsTab(container) {
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
      const res = await fetch('/api/units');
      const data = await res.json();
      const units = data.units || data || [];

      container.innerHTML = `
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <h3 class="card-title" style="margin-bottom:0;">Measurement Units</h3>
            <button class="btn btn-primary btn-sm" id="btnAddUnit"><span>+</span> Add Unit</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Unit Name</th>
                  <th>Symbol</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${units.map(u => `
                  <tr>
                    <td><strong>${u.name}</strong></td>
                    <td><span class="badge badge-muted">${u.symbol}</span></td>
                    <td style="text-align:right;">
                      <button class="btn btn-danger btn-sm btn-del-unit" data-id="${u.id}" data-name="${u.name}">🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      document.getElementById('btnAddUnit')?.addEventListener('click', () => {
        document.getElementById('formUnit').reset();
        App.openModal('modalUnit');
      });

      container.querySelectorAll('.btn-del-unit').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm(`Delete unit "${btn.dataset.name}"?`)) {
            const r = await fetch(`/api/units/${btn.dataset.id}`, { method: 'DELETE' });
            if (r.ok) {
              App.showToast('Unit deleted.');
              await App.loadMetadata();
              this.renderUnitsTab(container);
            } else {
              App.showToast('Failed to delete unit', 'error');
            }
          }
        });
      });

      const fUnit = document.getElementById('formUnit');
      if (fUnit && !fUnit.dataset.bound) {
        fUnit.dataset.bound = 'true';
        fUnit.addEventListener('submit', async (e) => {
          e.preventDefault();
          const payload = {
            name: document.getElementById('unitName').value.trim(),
            symbol: document.getElementById('unitSymbol').value.trim(),
          };
          const r = await fetch('/api/units', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (r.ok) {
            App.showToast('Unit created.');
            App.closeModal('modalUnit');
            await App.loadMetadata();
            SettingsView.renderUnitsTab(container);
          } else {
            const err = await r.json();
            App.showToast(err.error || 'Failed to create unit', 'error');
          }
        });
      }
    } catch (err) {
      container.innerHTML = `<div class="alert alert-error">Error loading units: ${err.message}</div>`;
    }
  },

  // ── Tab 4: Fields / Locations ──────────────────────────────────────────────
  async renderFieldsTab(container) {
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
      const res = await fetch('/api/fields');
      const fields = await res.json();

      container.innerHTML = `
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <h3 class="card-title" style="margin-bottom:0;">Farm Fields & Plot Locations</h3>
            <button class="btn btn-primary btn-sm" id="btnAddField"><span>+</span> Add Location</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Field / Section Name</th>
                  <th>Description</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${fields.map(f => `
                  <tr>
                    <td><strong>${f.name}</strong></td>
                    <td>${f.description || '<span style="color:var(--muted);">—</span>'}</td>
                    <td style="text-align:right;">
                      <button class="btn btn-danger btn-sm btn-del-field" data-id="${f.id}" data-name="${f.name}">🗑️</button>
                    </td>
                  </tr>
                `).join('') || '<tr><td colspan="3" style="text-align:center;">No farm locations added yet.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;

      document.getElementById('btnAddField')?.addEventListener('click', () => {
        document.getElementById('formField').reset();
        App.openModal('modalField');
      });

      container.querySelectorAll('.btn-del-field').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm(`Delete location "${btn.dataset.name}"?`)) {
            await fetch(`/api/fields/${btn.dataset.id}`, { method: 'DELETE' });
            App.showToast('Location deleted.');
            await App.loadMetadata();
            this.renderFieldsTab(container);
          }
        });
      });

      const fField = document.getElementById('formField');
      if (fField && !fField.dataset.bound) {
        fField.dataset.bound = 'true';
        fField.addEventListener('submit', async (e) => {
          e.preventDefault();
          const payload = {
            name: document.getElementById('fieldName').value.trim(),
            description: document.getElementById('fieldDesc').value.trim(),
          };
          const r = await fetch('/api/fields', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (r.ok) {
            App.showToast('Location created.');
            App.closeModal('modalField');
            await App.loadMetadata();
            SettingsView.renderFieldsTab(container);
          } else {
            const err = await r.json();
            App.showToast(err.error || 'Failed to create location', 'error');
          }
        });
      }
    } catch (err) {
      container.innerHTML = `<div class="alert alert-error">Error loading fields: ${err.message}</div>`;
    }
  },

  // ── Tab 5: Backup & Restore ────────────────────────────────────────────────
  renderBackupTab(container) {
    container.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:1.5rem;">
        <!-- Download Backup -->
        <div class="card">
          <h3 class="card-title">💾 Backup SQLite Database</h3>
          <p style="font-size:0.875rem; color:var(--muted); margin-bottom:1.25rem;">
            Download a full snapshot of your Tiger Farm database including all products, purchases, usage logs, audit records, and suppliers.
          </p>
          <a href="/api/backup" class="btn btn-primary" download>
            📥 Download Database Snapshot (.db)
          </a>
        </div>

        <!-- Restore Database -->
        <div class="card">
          <h3 class="card-title">🔄 Restore from Backup File</h3>
          <p style="font-size:0.875rem; color:var(--muted); margin-bottom:1rem;">
            Upload a previously downloaded <code>.db</code> file. A temporary safety backup of your existing database will be created automatically before overwriting.
          </p>

          <form id="formRestoreDb" style="display:flex; flex-direction:column; gap:0.75rem;">
            <input type="file" id="restoreFileInput" accept=".db" required />
            <button type="submit" class="btn btn-danger btn-sm" id="btnSubmitRestore" style="align-self:flex-start;">
              ⚠️ Overwrite & Restore Database
            </button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('formRestoreDb')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = document.getElementById('restoreFileInput');
      if (!f.files.length) return;
      if (!confirm('WARNING: Restoring will overwrite all current farm data with the uploaded file. Proceed?')) return;

      const btn = document.getElementById('btnSubmitRestore');
      btn.disabled = true;
      btn.textContent = 'Restoring...';

      const formData = new FormData();
      formData.append('file', f.files[0]);

      try {
        const res = await fetch('/api/restore', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) {
          alert('Database restored successfully! The page will now reload.');
          window.location.reload();
        } else {
          App.showToast(data.error || 'Restore failed', 'error');
        }
      } catch (err) {
        App.showToast('Server error restoring database', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '⚠️ Overwrite & Restore Database';
      }
    });
  },

  // ── Tab 6: Security (Change Password) ───────────────────────────────────────
  renderSecurityTab(container) {
    container.innerHTML = `
      <div class="card" style="max-width:480px;">
        <h3 class="card-title">🔒 Change Account Password</h3>
        <form id="formChangePassword">
          <div class="form-group">
            <label for="curPw">Current Password *</label>
            <input type="password" id="curPw" required autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label for="newPw">New Password * (Min 6 characters)</label>
            <input type="password" id="newPw" required minlength="6" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label for="confPw">Confirm New Password *</label>
            <input type="password" id="confPw" required minlength="6" autocomplete="new-password" />
          </div>
          <button type="submit" class="btn btn-primary" id="btnSubmitPw">Update Password</button>
        </form>
      </div>
    `;

    document.getElementById('formChangePassword')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cur = document.getElementById('curPw').value;
      const nw = document.getElementById('newPw').value;
      const conf = document.getElementById('confPw').value;

      if (nw !== conf) {
        App.showToast('New passwords do not match', 'error');
        return;
      }

      const btn = document.getElementById('btnSubmitPw');
      btn.disabled = true;
      btn.textContent = 'Updating...';

      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current_password: cur, new_password: nw }),
        });
        const data = await res.json();
        if (res.ok) {
          App.showToast('Password changed successfully!');
          document.getElementById('formChangePassword').reset();
        } else {
          App.showToast(data.error || 'Failed to change password', 'error');
        }
      } catch {
        App.showToast('Network error updating password', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Update Password';
      }
    });
  },
};

App.registerView('settings', SettingsView);
