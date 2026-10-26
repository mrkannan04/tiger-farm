/**
 * Tiger Farm — Dashboard View Controller
 */

const DashboardView = {
  async render(container) {
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error('Failed to load dashboard data');
      const data = await res.json();
      this.renderContent(container, data);
    } catch (err) {
      container.innerHTML = `
        <div class="alert alert-error">
          Failed to load dashboard: ${err.message}. Please refresh or check connection.
        </div>`;
    }
  },

  refresh() {
    const mainView = document.getElementById('main-view');
    if (App.state.currentView === 'dashboard') {
      this.render(mainView);
    }
  },

  renderContent(container, data) {
    const summaries = Array.isArray(data.smart_summary) ? data.smart_summary : [data.smart_summary || ''];

    container.innerHTML = `
      <!-- Smart Summary Greeting -->
      <div class="smart-summary">
        <span class="summary-icon">💡</span>
        <div>
          <strong>Farm Status Overview</strong>
          <div style="margin-top:0.25rem; opacity:0.95;">
            ${summaries.map(s => `<div>• ${s}</div>`).join('')}
          </div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">Total Products</div>
          <div class="stat-value green">${data.total_products || 0}</div>
          <div class="stat-sub">Active catalog items</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Stock Valuation</div>
          <div class="stat-value green">₹${(data.total_stock_value || 0).toLocaleString('en-IN')}</div>
          <div class="stat-sub">Estimated inventory worth</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Month's Purchases</div>
          <div class="stat-value">₹${(data.monthly_purchase || 0).toLocaleString('en-IN')}</div>
          <div class="stat-sub">Spent this calendar month</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Low Stock Items</div>
          <div class="stat-value amber">${data.low_stock_count || 0}</div>
          <div class="stat-sub">At or below threshold</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Out of Stock</div>
          <div class="stat-value red">${data.out_of_stock_count || 0}</div>
          <div class="stat-sub">Requires immediate purchase</div>
        </div>
      </div>

      <!-- Layout: Left Column (Tables) & Right Column (Alerts & Activity) -->
      <div class="dashboard-grid">
        <!-- Left Column -->
        <div style="display:flex; flex-direction:column; gap:1.25rem;">
          <!-- Recent Purchases -->
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
              <h3 class="card-title" style="margin-bottom:0;">🛒 Recent Purchases</h3>
              <a href="#purchases" class="btn btn-ghost btn-sm">View All Purchases &rarr;</a>
            </div>
            ${this.renderRecentPurchases(data.recent_purchases || [])}
          </div>

          <!-- Recent Usage -->
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
              <h3 class="card-title" style="margin-bottom:0;">🌾 Recent Usage Logs</h3>
              <a href="#usage" class="btn btn-ghost btn-sm">View All Logs &rarr;</a>
            </div>
            ${this.renderRecentUsages(data.recent_usages || [])}
          </div>
        </div>

        <!-- Right Column -->
        <div style="display:flex; flex-direction:column; gap:1.25rem;">
          <!-- Low Stock Warning Panel -->
          <div class="card">
            <h3 class="card-title">⚠️ Stock Attention Needed</h3>
            ${this.renderLowStockList(data.low_stock_products || [])}
          </div>

          <!-- Top Used Products -->
          <div class="card">
            <h3 class="card-title">🏆 Top Consumed (30 Days)</h3>
            ${this.renderMostUsed(data.most_used || [])}
          </div>

          <!-- Recent Activity Log -->
          <div class="card">
            <h3 class="card-title">📋 Activity Log</h3>
            ${this.renderActivityLog(data.recent_activity || [])}
          </div>
        </div>
      </div>
    `;

    this.bindActionButtons(container);
  },

  renderRecentPurchases(purchases) {
    if (!purchases.length) {
      return '<div class="empty-state" style="padding:1.5rem;"><p>No purchases recorded yet.</p></div>';
    }
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Amount</th>
              <th>Supplier</th>
            </tr>
          </thead>
          <tbody>
            ${purchases.slice(0, 5).map(p => `
              <tr>
                <td>${p.purchase_date}</td>
                <td><strong>${p.product_name}</strong></td>
                <td>${p.quantity} ${p.unit || ''}</td>
                <td>₹${(p.total_price || 0).toLocaleString('en-IN')}</td>
                <td>${p.supplier_name || '<span style="color:var(--muted)">—</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  },

  renderRecentUsages(usages) {
    if (!usages.length) {
      return '<div class="empty-state" style="padding:1.5rem;"><p>No usage recorded yet.</p></div>';
    }
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Qty Used</th>
              <th>Location</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            ${usages.slice(0, 5).map(u => `
              <tr>
                <td>${u.usage_date}</td>
                <td><strong>${u.product_name}</strong></td>
                <td>${u.quantity} ${u.unit || ''}</td>
                <td>${u.field_location || '<span style="color:var(--muted)">General</span>'}</td>
                <td>${u.reason || '<span style="color:var(--muted)">—</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  },

  renderLowStockList(products) {
    if (!products.length) {
      return `
        <div style="text-align:center; padding:1.5rem; color:var(--green-dark);">
          <div style="font-size:1.8rem; margin-bottom:0.25rem;">✅</div>
          <strong>All stock levels healthy!</strong>
          <p style="font-size:0.85rem; color:var(--muted); margin-top:0.25rem;">No products are below minimum thresholds.</p>
        </div>`;
    }
    return `
      <div style="display:flex; flex-direction:column;">
        ${products.map(p => {
          const isOut = p.status === 'out_of_stock';
          return `
            <div class="low-stock-item">
              <div>
                <strong style="display:block; font-size:0.9rem;">${p.name}</strong>
                <span style="font-size:0.8rem; color:var(--muted);">
                  Stock: <strong style="color:${isOut ? 'var(--red)' : 'var(--amber)'};">${p.current_quantity} ${p.unit || ''}</strong> (Min: ${p.minimum_stock})
                </span>
              </div>
              <button class="btn btn-secondary btn-sm btn-quick-reorder" data-prod-id="${p.id}" data-prod-name="${p.name}">
                + Reorder
              </button>
            </div>
          `;
        }).join('')}
      </div>`;
  },

  renderMostUsed(items) {
    if (!items.length) {
      return '<p style="color:var(--muted); font-size:0.85rem; padding:0.5rem 0;">No usage records in the past 30 days.</p>';
    }
    return `
      <div style="display:flex; flex-direction:column; gap:0.6rem;">
        ${items.map((item, idx) => `
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.875rem; border-bottom:1px solid var(--border); padding-bottom:0.4rem;">
            <span>${idx + 1}. <strong>${item.name}</strong></span>
            <span class="badge badge-green">${item.total_used} ${item.unit}</span>
          </div>
        `).join('')}
      </div>`;
  },

  renderActivityLog(logs) {
    if (!logs.length) {
      return '<p style="color:var(--muted); font-size:0.85rem;">No recent activities logged.</p>';
    }
    return `
      <div style="display:flex; flex-direction:column; gap:0.5rem;">
        ${logs.slice(0, 6).map(a => `
          <div style="font-size:0.82rem; border-left:2px solid var(--green-mid); padding-left:0.6rem;">
            <div>${a.action}</div>
            <small style="color:var(--muted); font-size:0.75rem;">${a.created_at}</small>
          </div>
        `).join('')}
      </div>`;
  },

  bindActionButtons(container) {
    // Quick reorder button triggers purchase modal with that product preselected
    container.querySelectorAll('.btn-quick-reorder').forEach(btn => {
      btn.addEventListener('click', () => {
        const prodId = btn.dataset.prodId;
        document.getElementById('formPurchase').reset();
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('purchaseDate').value = today;

        const pSelect = document.getElementById('purchaseProduct');
        if (pSelect) {
          pSelect.value = prodId;
          const opt = pSelect.options[pSelect.selectedIndex];
          if (opt && opt.dataset.unit) {
            document.getElementById('purchaseUnit').value = opt.dataset.unit;
          }
        }
        App.openModal('modalPurchase');
      });
    });
  },
};

App.registerView('dashboard', DashboardView);
