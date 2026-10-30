/**
 * Tiger Farm — Products View Controller
 * All data rendered dynamically from the SQLite database.
 */

const ProductsView = {
  params: {
    search: '',
    category_id: '',
    status: 'all',
    sort_by: 'name',
    page: 1,
    per_page: 15,
  },

  async render(container) {
    // Check if URL has search param
    const hash = window.location.hash;
    if (hash.includes('?')) {
      const qs = new URLSearchParams(hash.split('?')[1]);
      if (qs.has('search')) this.params.search = qs.get('search');
    }

    this.container = container;
    this.renderLayout();
    await this.fetchAndRenderList();
  },

  refresh() {
    this.fetchAndRenderList();
  },

  renderLayout() {
    const cats = App.state.categories || [];
    this.container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Product Master & Inventory Catalog</h1>
          <small>Manage actual farm products, activate/deactivate items, and view package breakdown stock.</small>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="btnExportProductsCsv">📥 Export CSV</button>
          <button class="btn btn-primary" id="btnAddNewProduct"><span>+</span> Add Product</button>
        </div>
      </div>

      <!-- Filters Toolbar -->
      <div class="filters-bar">
        <input type="text" id="prodSearch" placeholder="Filter by product name..." value="${this.params.search}" />

        <select id="prodCategoryFilter">
          <option value="">All Categories</option>
          ${cats.map(c => `<option value="${c.id}" ${this.params.category_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>

        <select id="prodStatusFilter">
          <option value="all" ${this.params.status === 'all' ? 'selected' : ''}>All Catalog Statuses</option>
          <option value="active" ${this.params.status === 'active' ? 'selected' : ''}>Active Products Only</option>
          <option value="inactive" ${this.params.status === 'inactive' ? 'selected' : ''}>Inactive Products Only</option>
          <option value="in_stock" ${this.params.status === 'in_stock' ? 'selected' : ''}>In Stock</option>
          <option value="low_stock" ${this.params.status === 'low_stock' ? 'selected' : ''}>Low Stock</option>
          <option value="out_of_stock" ${this.params.status === 'out_of_stock' ? 'selected' : ''}>Out of Stock</option>
        </select>

        <select id="prodSortFilter">
          <option value="name" ${this.params.sort_by === 'name' ? 'selected' : ''}>Sort by Name</option>
          <option value="quantity" ${this.params.sort_by === 'quantity' ? 'selected' : ''}>Sort by Quantity</option>
          <option value="created_at" ${this.params.sort_by === 'created_at' ? 'selected' : ''}>Sort by Date Added</option>
        </select>

        <button class="btn btn-ghost btn-sm" id="btnResetProdFilters">Reset Filters</button>
      </div>

      <!-- Products Table Container -->
      <div class="card" style="padding:0; overflow:hidden;" id="productsTableContainer">
        <div class="loading-overlay"><div class="spinner"></div></div>
      </div>

      <!-- Pagination -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; font-size:0.875rem;" id="prodPaginationContainer"></div>
    `;

    this.bindFilters();
  },

  async fetchAndRenderList() {
    const tableContainer = document.getElementById('productsTableContainer');
    if (!tableContainer) return;
    tableContainer.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    const q = new URLSearchParams();
    if (this.params.search) q.set('search', this.params.search);
    if (this.params.category_id) q.set('category_id', this.params.category_id);
    if (this.params.status && this.params.status !== 'all') q.set('status', this.params.status);
    if (this.params.sort_by) q.set('sort_by', this.params.sort_by);
    q.set('page', this.params.page);
    q.set('per_page', this.params.per_page);

    try {
      const res = await fetch(`/api/products?${q.toString()}`);
      if (!res.ok) throw new Error('Failed to load products from database');
      const data = await res.json();
      this.renderTable(tableContainer, data.products || [], data.total || 0, data.pages || 1);
    } catch (err) {
      tableContainer.innerHTML = `<div class="alert alert-error" style="margin:1rem;">Error: ${err.message}</div>`;
    }
  },

  renderTable(container, products, total, totalPages) {
    if (!products.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📦</div>
          <h3>No products found</h3>
          <p>Try adjusting your search filters or click "Add Product" to add a new item.</p>
        </div>`;
      document.getElementById('prodPaginationContainer').innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Category</th>
              <th>Status</th>
              <th>Bag Size / Default Qty</th>
              <th>Current Stock</th>
              <th>Package Breakdown</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${products.map(p => {
              const catColor = p.category_color || '#52B788';
              const isAct = p.is_active !== false;

              // Build package breakdown display
              let breakdownHtml = '<span style="color:var(--muted); font-size:0.8rem;">None recorded</span>';
              if (p.package_breakdown && p.package_breakdown.length) {
                breakdownHtml = `
                  <div class="package-breakdown-list">
                    ${p.package_breakdown.map(b => `
                      <span class="package-breakdown-item">
                        📦 ${b.description}
                      </span>
                    `).join('')}
                  </div>
                `;
              } else if (p.current_quantity > 0) {
                breakdownHtml = `
                  <div class="package-breakdown-list">
                    <span class="package-breakdown-item">
                      📦 ${p.current_quantity} ${p.unit || ''} Standard
                    </span>
                  </div>
                `;
              }

              const bagSizeBadge = p.default_package_size ? `
                <div>
                  <span class="badge badge-green" style="font-size:0.85rem; font-weight:600;">
                    🛍️ ${p.default_package_size} ${p.default_package_unit || 'kg'} ${p.default_packaging_type || 'Bag'}
                  </span>
                  <div style="font-size:0.75rem; color:var(--muted); margin-top:0.25rem;">Default: <strong>${p.default_package_count || 1} Bag</strong></div>
                </div>
              ` : '<span style="color:var(--muted); font-size:0.85rem;">Standard</span>';

              // Section 10 & 11: Clear stock display showing where total comes from
              const summaryRows = p.stock_summary || [];
              let stockDisplayHtml = '';
              if (summaryRows.length > 0) {
                stockDisplayHtml = `
                  <div style="font-size:0.82rem; line-height:1.45;">
                    ${summaryRows.map(r => `
                      <div style="display:flex; justify-content:space-between; gap:0.4rem; color:var(--text-mid);">
                        <span>${r.stock_type}: <strong>${r.quantity}</strong></span>
                        <span style="color:var(--muted); font-size:0.76rem;">= ${r.total_kg} ${r.unit}</span>
                      </div>
                    `).join('')}
                    <div style="border-top:1px dashed var(--border); margin-top:0.25rem; padding-top:0.25rem; display:flex; justify-content:space-between; align-items:center;">
                      <strong style="color:var(--green-dark); font-size:0.92rem;">Total Stock: ${p.current_quantity} ${p.unit || ''}</strong>
                    </div>
                  </div>
                `;
              } else {
                stockDisplayHtml = `
                  <strong style="font-size:1.05rem; color:var(--green-dark);">${p.current_quantity}</strong>
                  <span style="font-size:0.8rem; color:var(--muted);">${p.unit || ''}</span>
                `;
              }

              return `
                <tr style="${isAct ? '' : 'opacity:0.65; background:rgba(0,0,0,0.015);'}">
                  <td>
                    <strong style="color:var(--text); cursor:pointer;" class="btn-view-product" data-id="${p.id}">${p.name}</strong>
                    ${p.description ? `<div style="font-size:0.75rem; color:var(--muted);">${p.description}</div>` : ''}
                  </td>
                  <td>
                    <span class="badge" style="background:${catColor}20; color:${catColor}; border:1px solid ${catColor}50;">
                      ${p.category || 'Uncategorized'}
                    </span>
                  </td>
                  <td>
                    <button class="btn-toggle-status ${isAct ? 'active' : 'inactive'}" data-id="${p.id}" data-name="${p.name}" title="Click to ${isAct ? 'deactivate' : 'activate'} product">
                      ${isAct ? '● Active' : '○ Inactive'}
                    </button>
                  </td>
                  <td>
                    ${bagSizeBadge}
                  </td>
                  <td>
                    ${stockDisplayHtml}
                    <div style="font-size:0.72rem; color:var(--muted); margin-top:0.2rem;">Min Alert: ${p.minimum_stock} ${p.unit || ''}</div>
                  </td>
                  <td>
                    ${breakdownHtml}
                  </td>
                  <td style="text-align:right; white-space:nowrap;">
                    <button class="btn btn-ghost btn-sm btn-view-product" data-id="${p.id}" title="History & Audit">🔍 Details</button>
                    <button class="btn btn-ghost btn-sm btn-edit-product" data-id="${p.id}" title="Edit product">✏️</button>
                    <button class="btn btn-danger btn-sm btn-delete-product" data-id="${p.id}" data-name="${p.name}" title="Archive">🗑️</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Render pagination
    const pag = document.getElementById('prodPaginationContainer');
    if (pag) {
      pag.innerHTML = `
        <span style="color:var(--muted);">Showing ${products.length} of ${total} products (Page ${this.params.page} of ${totalPages})</span>
        <div style="display:flex; gap:0.4rem;">
          <button class="btn btn-ghost btn-sm" id="btnProdPrev" ${this.params.page <= 1 ? 'disabled' : ''}>&larr; Previous</button>
          <button class="btn btn-ghost btn-sm" id="btnProdNext" ${this.params.page >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
        </div>
      `;

      document.getElementById('btnProdPrev')?.addEventListener('click', () => {
        if (this.params.page > 1) {
          this.params.page--;
          this.fetchAndRenderList();
        }
      });
      document.getElementById('btnProdNext')?.addEventListener('click', () => {
        if (this.params.page < totalPages) {
          this.params.page++;
          this.fetchAndRenderList();
        }
      });
    }

    this.bindRowActions(container);
  },

  bindFilters() {
    const sInput = document.getElementById('prodSearch');
    let timer;
    sInput?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.params.search = sInput.value.trim();
        this.params.page = 1;
        this.fetchAndRenderList();
      }, 300);
    });

    document.getElementById('prodCategoryFilter')?.addEventListener('change', (e) => {
      this.params.category_id = e.target.value;
      this.params.page = 1;
      this.fetchAndRenderList();
    });

    document.getElementById('prodStatusFilter')?.addEventListener('change', (e) => {
      this.params.status = e.target.value;
      this.params.page = 1;
      this.fetchAndRenderList();
    });

    document.getElementById('prodSortFilter')?.addEventListener('change', (e) => {
      this.params.sort_by = e.target.value;
      this.params.page = 1;
      this.fetchAndRenderList();
    });

    document.getElementById('btnResetProdFilters')?.addEventListener('click', () => {
      this.params = { search: '', category_id: '', status: 'all', sort_by: 'name', page: 1, per_page: 15 };
      this.renderLayout();
      this.fetchAndRenderList();
    });

    // Helper to calculate opening or current stock live (Section 6-9, 18)
    const updateOpeningStockCalc = (forceIsEdit) => {
      const editId = document.getElementById('productEditId')?.value;
      const isEdit = forceIsEdit !== undefined ? forceIsEdit : Boolean(editId);

      const sel = document.getElementById('productUnitPackage');
      if (!sel) return;
      const opt = sel.options[sel.selectedIndex];
      if (!opt) return;

      const pType = opt.dataset.type || 'Bag';
      const pSize = parseFloat(opt.dataset.size) || 1.0;
      const pUnit = opt.dataset.unit || 'kg';
      const pBase = opt.dataset.base || 'kg';
      const pMult = parseFloat(opt.dataset.mult) || pSize;

      const bagIn = document.getElementById('productBagQuantity');
      const looseIn = document.getElementById('productLooseQuantity');
      const bagRow = document.getElementById('openingBagRow');
      const bagText = document.getElementById('openingBagText');
      const bagLabel = document.getElementById('openingBagLabel');
      const looseRow = document.getElementById('openingLooseRow');
      const looseText = document.getElementById('openingLooseText');
      const looseRowLabel = document.getElementById('openingLooseLabel');
      const totalText = document.getElementById('openingTotalText');
      const totalLabel = document.getElementById('openingTotalLabel');
      const cardTitle = document.getElementById('productOpeningCardTitle');
      const badge = document.getElementById('productOpeningBadge');
      const bagGroup = document.getElementById('productBagQtyGroup');
      const bagInputLabel = document.getElementById('productBagQuantityLabel');
      const bagInputHint = document.getElementById('productBagQtyHint');
      const looseGroup = document.getElementById('productLooseQtyGroup');
      const looseInputLabel = document.getElementById('productLooseQuantityLabel');
      const looseInputHint = document.getElementById('productLooseQtyHint');

      const isBag = pType.toLowerCase() === 'bag' && !opt.value.startsWith('gen_');
      const isBottle = pType.toLowerCase() === 'bottle' && !opt.value.startsWith('gen_');
      const isDiscretePkg = (isBag || isBottle || ['pouch', 'container', 'drum', 'box'].includes(pType.toLowerCase())) && pSize > 0 && !opt.value.startsWith('gen_') && !opt.value.includes('loose');

      const bagQty = parseFloat(bagIn?.value) || 0.0;
      const looseQty = isDiscretePkg ? (parseFloat(looseIn?.value) || 0.0) : 0.0;

      // Update card headers
      if (cardTitle) cardTitle.textContent = isEdit ? 'Stock Adjustment & Balance' : 'Opening Stock Calculation';
      if (badge) badge.textContent = isEdit ? 'Current Stock' : 'Live Summary';
      if (totalLabel) totalLabel.textContent = isEdit ? 'TOTAL CURRENT STOCK:' : 'TOTAL OPENING STOCK:';

      if (!isDiscretePkg) {
        // Plain / Direct Unit (KG, Liter, Gram, Ton, Loose KG, Loose L, etc.)
        if (bagGroup) bagGroup.style.display = 'block';
        if (bagInputLabel) bagInputLabel.textContent = `${isEdit ? 'Current Stock' : 'Quantity'} (${pUnit}) *`;
        if (bagInputHint) bagInputHint.textContent = `Enter total quantity in ${pUnit} (e.g. 25)`;
        if (bagIn) bagIn.placeholder = 'e.g. 25';

        // Hide loose quantity input (avoids asking for loose quantity when product itself is KG)
        if (looseGroup) looseGroup.style.display = 'none';
        if (looseIn) looseIn.value = '0';

        // Hide calculation breakdown rows; show clean direct stock
        if (bagRow) bagRow.style.display = 'none';
        if (looseRow) looseRow.style.display = 'none';
        if (totalText) totalText.textContent = `${bagQty} ${pUnit}`;

        // Sync hidden inputs
        if (document.getElementById('productDefaultPackagingType')) document.getElementById('productDefaultPackagingType').value = 'Unit';
        if (document.getElementById('productDefaultPackageSize')) document.getElementById('productDefaultPackageSize').value = '1';
        if (document.getElementById('productDefaultPackageUnit')) document.getElementById('productDefaultPackageUnit').value = pUnit;
        if (document.getElementById('productDefaultQuantity')) document.getElementById('productDefaultQuantity').value = bagQty;
        if (document.getElementById('productInitialQty')) document.getElementById('productInitialQty').value = bagQty;
      } else {
        // Discrete Package (25 kg Bag, 50 kg Bag, 1 L Bottle, etc.)
        if (bagGroup) bagGroup.style.display = 'block';
        const nounSingular = isBag ? 'Bag' : (isBottle ? 'Bottle' : pType);
        const nounPlural = isBag ? 'Bags' : (isBottle ? 'Bottles' : `${pType}s`);
        
        if (bagInputLabel) bagInputLabel.textContent = `${isEdit ? 'Current ' : ''}${nounSingular} Quantity (${nounPlural}) *`;
        if (bagInputHint) bagInputHint.textContent = `Number of ${nounPlural.toLowerCase()} (default: 1)`;
        if (bagIn) bagIn.placeholder = '1';

        if (looseGroup) looseGroup.style.display = 'block';
        if (looseInputLabel) looseInputLabel.textContent = `Loose Quantity (Optional, ${pBase})`;
        if (looseInputHint) looseInputHint.textContent = `Additional loose ${pBase} stock (e.g. 5)`;

        if (bagRow) bagRow.style.display = 'flex';
        if (looseRow) looseRow.style.display = 'flex';

        const bagWeight = Math.round(bagQty * pMult * 10000) / 10000;
        const total = Math.round((bagWeight + looseQty) * 10000) / 10000;

        const countNoun = bagQty === 1 ? nounSingular : nounPlural;
        if (bagLabel) bagLabel.textContent = `${nounSingular} Stock:`;
        if (bagText) bagText.textContent = `${bagQty} ${countNoun} × ${pSize} ${pUnit} = ${bagWeight} ${pBase}`;
        if (looseRowLabel) looseRowLabel.textContent = `Loose Stock:`;
        if (looseText) looseText.textContent = `${looseQty} ${pBase}`;
        if (totalText) totalText.textContent = `${total} ${pBase}`;

        // Sync hidden inputs
        if (document.getElementById('productDefaultPackagingType')) document.getElementById('productDefaultPackagingType').value = pType;
        if (document.getElementById('productDefaultPackageSize')) document.getElementById('productDefaultPackageSize').value = pSize;
        if (document.getElementById('productDefaultPackageUnit')) document.getElementById('productDefaultPackageUnit').value = pUnit;
        if (document.getElementById('productDefaultQuantity')) document.getElementById('productDefaultQuantity').value = bagQty || 1;
        if (document.getElementById('productInitialQty')) document.getElementById('productInitialQty').value = total;
      }

      // Match unit_id
      const uMatch = (App.state.units || []).find(u => 
        u.symbol.toLowerCase() === pBase.toLowerCase() || 
        u.symbol.toLowerCase() === pUnit.toLowerCase() ||
        u.name.toLowerCase() === pUnit.toLowerCase()
      );
      if (uMatch && document.getElementById('productUnit')) {
        document.getElementById('productUnit').value = uMatch.id;
      }
    };

    const pkgSel = document.getElementById('productUnitPackage');
    if (pkgSel && !pkgSel.dataset.bound) {
      pkgSel.dataset.bound = 'true';
      pkgSel.addEventListener('change', () => {
        const selOpt = pkgSel.options[pkgSel.selectedIndex];
        const isDiscrete = selOpt && selOpt.dataset.size && parseFloat(selOpt.dataset.size) > 0 && !selOpt.value.startsWith('gen_') && !selOpt.value.includes('loose');
        const bagIn = document.getElementById('productBagQuantity');
        const isEdit = Boolean(document.getElementById('productEditId')?.value);
        if (isDiscrete && bagIn && (!bagIn.value || parseFloat(bagIn.value) <= 0) && !isEdit) {
          bagIn.value = '1';
        }
        updateOpeningStockCalc();
      });
      document.getElementById('productBagQuantity')?.addEventListener('input', () => updateOpeningStockCalc());
      document.getElementById('productLooseQuantity')?.addEventListener('input', () => updateOpeningStockCalc());
    }

    // Add Product Modal open
    document.getElementById('btnAddNewProduct')?.addEventListener('click', () => {
      document.getElementById('formProduct').reset();
      document.getElementById('productEditId').value = '';
      document.getElementById('modalProductTitle').textContent = 'Add New Product';
      document.getElementById('btnSubmitProduct').textContent = 'Save Product';
      
      const openInputs = document.getElementById('productOpeningStockInputs');
      const openCard = document.getElementById('productOpeningStockCard');
      if (openInputs) openInputs.style.display = 'flex';
      if (openCard) openCard.style.display = 'block';

      if (pkgSel) pkgSel.value = 'pkg_bag_25';
      if (document.getElementById('productBagQuantity')) document.getElementById('productBagQuantity').value = '1';
      if (document.getElementById('productLooseQuantity')) document.getElementById('productLooseQuantity').value = '0';
      if (document.getElementById('productMinStock')) document.getElementById('productMinStock').value = '5';
      if (document.getElementById('productStatusSelect')) document.getElementById('productStatusSelect').value = 'true';

      updateOpeningStockCalc(false);
      App.openModal('modalProduct');
    });

    // Export CSV
    document.getElementById('btnExportProductsCsv')?.addEventListener('click', () => {
      window.open('/api/export/products', '_blank');
    });

    // Submit Product Form with database confirmation check (Section 15)
    const fProd = document.getElementById('formProduct');
    if (fProd && !fProd.dataset.bound) {
      fProd.dataset.bound = 'true';
      fProd.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('productEditId').value;
        const btn = document.getElementById('btnSubmitProduct');
        btn.disabled = true;
        btn.textContent = editId ? 'Saving Changes...' : 'Saving to Database...';

        updateOpeningStockCalc();

        const payload = {
          name: document.getElementById('productName').value.trim(),
          category_id: document.getElementById('productCategory').value,
          unit_id: document.getElementById('productUnit').value,
          minimum_stock: document.getElementById('productMinStock').value,
          description: document.getElementById('productDesc').value.trim(),
          is_active: document.getElementById('productStatusSelect').value === 'true',
          default_packaging_type: document.getElementById('productDefaultPackagingType')?.value || 'Bag',
          default_package_size: document.getElementById('productDefaultPackageSize')?.value || null,
          default_package_unit: document.getElementById('productDefaultPackageUnit')?.value || 'kg',
          default_package_count: document.getElementById('productDefaultQuantity')?.value || 1,
          bag_quantity: parseFloat(document.getElementById('productBagQuantity')?.value) || 0,
          loose_quantity: parseFloat(document.getElementById('productLooseQuantity')?.value) || 0,
          current_quantity: parseFloat(document.getElementById('productInitialQty')?.value) || 0,
        };

        try {
          const url = editId ? `/api/products/${editId}` : '/api/products';
          const method = editId ? 'PUT' : 'POST';
          const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            App.showToast(data.message || (editId ? 'Product changes saved successfully!' : 'Product saved successfully to database!'));
            App.closeModal('modalProduct');
            await App.loadMetadata();
            ProductsView.fetchAndRenderList();
          } else {
            const err = data.message || data.error || 'Unable to save product. Please try again.';
            App.showToast(err, 'error');
          }
        } catch (err) {
          App.showToast('Unable to save product. Please try again: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = editId ? 'Save Changes' : 'Save Product';
        }
      });
    }
  },

  bindRowActions(container) {
    // View Product Detail Drawer
    container.querySelectorAll('.btn-view-product').forEach(btn => {
      btn.addEventListener('click', () => {
        this.openProductDetail(btn.dataset.id);
      });
    });

    // Toggle Product Active / Inactive Status
    container.querySelectorAll('.btn-toggle-status').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/products/${id}/toggle-status`, { method: 'POST' });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            App.showToast(data.message || `Status updated for "${name}".`);
            await App.loadMetadata();
            this.fetchAndRenderList();
          } else {
            App.showToast(data.message || 'Failed to update status', 'error');
          }
        } catch (err) {
          App.showToast('Error: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Edit Product
    container.querySelectorAll('.btn-edit-product').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          const res = await fetch(`/api/products/${id}`);
          if (!res.ok) throw new Error('Could not fetch details from database');
          const data = await res.json();
          const p = data.product || data.data;

          document.getElementById('productEditId').value = p.id;
          document.getElementById('modalProductTitle').textContent = `Edit "${p.name}"`;
          document.getElementById('btnSubmitProduct').textContent = 'Save Changes';
          document.getElementById('productName').value = p.name;

          // Ensure category dropdown is populated and selected
          const catSel = document.getElementById('productCategory');
          if (catSel) {
            if (catSel.options.length <= 1 && App.state.categories?.length) {
              catSel.innerHTML = '<option value="">Select category...</option>' +
                App.state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            }
            catSel.value = p.category_id ? String(p.category_id) : '';
          }

          document.getElementById('productUnit').value = p.unit_id || '';
          document.getElementById('productMinStock').value = p.minimum_stock;
          document.getElementById('productStatusSelect').value = p.is_active ? 'true' : 'false';
          document.getElementById('productDesc').value = p.description || '';

          // Match unit / package dropdown option
          const pkgSel = document.getElementById('productUnitPackage');
          if (pkgSel) {
            let matchOpt = null;
            const pType = (p.default_packaging_type || '').toLowerCase();
            const pSize = parseFloat(p.default_package_size);
            const pUnit = (p.default_package_unit || p.unit || '').toLowerCase();

            // 1st pass: match by package size + packaging type
            for (let i = 0; i < pkgSel.options.length; i++) {
              const opt = pkgSel.options[i];
              const optType = (opt.dataset.type || '').toLowerCase();
              const optSize = parseFloat(opt.dataset.size);
              if (pSize && Math.abs(optSize - pSize) < 0.001 && optType === pType) {
                matchOpt = opt;
                break;
              }
            }
            // 2nd pass: loose / direct unit matching
            if (!matchOpt) {
              for (let i = 0; i < pkgSel.options.length; i++) {
                const opt = pkgSel.options[i];
                const optUnit = (opt.dataset.unit || '').toLowerCase();
                const optBase = (opt.dataset.base || '').toLowerCase();
                const optType = (opt.dataset.type || '').toLowerCase();
                if (optUnit === pUnit || optBase === pUnit) {
                  if ((pType === 'loose' || pType === 'unit') && (optType === 'loose' || optType === 'unit')) {
                    matchOpt = opt;
                    break;
                  } else if (!matchOpt) {
                    matchOpt = opt;
                  }
                }
              }
            }
            if (matchOpt) {
              pkgSel.value = matchOpt.value;
            }
          }

          if (document.getElementById('productDefaultPackagingType')) {
            document.getElementById('productDefaultPackagingType').value = p.default_packaging_type || 'Bag';
          }
          if (document.getElementById('productDefaultPackageSize')) {
            document.getElementById('productDefaultPackageSize').value = p.default_package_size || '';
          }
          if (document.getElementById('productDefaultQuantity')) {
            document.getElementById('productDefaultQuantity').value = p.default_package_count || 1;
          }

          // Keep current stock inputs and live card visible so user can adjust quantity
          const openInputs = document.getElementById('productOpeningStockInputs');
          const openCard = document.getElementById('productOpeningStockCard');
          if (openInputs) openInputs.style.display = 'flex';
          if (openCard) openCard.style.display = 'block';

          const bagIn = document.getElementById('productBagQuantity');
          const looseIn = document.getElementById('productLooseQuantity');
          if (bagIn) {
            if (p.bag_stock !== undefined && p.bag_stock !== null && p.bag_stock > 0) {
              bagIn.value = p.bag_stock;
            } else if (p.default_package_size && p.default_package_size > 0 && (p.default_packaging_type || '').toLowerCase() === 'bag') {
              bagIn.value = p.default_package_count || (Math.round((p.current_quantity / p.default_package_size) * 100) / 100) || 1;
            } else {
              bagIn.value = p.current_quantity || 0;
            }
          }
          if (looseIn) {
            looseIn.value = (p.loose_stock !== undefined && p.loose_stock !== null) ? p.loose_stock : 0;
          }

          updateOpeningStockCalc(true);
          App.openModal('modalProduct');
        } catch (err) {
          App.showToast(err.message, 'error');
        }
      });
    });

    // Delete (Archive) Product
    container.querySelectorAll('.btn-delete-product').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        if (confirm(`Archive product "${name}"? Historical purchases, usages, and ledger records will be preserved.`)) {
          try {
            const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
            const d = await res.json();
            if (res.ok && d.success !== false) {
              App.showToast(d.message || `"${name}" archived.`);
              await App.loadMetadata();
              this.fetchAndRenderList();
            } else {
              App.showToast(d.message || d.error || 'Failed to archive product', 'error');
            }
          } catch (err) {
            App.showToast('Server error while archiving product: ' + err.message, 'error');
          }
        }
      });
    });
  },

  // SECTION 21: Full Product Details with Purchase History, Usage History, Ledger, and Package Breakdown
  async openProductDetail(productId) {
    App.openModal('modalProductDetail');
    const body = document.getElementById('productDetailBody');
    body.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    document.getElementById('btnExportProductPdf').onclick = () => {
      window.open(`/api/reports/product/${productId}/pdf`, '_blank');
    };

    try {
      const res = await fetch(`/api/products/${productId}`);
      if (!res.ok) throw new Error('Product not found in database');
      const data = await res.json();
      const p = data.product || data.data;

      document.getElementById('productDetailName').textContent = p.name;
      const statusBadge = document.getElementById('productDetailStatus');
      statusBadge.className = `badge badge-${p.status === 'out_of_stock' ? 'red' : p.status === 'low_stock' ? 'amber' : 'green'}`;
      statusBadge.textContent = p.status === 'out_of_stock' ? 'Out of Stock' : p.status === 'low_stock' ? 'Low Stock' : 'In Stock';

      body.innerHTML = `
        <!-- High Level Stats -->
        <div class="stats-grid" style="margin-bottom:1.25rem;">
          <div class="stat-item">
            <div class="stat-label">Current Stock</div>
            <div class="stat-value green">${p.current_quantity} <small style="font-size:0.85rem;">${p.unit || ''}</small></div>
            <div class="stat-sub">Alert threshold: ${p.minimum_stock} ${p.unit || ''}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Catalog Status</div>
            <div class="stat-value" style="font-size:1.15rem; color:${p.is_active ? 'var(--green-dark)' : 'var(--red)'};">
              ${p.is_active ? '● Active' : '○ Inactive'}
            </div>
            <div class="stat-sub">${p.category || 'Fertilizer'}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Total Purchased</div>
            <div class="stat-value">${p.total_purchased || 0} <small style="font-size:0.85rem;">${p.unit || ''}</small></div>
            <div class="stat-sub">Lifetime received</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Total Used</div>
            <div class="stat-value">${p.total_used || 0} <small style="font-size:0.85rem;">${p.unit || ''}</small></div>
            <div class="stat-sub">Lifetime consumed</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Total Purchase Cost</div>
            <div class="stat-value">₹${(p.total_purchase_cost || 0).toLocaleString('en-IN')}</div>
            <div class="stat-sub">Cumulative input spend</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Avg Purchase Price</div>
            <div class="stat-value">₹${p.average_purchase_price || 0}</div>
            <div class="stat-sub">Per ${p.unit || 'unit'}</div>
          </div>
        </div>

        <!-- Section 24: Structured Stock Summary Table -->
        <div style="background:rgba(82,183,136,0.08); border:1.5px solid rgba(82,183,136,0.3); border-radius:var(--radius); padding:0.9rem 1.1rem; margin-bottom:1.25rem;">
          <h4 style="font-size:0.95rem; margin-bottom:0.6rem; color:var(--green-dark); display:flex; align-items:center; gap:0.4rem;">
            <span>📦</span> Stock Summary (Section 24 Package & Loose Breakdown)
          </h4>
          <div class="table-wrap" style="background:#fff; border-radius:6px; overflow:hidden; border:1px solid var(--border);">
            <table style="width:100%; border-collapse:collapse; margin:0;">
              <thead>
                <tr style="background:rgba(45,106,79,0.06); text-align:left;">
                  <th style="padding:8px 12px;">Stock Type</th>
                  <th style="padding:8px 12px; text-align:right;">Quantity</th>
                  <th style="padding:8px 12px; text-align:right;">Total ${p.unit || 'KG'}</th>
                </tr>
              </thead>
              <tbody>
                ${(p.stock_summary && p.stock_summary.length) ? p.stock_summary.map(r => `
                  <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:7px 12px;">
                      <strong>${r.stock_type}</strong>
                    </td>
                    <td style="padding:7px 12px; text-align:right;">
                      <span class="badge ${r.is_loose ? 'badge-amber' : 'badge-green'}">${r.quantity}</span>
                    </td>
                    <td style="padding:7px 12px; text-align:right; font-weight:700; color:var(--green-dark);">
                      ${r.total_kg} ${r.unit}
                    </td>
                  </tr>
                `).join('') : `
                  <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:7px 12px;"><strong>Standard Inventory</strong></td>
                    <td style="padding:7px 12px; text-align:right;">${p.current_quantity} ${p.unit || ''}</td>
                    <td style="padding:7px 12px; text-align:right; font-weight:700; color:var(--green-dark);">${p.current_quantity} ${p.unit || ''}</td>
                  </tr>
                `}
                <tr style="background:rgba(82,183,136,0.14); font-weight:800;">
                  <td style="padding:9px 12px; color:var(--green-dark); font-size:0.95rem;">TOTAL STOCK</td>
                  <td style="padding:9px 12px; text-align:right; color:var(--muted); font-size:0.85rem;">${p.bag_stock ? `${p.bag_stock} Bags` : ''}${p.bag_stock && p.loose_stock ? ' + ' : ''}${p.loose_stock ? `${p.loose_stock} Loose` : ''}</td>
                  <td style="padding:9px 12px; text-align:right; color:#1b4332; font-size:1.1rem; font-weight:800;">${p.current_quantity} ${p.unit || ''}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Purchase History Table -->
        <h4 style="font-size:0.95rem; margin-bottom:0.4rem; display:flex; align-items:center; gap:0.4rem;">
          <span>🛒</span> Purchase History
        </h4>
        <div class="table-wrap" style="max-height:160px; overflow-y:auto; margin-bottom:1.25rem;">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Package / Quantity</th>
                <th>Rate</th>
                <th>Total</th>
                <th>Supplier</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              ${(p.purchases || []).map(purch => `
                <tr>
                  <td>${purch.purchase_date}</td>
                  <td><strong>${purch.package_summary || `${purch.quantity} ${p.unit || ''}`}</strong></td>
                  <td>₹${purch.unit_price || 0}</td>
                  <td><strong>₹${(purch.total_price || 0).toLocaleString('en-IN')}</strong></td>
                  <td>${purch.supplier_name || purch.supplier || '—'}</td>
                  <td>${purch.invoice_number ? `<code>${purch.invoice_number}</code>` : '—'}</td>
                </tr>
              `).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--muted);">No purchase records.</td></tr>'}
            </tbody>
          </table>
        </div>

        <!-- Section 21: Usage History Table -->
        <h4 style="font-size:0.95rem; margin-bottom:0.4rem; display:flex; align-items:center; gap:0.4rem;">
          <span>🌾</span> Usage History
        </h4>
        <div class="table-wrap" style="max-height:160px; overflow-y:auto; margin-bottom:1.25rem;">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Quantity Used</th>
                <th>Field Location</th>
                <th>Reason / Application</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${(p.usages || []).map(u => `
                <tr>
                  <td>${u.usage_date}</td>
                  <td><strong style="color:var(--red);">-${u.quantity} ${p.unit || ''}</strong></td>
                  <td>${u.field_location || 'General'}</td>
                  <td>${u.reason || '—'}</td>
                  <td>${u.remarks || '—'}</td>
                </tr>
              `).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--muted);">No usage records.</td></tr>'}
            </tbody>
          </table>
        </div>

        <!-- Section 21: Stock Movement Ledger History -->
        <h4 style="font-size:0.95rem; margin-bottom:0.4rem; display:flex; align-items:center; gap:0.4rem;">
          <span>📜</span> Stock Movement Ledger (Audit Trail)
        </h4>
        <div class="table-wrap" style="max-height:180px; overflow-y:auto;">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Change</th>
                <th>Balance After</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${(p.stock_movements || []).map(m => `
                <tr>
                  <td>${m.movement_date}</td>
                  <td><span class="badge ${m.movement_type === 'PURCHASE' ? 'badge-green' : m.movement_type === 'USAGE' ? 'badge-amber' : 'badge-muted'}">${m.movement_type}</span></td>
                  <td><strong>${m.quantity > 0 ? '+' : ''}${m.quantity} ${p.unit || ''}</strong></td>
                  <td><strong>${m.balance_after} ${p.unit || ''}</strong></td>
                  <td>${m.remarks || '—'}</td>
                </tr>
              `).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--muted);">No ledger movements recorded.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      body.innerHTML = `<div class="alert alert-error">Error loading product details from database: ${err.message}</div>`;
    }
  },
};

App.registerView('products', ProductsView);
