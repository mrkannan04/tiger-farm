/**
 * Tiger Farm — Reorders View Controller
 * Step 4: Reorder Stock Lifecycle Management
 * (Pending -> Ordered -> Partially Received -> Received / Cancelled)
 */

const ReordersView = {
  params: {
    status: 'all',
    search: '',
    product_id: '',
    page: 1,
    per_page: 15,
  },

  async render(container) {
    this.container = container;
    this.renderLayout();
    await this.fetchAndRenderList();
  },

  refresh() {
    if (App.state.currentView === 'reorders') {
      this.fetchAndRenderList();
    }
  },

  renderLayout() {
    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h2>🔄 Stock Reorders & Replenishment</h2>
          <p class="view-subtitle">Track purchase reorders from vendors. Stock updates ONLY when physically confirmed as received.</p>
        </div>
        <div class="view-actions">
          <button class="btn btn-primary" id="btnOpenNewReorder" style="display:inline-flex; align-items:center; gap:0.4rem; font-weight:700;">
            <span>➕</span> New Reorder Request
          </button>
        </div>
      </div>

      <!-- Quick Status Filter Pills -->
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1.25rem;" id="reorderStatusTabs">
        <button class="btn btn-sm ${this.params.status === 'all' ? 'btn-primary' : 'btn-ghost'}" data-tab="all">All Reorders</button>
        <button class="btn btn-sm ${this.params.status === 'Pending' ? 'btn-primary' : 'btn-ghost'}" data-tab="Pending">⏳ Pending (<span id="tabCountPending">0</span>)</button>
        <button class="btn btn-sm ${this.params.status === 'Ordered' ? 'btn-primary' : 'btn-ghost'}" data-tab="Ordered">📦 Ordered</button>
        <button class="btn btn-sm ${this.params.status === 'Partially Received' ? 'btn-primary' : 'btn-ghost'}" data-tab="Partially Received">🟣 Partially Received</button>
        <button class="btn btn-sm ${this.params.status === 'Received' ? 'btn-primary' : 'btn-ghost'}" data-tab="Received">✅ Received</button>
        <button class="btn btn-sm ${this.params.status === 'Cancelled' ? 'btn-primary' : 'btn-ghost'}" data-tab="Cancelled">❌ Cancelled</button>
      </div>

      <!-- Filter Controls Bar -->
      <div class="filter-bar" style="margin-bottom:1rem;">
        <input type="text" id="reorderSearchInput" placeholder="Search reorders by product or supplier..." value="${this.params.search}" />
        <select id="reorderProductFilter">
          <option value="">All Products</option>
          ${(App.state.products || []).map(p => `<option value="${p.id}" ${this.params.product_id === String(p.id) ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" id="btnResetReorderFilters">Reset</button>
      </div>

      <!-- Reorders Table Container -->
      <div class="card" style="padding:0; overflow:hidden;" id="reordersTableCard">
        <div class="loading-overlay"><div class="spinner"></div></div>
      </div>

      <!-- Pagination -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; font-size:0.875rem;" id="reorderPagination"></div>
    `;

    this.bindFilters();
  },

  async fetchAndRenderList() {
    const tableCard = document.getElementById('reordersTableCard');
    if (!tableCard) return;
    tableCard.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    const q = new URLSearchParams();
    if (this.params.status && this.params.status !== 'all') q.set('status', this.params.status);
    if (this.params.search) q.set('search', this.params.search);
    if (this.params.product_id) q.set('product_id', this.params.product_id);
    q.set('page', this.params.page);
    q.set('per_page', this.params.per_page);

    try {
      const res = await fetch(`/api/reorders?${q.toString()}`);
      if (!res.ok) throw new Error('Failed to load reorder records');
      const data = await res.json();

      // Update badge counts
      const pendingEl = document.getElementById('tabCountPending');
      if (pendingEl) pendingEl.textContent = data.pending_count || 0;
      const navBadge = document.getElementById('navReorderBadge');
      if (navBadge) {
        if (data.pending_count > 0) {
          navBadge.textContent = data.pending_count;
          navBadge.style.display = 'inline-block';
        } else {
          navBadge.style.display = 'none';
        }
      }

      this.renderTable(tableCard, data.reorders || [], data.total || 0, data.pages || 1);
    } catch (err) {
      tableCard.innerHTML = `<div class="alert alert-error" style="margin:1rem;">Error: ${err.message}</div>`;
    }
  },

  renderTable(container, reorders, total, totalPages) {
    if (!reorders.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔄</div>
          <h3>No reorder requests found</h3>
          <p>Click "New Reorder Request" to initiate stock replenishment from your suppliers.</p>
        </div>`;
      const pag = document.getElementById('reorderPagination');
      if (pag) pag.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead>
            <tr>
              <th>ID / Date</th>
              <th>Product & Package</th>
              <th>Current Stock</th>
              <th>Reorder Quantity</th>
              <th>Supplier</th>
              <th>Expected Arrival</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${reorders.map(r => {
              let statusBadge = '<span class="badge badge-yellow">⏳ Pending</span>';
              if (r.status === 'Ordered') {
                statusBadge = '<span class="badge" style="background:rgba(59,130,246,0.15); color:#2563eb; border:1px solid #93c5fd;">📦 Ordered</span>';
              } else if (r.status === 'Partially Received') {
                statusBadge = '<span class="badge" style="background:rgba(147,51,234,0.15); color:#7e22ce; border:1px solid #d8b4fe;">🟣 Partially Received</span>';
              } else if (r.status === 'Received') {
                statusBadge = '<span class="badge badge-green">✅ Received</span>';
              } else if (r.status === 'Cancelled') {
                statusBadge = '<span class="badge" style="background:rgba(239,68,68,0.12); color:#dc2626; border:1px solid #fca5a5;">❌ Cancelled</span>';
              }

              const isCompleted = r.status === 'Received';
              const isCancelled = r.status === 'Cancelled';
              const canReceive = !isCompleted && !isCancelled;

              return `
                <tr style="${isCancelled ? 'opacity:0.6;' : ''}">
                  <td>
                    <strong>#${r.id}</strong>
                    <div style="font-size:0.75rem; color:var(--text-mid);">${r.reorder_date || ''}</div>
                  </td>
                  <td>
                    <strong style="color:var(--text);">${r.product_name}</strong>
                    <div style="font-size:0.8rem; color:var(--muted);">${r.package_summary || `${r.quantity} ${r.product_unit || ''}`}</div>
                  </td>
                  <td>
                    <span class="badge badge-green" style="font-size:0.85rem;">
                      ${r.current_stock} ${r.product_unit || ''}
                    </span>
                  </td>
                  <td>
                    <strong style="font-size:0.95rem; color:var(--green-dark);">${r.quantity} ${r.product_unit || ''}</strong>
                    ${r.received_quantity > 0 ? `<div style="font-size:0.75rem; color:#7e22ce;">Recv: ${r.received_quantity} (Rem: ${r.remaining_quantity})</div>` : ''}
                  </td>
                  <td>
                    <div>${r.supplier_name || '<span style="color:var(--muted);">Direct / General</span>'}</div>
                  </td>
                  <td>
                    <span style="font-size:0.85rem; color:${r.expected_delivery_date ? 'var(--text)' : 'var(--muted)'};">
                      ${r.expected_delivery_date || 'Not specified'}
                    </span>
                  </td>
                  <td>${statusBadge}</td>
                  <td style="text-align:right; white-space:nowrap;">
                    ${canReceive ? `
                      <button class="btn btn-primary btn-sm btn-receive-reorder" data-id="${r.id}" data-name="${r.product_name}" data-summary="${r.package_summary || ''}" data-rem="${r.remaining_quantity}" data-supp="${r.supplier_name || ''}" title="Confirm physical receipt to update inventory stock">
                        ✅ Receive Stock
                      </button>
                      ${r.status === 'Pending' ? `
                        <button class="btn btn-ghost btn-sm btn-mark-ordered" data-id="${r.id}" title="Mark as ordered from supplier">
                          📦 Ordered
                        </button>
                      ` : ''}
                      <button class="btn btn-ghost btn-sm btn-cancel-reorder" data-id="${r.id}" style="color:var(--red);" title="Cancel reorder">
                        ❌
                      </button>
                    ` : ''}
                    ${isCompleted ? `
                      <span style="font-size:0.78rem; color:var(--green-dark); font-weight:600;">Stock Updated on ${r.received_date || ''}</span>
                    ` : ''}
                    ${!isCompleted ? `
                      <button class="btn btn-ghost btn-sm btn-delete-reorder" data-id="${r.id}" title="Delete reorder request">🗑️</button>
                    ` : ''}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Pagination
    const pag = document.getElementById('reorderPagination');
    if (pag) {
      pag.innerHTML = `
        <span style="color:var(--muted);">Showing ${reorders.length} of ${total} reorders (Page ${this.params.page} of ${totalPages})</span>
        <div style="display:flex; gap:0.4rem;">
          <button class="btn btn-ghost btn-sm" id="btnReorderPrev" ${this.params.page <= 1 ? 'disabled' : ''}>&larr; Previous</button>
          <button class="btn btn-ghost btn-sm" id="btnReorderNext" ${this.params.page >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
        </div>
      `;

      document.getElementById('btnReorderPrev')?.addEventListener('click', () => {
        if (this.params.page > 1) {
          this.params.page--;
          this.fetchAndRenderList();
        }
      });
      document.getElementById('btnReorderNext')?.addEventListener('click', () => {
        if (this.params.page < totalPages) {
          this.params.page++;
          this.fetchAndRenderList();
        }
      });
    }

    this.bindRowActions(container);
  },

  bindFilters() {
    // Status tabs
    document.querySelectorAll('#reorderStatusTabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#reorderStatusTabs button').forEach(b => {
          b.className = 'btn btn-sm btn-ghost';
        });
        btn.className = 'btn btn-sm btn-primary';
        this.params.status = btn.dataset.tab;
        this.params.page = 1;
        this.fetchAndRenderList();
      });
    });

    // Search input
    let timer;
    document.getElementById('reorderSearchInput')?.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.params.search = e.target.value.trim();
        this.params.page = 1;
        this.fetchAndRenderList();
      }, 300);
    });

    // Product filter
    document.getElementById('reorderProductFilter')?.addEventListener('change', (e) => {
      this.params.product_id = e.target.value;
      this.params.page = 1;
      this.fetchAndRenderList();
    });

    // Reset filters
    document.getElementById('btnResetReorderFilters')?.addEventListener('click', () => {
      this.params = { status: 'all', search: '', product_id: '', page: 1, per_page: 15 };
      this.renderLayout();
      this.fetchAndRenderList();
    });

    // New Reorder Request button
    document.getElementById('btnOpenNewReorder')?.addEventListener('click', () => {
      App.openReorderModal();
    });
  },

  bindRowActions(container) {
    // Receive Reorder
    container.querySelectorAll('.btn-receive-reorder').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        const summary = btn.dataset.summary;
        const rem = btn.dataset.rem;
        const supp = btn.dataset.supp;

        document.getElementById('receiveReorderId').value = id;
        document.getElementById('receiveProdName').textContent = name;
        document.getElementById('receiveSummaryText').textContent = summary || 'Reorder #' + id;
        document.getElementById('receiveSupplierName').textContent = supp || 'General Supplier';
        document.getElementById('receiveReorderQty').value = rem || '';
        document.getElementById('receiveRemainingHint').textContent = `Total pending to receive: ${rem}`;

        App.openModal('modalReceiveReorder');
      });
    });

    // Mark Ordered
    container.querySelectorAll('.btn-mark-ordered').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/reorders/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Ordered' }),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            App.showToast(`Reorder #${id} marked as Ordered from supplier.`);
            this.fetchAndRenderList();
          } else {
            App.showToast(data.message || 'Failed to update reorder', 'error');
          }
        } catch (err) {
          App.showToast('Error: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Cancel Reorder
    container.querySelectorAll('.btn-cancel-reorder').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm(`Are you sure you want to cancel Reorder #${id}? Stock will remain unchanged.`)) return;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/reorders/${id}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Cancelled by user' }),
          });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            App.showToast(data.message || `Reorder #${id} cancelled.`);
            this.fetchAndRenderList();
          } else {
            App.showToast(data.message || 'Failed to cancel', 'error');
          }
        } catch (err) {
          App.showToast('Error: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Delete Reorder
    container.querySelectorAll('.btn-delete-reorder').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm(`Permanently delete Reorder Request #${id}?`)) return;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/reorders/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (res.ok && data.success !== false) {
            App.showToast(`Reorder #${id} deleted.`);
            this.fetchAndRenderList();
          } else {
            App.showToast(data.message || 'Delete failed', 'error');
          }
        } catch (err) {
          App.showToast('Error: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  },
};

App.registerView('reorders', ReordersView);
