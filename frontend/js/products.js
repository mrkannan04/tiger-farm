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
          <h1 class="page-title">Products & Inventory Catalog</h1>
          <small>Manage inventory, stock thresholds, and view complete audit movements.</small>
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
          <option value="all" ${this.params.status === 'all' ? 'selected' : ''}>All Stock Statuses</option>
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
              <th>Current Stock</th>
              <th>Min Stock</th>
              <th>Status</th>
              <th>Valuation</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${products.map(p => {
              const statusBadge =
                p.status === 'out_of_stock' ? '<span class="badge badge-red">Out of Stock</span>' :
                p.status === 'low_stock' ? '<span class="badge badge-amber">Low Stock</span>' :
                '<span class="badge badge-green">In Stock</span>';

              const catColor = p.category_color || '#52B788';
              return `
                <tr>
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
                    <strong style="font-size:1rem;">${p.current_quantity}</strong>
                    <span style="font-size:0.8rem; color:var(--muted);">${p.unit || ''}</span>
                  </td>
                  <td>${p.minimum_stock} <span style="font-size:0.8rem; color:var(--muted);">${p.unit || ''}</span></td>
                  <td>${statusBadge}</td>
                  <td>₹${(p.estimated_stock_value || 0).toLocaleString('en-IN')}</td>
                  <td style="text-align:right;">
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

    // Add Product Modal open
    document.getElementById('btnAddNewProduct')?.addEventListener('click', () => {
      document.getElementById('formProduct').reset();
      document.getElementById('productEditId').value = '';
      document.getElementById('modalProductTitle').textContent = 'Add New Product';
      document.getElementById('initialQtyGroup').style.display = 'block';
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
        btn.textContent = 'Saving to Database...';

        const payload = {
          name: document.getElementById('productName').value.trim(),
          category_id: document.getElementById('productCategory').value,
          unit_id: document.getElementById('productUnit').value,
          minimum_stock: document.getElementById('productMinStock').value,
          description: document.getElementById('productDesc').value.trim(),
        };

        if (!editId) {
          payload.current_quantity = document.getElementById('productInitialQty').value;
        }

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
            App.showToast(data.message || 'Product saved successfully to database!');
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
          btn.textContent = 'Save Product';
        }
      });
    }
  },

  bindRowActions(container) {
    // View Product Detail Drawer (Section 21)
    container.querySelectorAll('.btn-view-product').forEach(btn => {
      btn.addEventListener('click', () => {
        this.openProductDetail(btn.dataset.id);
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
          document.getElementById('productName').value = p.name;
          document.getElementById('productCategory').value = p.category_id || '';
          document.getElementById('productUnit').value = p.unit_id || '';
          document.getElementById('productMinStock').value = p.minimum_stock;
          document.getElementById('productDesc').value = p.description || '';
          document.getElementById('initialQtyGroup').style.display = 'none';

          App.openModal('modalProduct');
        } catch (err) {
          App.showToast(err.message, 'error');
        }
      });
    });

    // Delete (Archive) Product (Section 48, 49)
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

  // SECTION 21: Full Product Details with Purchase History, Usage History, and Ledger
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
        <!-- High Level Stats (Section 21) -->
        <div class="stats-grid" style="margin-bottom:1.25rem;">
          <div class="stat-item">
            <div class="stat-label">Current Stock</div>
            <div class="stat-value green">${p.current_quantity} <small style="font-size:0.85rem;">${p.unit || ''}</small></div>
            <div class="stat-sub">Alert threshold: ${p.minimum_stock} ${p.unit || ''}</div>
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
          <div class="stat-item">
            <div class="stat-label">Last Transactions</div>
            <div style="font-size:0.85rem; font-weight:600; margin-top:0.25rem;">
              <div>🛒 Buy: <span style="color:var(--text-mid);">${p.last_purchase_date || 'None'}</span></div>
              <div>🌾 Use: <span style="color:var(--text-mid);">${p.last_usage_date || 'None'}</span></div>
            </div>
          </div>
        </div>

        <!-- Section 21: Purchase History Table -->
        <h4 style="font-size:0.95rem; margin-bottom:0.4rem; display:flex; align-items:center; gap:0.4rem;">
          <span>🛒</span> Purchase History
        </h4>
        <div class="table-wrap" style="max-height:160px; overflow-y:auto; margin-bottom:1.25rem;">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Quantity</th>
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
                  <td><strong>${purch.quantity} ${p.unit || ''}</strong></td>
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
