/**
 * Tiger Farm — Purchases View Controller
 */

const PurchasesView = {
  params: {
    search: '',
    payment_status: '',
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
          <small>Track input costs, vendor invoices, unit rates, supplier credit, and receipt attachments.</small>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="btnExportPurchasesPdf">📄 PDF Report</button>
          <button class="btn btn-secondary" id="btnExportPurchasesCsv">📥 Export CSV</button>
          <button class="btn btn-primary" id="btnOpenNewPurchase"><span>+</span> Record Purchase</button>
        </div>
      </div>

      <!-- Filters & Date Range Bar -->
      <div class="filters-bar">
        <input type="text" id="purchSearch" placeholder="Search product, supplier, invoice, batch..." value="${this.params.search}" />

        <select id="purchPaymentFilter">
          <option value="" ${!this.params.payment_status ? 'selected' : ''}>All Payments</option>
          <option value="Pending Credit" ${this.params.payment_status === 'Pending Credit' ? 'selected' : ''}>🟡 Pending Credit Only</option>
          <option value="Paid" ${this.params.payment_status === 'Paid' ? 'selected' : ''}>🟢 Paid in Full</option>
          <option value="Partial" ${this.params.payment_status === 'Partial' ? 'selected' : ''}>🟣 Partial Payment</option>
        </select>

        <div style="display:flex; align-items:center; gap:0.4rem;">
          <label style="font-size:0.75rem; font-weight:600; color:var(--muted);">FROM:</label>
          <input type="date" id="purchStartDate" value="${this.params.start_date}" />
        </div>

        <div style="display:flex; align-items:center; gap:0.4rem;">
          <label style="font-size:0.75rem; font-weight:600; color:var(--muted);">TO:</label>
          <input type="date" id="purchEndDate" value="${this.params.end_date}" />
        </div>

        <button class="btn btn-ghost btn-sm" id="btnResetPurchFilters">Reset</button>

        <div style="margin-left:auto; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;" id="purchTotalSummary"></div>
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
    if (this.params.payment_status) q.set('payment_status', this.params.payment_status);
    if (this.params.start_date) q.set('start_date', this.params.start_date);
    if (this.params.end_date) q.set('end_date', this.params.end_date);
    q.set('page', this.params.page);
    q.set('per_page', this.params.per_page);

    try {
      const res = await fetch(`/api/purchases?${q.toString()}`);
      if (!res.ok) throw new Error('Failed to load purchases');
      const data = await res.json();
      this.renderTable(
        tableContainer,
        data.purchases || [],
        data.total || 0,
        data.pages || 1,
        data.total_cost || 0,
        data.total_credit_pending || 0
      );
    } catch (err) {
      tableContainer.innerHTML = `<div class="alert alert-error" style="margin:1rem;">Error: ${err.message}</div>`;
    }
  },

  renderTable(container, purchases, total, totalPages, totalCost, totalCreditPending) {
    const totalEl = document.getElementById('purchTotalSummary');
    if (totalEl) {
      totalEl.innerHTML = `
        <span class="badge badge-green" style="font-size:0.85rem; padding:0.35rem 0.75rem;">Page Total: ₹${totalCost.toLocaleString('en-IN')}</span>
        ${totalCreditPending > 0 ? `<span class="badge badge-credit" style="font-size:0.85rem; padding:0.35rem 0.75rem;">Total Credit Pending: ₹${totalCreditPending.toLocaleString('en-IN')}</span>` : ''}
      `;
    }

    if (!purchases.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛒</div>
          <h3>No purchases found</h3>
          <p>No purchase records match the selected date range, payment status, or search query.</p>
        </div>`;
      document.getElementById('purchPaginationContainer').innerHTML = '';
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];

    container.innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Purchase Date</th>
              <th>Product & Package</th>
              <th>Quantity</th>
              <th>Unit Rate</th>
              <th>Total Amount</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Supplier</th>
              <th>Invoice #</th>
              <th>Bill</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${purchases.map(p => {
              let expBadge = '';
              if (p.expiry_date) {
                const isExpired = p.expiry_date < todayStr;
                const daysDiff = Math.ceil((new Date(p.expiry_date) - new Date(todayStr)) / (1000 * 60 * 60 * 24));
                if (isExpired) {
                  expBadge = `<span class="badge badge-expired" style="font-size:0.68rem; margin-top:0.2rem; display:inline-block;">Expired (${p.expiry_date_formatted})</span>`;
                } else if (daysDiff <= 30) {
                  expBadge = `<span class="badge badge-expiry-warning" style="font-size:0.68rem; margin-top:0.2rem; display:inline-block;">Exp in ${daysDiff}d (${p.expiry_date_formatted})</span>`;
                } else {
                  expBadge = `<span style="font-size:0.72rem; color:var(--muted); display:inline-block; margin-top:0.15rem;">Exp: ${p.expiry_date_formatted}</span>`;
                }
              }

              let payBadge = '';
              const pStatus = p.payment_status || 'Paid';
              if (pStatus === 'Paid') {
                payBadge = `<span class="badge badge-paid" style="font-size:0.75rem;">🟢 PAID</span>`;
              } else if (pStatus === 'Pending Credit') {
                payBadge = `
                  <button class="btn btn-xs badge-credit btn-toggle-pay" data-id="${p.id}" style="cursor:pointer;" title="Click to mark as Paid">
                    🟡 PENDING CREDIT<br/><small style="text-decoration:underline;">Click: Mark Paid</small>
                  </button>
                  ${p.payment_due_date_formatted ? `<div style="font-size:0.7rem; color:#b45309; margin-top:0.2rem;">Due: ${p.payment_due_date_formatted}</div>` : ''}
                `;
              } else {
                payBadge = `<span class="badge badge-partial" style="font-size:0.75rem;">🟣 ${pStatus.toUpperCase()}</span>`;
              }

              const isCancelled = (p.status === 'Cancelled');
              const statusBadge = isCancelled
                ? `<span class="badge badge-danger" style="font-size:0.72rem; background:var(--red); color:#fff; font-weight:700;">❌ CANCELLED</span>`
                : `<span class="badge badge-paid" style="font-size:0.72rem; font-weight:700;">✅ COMPLETED</span>`;

              return `
              <tr style="${isCancelled ? 'opacity:0.65; background:rgba(239,68,68,0.03);' : ''}">
                <td><code>#${p.id}</code></td>
                <td><strong>${p.purchase_date}</strong></td>
                <td>
                  <strong style="color:var(--text);">${p.product_name}</strong>
                  ${p.packaging_type ? `<div style="font-size:0.76rem; color:var(--green-dark); font-weight:600;">${p.packaging_type}${p.package_size ? ` (${p.package_size} ${p.package_unit || ''})` : ''}</div>` : ''}
                  ${p.batch_number ? `<div style="font-size:0.74rem; color:var(--text-mid); font-family:monospace;">Batch: ${p.batch_number}</div>` : ''}
                  ${expBadge}
                  ${p.remarks ? `<div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">${p.remarks}</div>` : ''}
                </td>
                <td>
                  ${p.package_summary ? `
                    <div><strong style="color:var(--green-dark); font-size:0.85rem;">${p.package_summary}</strong></div>
                    <div style="font-size:0.75rem; color:var(--muted); font-weight:500;">(${p.quantity} ${p.unit || ''})</div>
                  ` : `
                    <strong>${p.quantity}</strong> <span style="font-size:0.8rem; color:var(--muted);">${p.unit || ''}</span>
                  `}
                </td>
                <td>₹${(p.unit_price || 0).toLocaleString('en-IN')}</td>
                <td><strong style="color:var(--green-dark);">₹${(p.total_price || 0).toLocaleString('en-IN')}</strong></td>
                <td>${statusBadge}</td>
                <td>${payBadge}</td>
                <td>${p.supplier_name || '<span style="color:var(--muted);">—</span>'}</td>
                <td>${p.invoice_number ? `<code>${p.invoice_number}</code>` : '<span style="color:var(--muted);">—</span>'}</td>
                <td>
                  ${p.bill_file ?
                    `<a href="/uploads/bills/${p.bill_file}" target="_blank" class="badge badge-blue" style="text-decoration:none;">📎 View Bill</a>` :
                    '<span style="color:var(--muted); font-size:0.8rem;">None</span>'
                  }
                </td>
                <td style="text-align:right;">
                  <div style="display:inline-flex; gap:0.35rem; align-items:center;">
                    ${!isCancelled ? `
                      <button class="btn btn-warning btn-xs btn-cancel-purchase" data-id="${p.id}" data-prod="${p.product_name}" data-qty="${p.quantity} ${p.unit || ''}" title="Cancel purchase & reverse stock" style="font-size:0.72rem; padding:0.25rem 0.5rem;">❌ Cancel</button>
                    ` : ''}
                    <button class="btn btn-danger btn-xs btn-delete-purchase" data-id="${p.id}" data-prod="${p.product_name}" data-qty="${p.quantity} ${p.unit || ''}" title="Delete & reverse stock" style="font-size:0.72rem; padding:0.25rem 0.5rem;">🗑️</button>
                  </div>
                </td>
              </tr>
            `;
            }).join('')}
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

    document.getElementById('purchPaymentFilter')?.addEventListener('change', (e) => {
      this.params.payment_status = e.target.value;
      this.params.page = 1;
      this.fetchAndRenderList();
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
      this.params = { search: '', payment_status: '', start_date: '', end_date: '', page: 1, per_page: 15 };
      this.renderLayout();
      this.fetchAndRenderList();
    });

    document.getElementById('btnOpenNewPurchase')?.addEventListener('click', () => {
      document.getElementById('formPurchase').reset();
      const today = new Date().toISOString().split('T')[0];
      const dIn = document.getElementById('purchaseDate');
      if (dIn) { dIn.value = today; dIn.style.borderColor = ''; }
      App.openModal('modalPurchase');
      if (typeof App.syncPurchasePackagingUI === 'function') {
        App.syncPurchasePackagingUI(true);
      }
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
    // Mark Paid toggle
    container.querySelectorAll('.btn-toggle-pay').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (confirm(`Mark Purchase #${id} credit as PAID in full?`)) {
          try {
            const res = await fetch(`/api/purchases/${id}/payment`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ payment_status: 'Paid' }),
            });
            const data = await res.json();
            if (res.ok && data.success !== false) {
              App.showToast('Payment status marked as PAID!');
              this.fetchAndRenderList();
            } else {
              App.showToast(data.message || 'Failed to update payment status', 'error');
            }
          } catch (err) {
            App.showToast('Error: ' + err.message, 'error');
          }
        }
      });
    });

    container.querySelectorAll('.btn-cancel-purchase').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const prod = btn.dataset.prod;
        const qty = btn.dataset.qty;
        if (!confirm(`Cancel purchase #${id} (${qty} of ${prod})? This will automatically reverse and deduct ${qty} from your current inventory stock.`)) return;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/purchases/${id}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Cancelled by user' }),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            App.showToast(data.message || `Purchase #${id} cancelled and stock reversed.`);
            await App.loadMetadata();
            this.fetchAndRenderList();
          } else {
            App.showToast(data.message || data.error || 'Failed to cancel purchase', 'error');
          }
        } catch (err) {
          App.showToast('Error cancelling purchase: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

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
