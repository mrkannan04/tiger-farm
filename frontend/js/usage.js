/**
 * Tiger Farm — Product Usage View Controller
 */

const UsageView = {
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
          <h1 class="page-title">Usage & Application Logs</h1>
          <small>Track consumption across fields, crops, spray schedules, and fertilizer applications.</small>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="btnExportUsagePdf">📄 PDF Report</button>
          <button class="btn btn-secondary" id="btnExportUsageCsv">📥 Export CSV</button>
          <button class="btn btn-primary" id="btnOpenNewUsage"><span>+</span> Record Usage</button>
        </div>
      </div>

      <!-- Filters & Date Range Bar -->
      <div class="filters-bar">
        <input type="text" id="usageSearch" placeholder="Search product, field, reason..." value="${this.params.search}" />

        <div style="display:flex; align-items:center; gap:0.4rem;">
          <label style="font-size:0.75rem; font-weight:600; color:var(--muted);">FROM:</label>
          <input type="date" id="usageStartDate" value="${this.params.start_date}" />
        </div>

        <div style="display:flex; align-items:center; gap:0.4rem;">
          <label style="font-size:0.75rem; font-weight:600; color:var(--muted);">TO:</label>
          <input type="date" id="usageEndDate" value="${this.params.end_date}" />
        </div>

        <button class="btn btn-ghost btn-sm" id="btnResetUsageFilters">Reset</button>
      </div>

      <!-- Table Container -->
      <div class="card" style="padding:0; overflow:hidden;" id="usageTableContainer">
        <div class="loading-overlay"><div class="spinner"></div></div>
      </div>

      <!-- Pagination -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; font-size:0.875rem;" id="usagePaginationContainer"></div>
    `;

    this.bindFilters();
  },

  async fetchAndRenderList() {
    const tableContainer = document.getElementById('usageTableContainer');
    if (!tableContainer) return;
    tableContainer.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    const q = new URLSearchParams();
    if (this.params.search) q.set('search', this.params.search);
    if (this.params.start_date) q.set('start_date', this.params.start_date);
    if (this.params.end_date) q.set('end_date', this.params.end_date);
    q.set('page', this.params.page);
    q.set('per_page', this.params.per_page);

    try {
      const res = await fetch(`/api/usages?${q.toString()}`);
      if (!res.ok) throw new Error('Failed to load usage records');
      const data = await res.json();
      this.renderTable(tableContainer, data.usages || [], data.total || 0, data.pages || 1);
    } catch (err) {
      tableContainer.innerHTML = `<div class="alert alert-error" style="margin:1rem;">Error: ${err.message}</div>`;
    }
  },

  renderTable(container, usages, total, totalPages) {
    if (!usages.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🌾</div>
          <h3>No usage records found</h3>
          <p>No product consumption recorded for the selected filter criteria.</p>
        </div>`;
      document.getElementById('usagePaginationContainer').innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity Used</th>
              <th>Field / Location</th>
              <th>Purpose / Reason</th>
              <th>Remarks</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${usages.map(u => `
              <tr>
                <td><strong>${u.usage_date}</strong></td>
                <td><strong style="color:var(--text);">${u.product_name}</strong></td>
                <td>
                  ${u.package_summary ? `
                    <div><strong style="color:var(--red); font-size:0.85rem;">-${u.package_summary}</strong></div>
                    <div style="font-size:0.75rem; color:var(--muted); font-weight:500;">(-${u.quantity} ${u.unit || ''})</div>
                  ` : `
                    <strong style="color:var(--red); font-size:0.95rem;">-${u.quantity}</strong> <span style="font-size:0.8rem; color:var(--muted);">${u.unit || ''}</span>
                  `}
                </td>
                <td>
                  <span class="badge badge-muted">📍 ${u.field_location || 'General'}</span>
                </td>
                <td>${u.reason || '<span style="color:var(--muted);">—</span>'}</td>
                <td>${u.remarks || '<span style="color:var(--muted);">—</span>'}</td>
                <td style="text-align:right;">
                  <button class="btn btn-danger btn-sm btn-delete-usage" data-id="${u.id}" data-prod="${u.product_name}" data-qty="${u.quantity} ${u.unit || ''}" title="Delete & restore stock">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Pagination
    const pag = document.getElementById('usagePaginationContainer');
    if (pag) {
      pag.innerHTML = `
        <span style="color:var(--muted);">Showing ${usages.length} of ${total} records (Page ${this.params.page} of ${totalPages})</span>
        <div style="display:flex; gap:0.4rem;">
          <button class="btn btn-ghost btn-sm" id="btnUsagePrev" ${this.params.page <= 1 ? 'disabled' : ''}>&larr; Previous</button>
          <button class="btn btn-ghost btn-sm" id="btnUsageNext" ${this.params.page >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
        </div>
      `;

      document.getElementById('btnUsagePrev')?.addEventListener('click', () => {
        if (this.params.page > 1) {
          this.params.page--;
          this.fetchAndRenderList();
        }
      });
      document.getElementById('btnUsageNext')?.addEventListener('click', () => {
        if (this.params.page < totalPages) {
          this.params.page++;
          this.fetchAndRenderList();
        }
      });
    }

    this.bindRowActions(container);
  },

  bindFilters() {
    const sInput = document.getElementById('usageSearch');
    let timer;
    sInput?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.params.search = sInput.value.trim();
        this.params.page = 1;
        this.fetchAndRenderList();
      }, 300);
    });

    document.getElementById('usageStartDate')?.addEventListener('change', (e) => {
      this.params.start_date = e.target.value;
      this.params.page = 1;
      this.fetchAndRenderList();
    });

    document.getElementById('usageEndDate')?.addEventListener('change', (e) => {
      this.params.end_date = e.target.value;
      this.params.page = 1;
      this.fetchAndRenderList();
    });

    document.getElementById('btnResetUsageFilters')?.addEventListener('click', () => {
      this.params = { search: '', start_date: '', end_date: '', page: 1, per_page: 15 };
      this.renderLayout();
      this.fetchAndRenderList();
    });

    document.getElementById('btnOpenNewUsage')?.addEventListener('click', () => {
      document.getElementById('formUsage').reset();
      document.getElementById('usageStockHint').textContent = '';
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('usageDate').value = today;
      App.openModal('modalUsage');
    });

    // Exports
    document.getElementById('btnExportUsagePdf')?.addEventListener('click', () => {
      const q = new URLSearchParams();
      if (this.params.start_date) q.set('start_date', this.params.start_date);
      if (this.params.end_date) q.set('end_date', this.params.end_date);
      window.open(`/api/reports/usage/pdf?${q.toString()}`, '_blank');
    });

    document.getElementById('btnExportUsageCsv')?.addEventListener('click', () => {
      const q = new URLSearchParams();
      if (this.params.start_date) q.set('start_date', this.params.start_date);
      if (this.params.end_date) q.set('end_date', this.params.end_date);
      window.open(`/api/export/usage?${q.toString()}`, '_blank');
    });
  },

  bindRowActions(container) {
    container.querySelectorAll('.btn-delete-usage').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const prod = btn.dataset.prod;
        const qty = btn.dataset.qty;
        if (confirm(`Delete usage record of ${qty} ${prod}? This will restore ${qty} back into available stock.`)) {
          try {
            const res = await fetch(`/api/usages/${id}`, { method: 'DELETE' });
            if (res.ok) {
              App.showToast('Usage record deleted and stock restored.');
              await App.loadMetadata();
              this.fetchAndRenderList();
            } else {
              const d = await res.json();
              App.showToast(d.error || 'Failed to delete usage record', 'error');
            }
          } catch {
            App.showToast('Server error while deleting usage record', 'error');
          }
        }
      });
    });
  },
};

App.registerView('usage', UsageView);
