/**
 * Tiger Farm — Purchases View Controller
 */

const PurchasesView = {
  params: {
    search: '',
    start_date: '',
    end_date: '',
    page: 1,
    per_page: 15,
  },

  async render(container) {
    this.container = container;
    this.renderLayout();
    await this.fetchAndRenderList();
  },

  refresh() {
    this.fetchAndRenderList();
  },

  renderLayout() {
    this.container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Purchases & Vendor Invoices</h1>
          <small>Track input costs, vendor invoices, unit rates, and receipt attachments.</small>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="btnExportPurchasesPdf">📄 PDF Report</button>
          <button class="btn btn-secondary" id="btnExportPurchasesCsv">📥 Export CSV</button>
          <button class="btn btn-primary" id="btnOpenNewPurchase"><span>+</span> Record Purchase</button>
        </div>
      </div>

      <!-- Filters & Date Range Bar -->
      <div class="filters-bar">
        <input type="text" id="purchSearch" placeholder="Search product, supplier, invoice..." value="${this.params.search}" />

        <div style="display:flex; align-items:center; gap:0.4rem;">
          <label style="font-size:0.75rem; font-weight:600; color:var(--muted);">FROM:</label>
          <input type="date" id="purchStartDate" value="${this.params.start_date}" />
        </div>

        <div style="display:flex; align-items:center; gap:0.4rem;">
          <label style="font-size:0.75rem; font-weight:600; color:var(--muted);">TO:</label>
          <input type="date" id="purchEndDate" value="${this.params.end_date}" />
        </div>

        <button class="btn btn-ghost btn-sm" id="btnResetPurchFilters">Reset</button>

        <div style="margin-left:auto; display:flex; align-items:center; gap:0.5rem;" id="purchTotalSummary"></div>
      </div>

      <!-- Table Container -->
      <div class="card" style="padding:0; overflow:hidden;" id="purchasesTableContainer">
        <div class="loading-overlay"><div class="spinner"></div></div>
      </div>

      <!-- Pagination -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; font-size:0.875rem;" id="purchPaginationContainer"></div>
    `;

    this.bindFilters();
  },

  async fetchAndRenderList() {
    const tableContainer = document.getElementById('purchasesTableContainer');
    if (!tableContainer) return;
    tableContainer.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    const q = new URLSearchParams();
    if (this.params.search) q.set('search', this.params.search);
    if (this.params.start_date) q.set('start_date', this.params.start_date);
    if (this.params.end_date) q.set('end_date', this.params.end_date);
    q.set('page', this.params.page);
    q.set('per_page', this.params.per_page);

    try {
      const res = await fetch(`/api/purchases?${q.toString()}`);
      if (!res.ok) throw new Error('Failed to load purchases');
      const data = await res.json();
      this.renderTable(tableContainer, data.purchases || [], data.total || 0, data.pages || 1, data.total_cost || 0);
    } catch (err) {
      tableContainer.innerHTML = `<div class="alert alert-error" style="margin:1rem;">Error: ${err.message}</div>`;
    }
  },

  renderTable(container, purchases, total, totalPages, totalCost) {
    const totalEl = document.getElementById('purchTotalSummary');
    if (totalEl) {
      totalEl.innerHTML = `<span class="badge badge-green" style="font-size:0.85rem; padding:0.4rem 0.8rem;">Page Total: ₹${totalCost.toLocaleString('en-IN')}</span>`;
    }

    if (!purchases.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛒</div>
          <h3>No purchases found</h3>
          <p>No purchase records match the selected date range or search query.</p>
        </div>`;
      document.getElementById('purchPaginationContainer').innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit Rate</th>
              <th>Total Cost</th>
              <th>Supplier</th>
              <th>Invoice #</th>
              <th>Bill Attachment</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${purchases.map(p => `
              <tr>
                <td><strong>${p.purchase_date}</strong></td>
                <td>
                  <strong style="color:var(--text);">${p.product_name}</strong>
                  ${p.remarks ? `<div style="font-size:0.75rem; color:var(--muted);">${p.remarks}</div>` : ''}
                </td>
                <td><strong>${p.quantity}</strong> <span style="font-size:0.8rem; color:var(--muted);">${p.unit || ''}</span></td>
                <td>₹${(p.unit_price || 0).toLocaleString('en-IN')}</td>
                <td><strong style="color:var(--green-dark);">₹${(p.total_price || 0).toLocaleString('en-IN')}</strong></td>
                <td>${p.supplier_name || '<span style="color:var(--muted);">—</span>'}</td>
                <td>${p.invoice_number ? `<code>${p.invoice_number}</code>` : '<span style="color:var(--muted);">—</span>'}</td>
                <td>
                  ${p.bill_file ?
                    `<a href="/uploads/bills/${p.bill_file}" target="_blank" class="badge badge-blue" style="text-decoration:none;">📎 View Bill</a>` :
                    '<span style="color:var(--muted); font-size:0.8rem;">None</span>'
                  }
                </td>
                <td style="text-align:right;">
                  <button class="btn btn-danger btn-sm btn-delete-purchase" data-id="${p.id}" data-prod="${p.product_name}" data-qty="${p.quantity} ${p.unit || ''}" title="Delete & reverse stock">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Pagination
    const pag = document.getElementById('purchPaginationContainer');
    if (pag) {
      pag.innerHTML = `
        <span style="color:var(--muted);">Showing ${purchases.length} of ${total} records (Page ${this.params.page} of ${totalPages})</span>
        <div style="display:flex; gap:0.4rem;">
          <button class="btn btn-ghost btn-sm" id="btnPurchPrev" ${this.params.page <= 1 ? 'disabled' : ''}>&larr; Previous</button>
          <button class="btn btn-ghost btn-sm" id="btnPurchNext" ${this.params.page >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
        </div>
      `;

      document.getElementById('btnPurchPrev')?.addEventListener('click', () => {
        if (this.params.page > 1) {
          this.params.page--;
          this.fetchAndRenderList();
        }
      });
      document.getElementById('btnPurchNext')?.addEventListener('click', () => {
        if (this.params.page < totalPages) {
          this.params.page++;
          this.fetchAndRenderList();
        }
      });
    }

    this.bindRowActions(container);
  },

  bindFilters() {
    const sInput = document.getElementById('purchSearch');
    let timer;
    sInput?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.params.search = sInput.value.trim();
        this.params.page = 1;
        this.fetchAndRenderList();
      }, 300);
    });

    document.getElementById('purchStartDate')?.addEventListener('change', (e) => {
      this.params.start_date = e.target.value;
      this.params.page = 1;
      this.fetchAndRenderList();
    });

    document.getElementById('purchEndDate')?.addEventListener('change', (e) => {
      this.params.end_date = e.target.value;
      this.params.page = 1;
      this.fetchAndRenderList();
    });

    document.getElementById('btnResetPurchFilters')?.addEventListener('click', () => {
      this.params = { search: '', start_date: '', end_date: '', page: 1, per_page: 15 };
      this.renderLayout();
      this.fetchAndRenderList();
    });

    document.getElementById('btnOpenNewPurchase')?.addEventListener('click', () => {
      document.getElementById('formPurchase').reset();
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('purchaseDate').value = today;
      App.openModal('modalPurchase');
    });

    // Exports
    document.getElementById('btnExportPurchasesPdf')?.addEventListener('click', () => {
      const q = new URLSearchParams();
      if (this.params.start_date) q.set('start_date', this.params.start_date);
      if (this.params.end_date) q.set('end_date', this.params.end_date);
      window.open(`/api/reports/purchases/pdf?${q.toString()}`, '_blank');
    });

    document.getElementById('btnExportPurchasesCsv')?.addEventListener('click', () => {
      const q = new URLSearchParams();
      if (this.params.start_date) q.set('start_date', this.params.start_date);
      if (this.params.end_date) q.set('end_date', this.params.end_date);
      window.open(`/api/export/purchases?${q.toString()}`, '_blank');
    });
  },

  bindRowActions(container) {
    container.querySelectorAll('.btn-delete-purchase').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const prod = btn.dataset.prod;
        const qty = btn.dataset.qty;
        if (confirm(`Delete purchase of ${qty} ${prod}? This will automatically deduct ${qty} from current stock inventory.`)) {
          try {
            const res = await fetch(`/api/purchases/${id}`, { method: 'DELETE' });
            if (res.ok) {
              App.showToast('Purchase record deleted and stock reversed.');
              await App.loadMetadata();
              this.fetchAndRenderList();
            } else {
              const d = await res.json();
              App.showToast(d.error || 'Failed to delete purchase', 'error');
            }
          } catch {
            App.showToast('Server error while deleting purchase', 'error');
          }
        }
      });
    });
  },
};

App.registerView('purchases', PurchasesView);
