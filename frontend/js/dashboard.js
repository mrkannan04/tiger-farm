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
    const lowStockList = data.low_stock_products || [];
    const hasUrgentStock = lowStockList.length > 0;

    container.innerHTML = `
      <!-- Smart Summary Greeting & Quick Action Bar -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1.25rem;">
        <div class="smart-summary" style="margin-bottom:0; flex:1; min-width:280px;">
          <span class="summary-icon">💡</span>
          <div>
            <strong>Farm Status Overview</strong>
            <div style="margin-top:0.25rem; opacity:0.95;">
              ${summaries.map(s => `<div>• ${s}</div>`).join('')}
            </div>
          </div>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button class="btn btn-primary" id="btnOpenDailyDigest" style="background:var(--green-dark); color:#fff; display:inline-flex; align-items:center; gap:0.4rem; font-weight:700;">
            <span>📲</span> Daily Farm Digest
          </button>
          <button class="btn btn-secondary" id="btnOpenStockAdjust" style="display:inline-flex; align-items:center; gap:0.4rem; font-weight:700;">
            <span>⚖️</span> Stock Adjustment
          </button>
        </div>
      </div>

      ${data.expiring_count > 0 ? `
      <!-- Batch Expiry Alert Banner -->
      <div class="alert alert-warning" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1.25rem; background:rgba(245, 158, 11, 0.12); border:1.5px solid var(--amber); border-radius:var(--radius); padding:0.9rem 1.1rem;">
        <div style="display:flex; align-items:center; gap:0.6rem;">
          <span style="font-size:1.4rem;">⏳</span>
          <div>
            <strong style="color:var(--amber); font-size:0.98rem; letter-spacing:0.01em;">BATCH EXPIRY ALERT (${data.expiring_count} Batch${data.expiring_count > 1 ? 'es' : ''})</strong>
            <div style="font-size:0.84rem; color:var(--text); margin-top:0.2rem;">
              <strong>${data.expiring_count} purchase batch(es)</strong> are expiring within 30 days or already expired. Check inventory to prioritize field application or write-off.
            </div>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="App.navigate('purchases')" style="font-weight:700; color:var(--amber);">
          View Purchases &rarr;
        </button>
      </div>
      ` : ''}

      ${hasUrgentStock ? `
      <!-- Immediate Urgent Low Stock Alert Banner -->
      <div class="alert alert-error" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1.25rem; background:rgba(239, 68, 68, 0.12); border:1.5px solid var(--red); border-radius:var(--radius); padding:0.9rem 1.1rem;">
        <div style="display:flex; align-items:center; gap:0.6rem;">
          <span style="font-size:1.4rem;">🚨</span>
          <div>
            <strong style="color:var(--red); font-size:0.98rem; letter-spacing:0.01em;">IMMEDIATE STOCK ATTENTION REQUIRED</strong>
            <div style="font-size:0.84rem; color:var(--text); margin-top:0.2rem;">
              <strong>${lowStockList.length} product(s)</strong> are at or below minimum threshold: 
              <span style="color:var(--red); font-weight:600;">${lowStockList.map(p => `${p.name} (${p.current_quantity} ${p.unit || ''})`).join(', ')}</span>.
            </div>
          </div>
        </div>
        <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-danger btn-sm btn-quick-reorder" data-prod-id="${lowStockList[0].id}" data-prod-name="${lowStockList[0].name}">
            + Reorder ${lowStockList[0].name}
          </button>
          <a href="https://wa.me/?text=${encodeURIComponent(`🚨 Urgent Farm Stock Alert: The following items are low or out of stock: ${lowStockList.map(p => `${p.name} (${p.current_quantity} ${p.unit || ''} left, min: ${p.minimum_stock})`).join(', ')}. Please reorder immediately.`)}" target="_blank" class="btn btn-sm" style="background:#25D366; color:#fff; border:none; display:inline-flex; align-items:center; gap:0.3rem;">
            📲 Share Alerts via WhatsApp
          </a>
        </div>
      </div>
      ` : ''}

      <!-- Stats Grid (Synchronized from Live Database - Step 3) -->
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">Total Products</div>
          <div class="stat-value green">${data.total_products || 0}</div>
          <div class="stat-sub">Active catalog items</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Available Stock</div>
          <div class="stat-value green">${data.available_stock || 0}</div>
          <div class="stat-sub">Items with stock > 0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Total Stock Quantity</div>
          <div class="stat-value" style="color:var(--green-dark);">${(data.total_stock_quantity || 0).toLocaleString('en-IN')}</div>
          <div class="stat-sub">Physical inventory volume</div>
        </div>
        <div class="stat-item" style="cursor:pointer;" onclick="App.navigate('reorders')">
          <div class="stat-label">Pending Reorders</div>
          <div class="stat-value" style="color:#2563eb;">${data.pending_reorders_count || 0}</div>
          <div class="stat-sub">Vendor reorder requests</div>
        </div>
        <div class="stat-item" style="cursor:pointer;" onclick="App.navigate('purchases')">
          <div class="stat-label">Pending Purchases</div>
          <div class="stat-value" style="color:#d97706;">${data.pending_purchases_count || 0}</div>
          <div class="stat-sub">Credit / pending invoices</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Stock Valuation</div>
          <div class="stat-value green">₹${(data.total_stock_value || 0).toLocaleString('en-IN')}</div>
          <div class="stat-sub">Estimated inventory worth</div>
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

          <!-- Recent Stock Activities (Step 3) -->
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
              <h3 class="card-title" style="margin-bottom:0;">📊 Recent Stock Activities</h3>
              <span class="badge badge-green" style="font-size:0.75rem;">Audit Trail</span>
            </div>
            ${this.renderStockActivities(data.recent_stock_activities || [])}
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
                <td><span class="badge badge-green" style="font-size:0.8rem;">${p.package_summary || `${p.quantity} ${p.unit || ''}`}</span></td>
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
                <td><span class="badge badge-amber" style="font-size:0.8rem;">${u.package_summary || `${u.quantity} ${u.unit || ''}`}</span></td>
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
      <div style="display:flex; flex-direction:column; gap:0.6rem;">
        ${products.map(p => {
          const isOut = p.status === 'out_of_stock' || p.current_quantity <= 0;
          const uSym = (p.unit || 'kg').toUpperCase();
          const isLiquid = uSym === 'L' || uSym === 'ML';
          const typeBadge = isLiquid ? '💧 Liter (L)' : '🌱 KG / Solid';
          const breakdownSummary = p.bag_stock || p.loose_stock
            ? `(${[p.bag_stock ? `${p.bag_stock} Bags` : '', p.loose_stock ? `${p.loose_stock} Loose` : ''].filter(Boolean).join(' + ')})`
            : '';
          const waText = encodeURIComponent(`🚨 Immediate Stock Alert: ${p.name} is ${isOut ? 'OUT OF STOCK' : 'critically LOW'} on Tiger Farm! Current: ${p.current_quantity} ${p.unit || ''} (Min threshold: ${p.minimum_stock} ${p.unit || ''}). Please arrange reorder immediately.`);
          return `
            <div class="low-stock-item" style="padding:0.65rem 0.75rem; border-radius:6px; border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
              <div>
                <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                  <strong style="font-size:0.92rem;">${p.name}</strong>
                  <span class="badge" style="font-size:0.7rem; padding:0.1rem 0.35rem; background:rgba(82,183,136,0.15); color:var(--green-dark);">${p.category || 'General'}</span>
                  <span class="badge" style="font-size:0.7rem; padding:0.1rem 0.35rem; background:rgba(0,0,0,0.06);">${typeBadge}</span>
                </div>
                <div style="font-size:0.8rem; color:var(--muted); margin-top:0.2rem;">
                  Stock: <strong style="color:${isOut ? 'var(--red)' : 'var(--amber)'};">${p.current_quantity} ${p.unit || ''}</strong> ${breakdownSummary} | Min Alert: ${p.minimum_stock} ${p.unit || ''}
                </div>
              </div>
              <div style="display:flex; gap:0.35rem; align-items:center;">
                <a href="https://wa.me/?text=${waText}" target="_blank" class="btn btn-ghost btn-sm" style="color:#25D366; font-size:0.75rem; padding:0.25rem 0.45rem;" title="Send WhatsApp alert">
                  📲 WhatsApp
                </a>
                <button class="btn btn-secondary btn-sm btn-quick-reorder" data-prod-id="${p.id}" data-prod-name="${p.name}">
                  + Reorder
                </button>
              </div>
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

  renderStockActivities(movements) {
    if (!movements || !movements.length) {
      return '<p style="color:var(--muted); font-size:0.85rem;">No recent stock movements.</p>';
    }
    return `
      <div style="display:flex; flex-direction:column; gap:0.6rem;">
        ${movements.slice(0, 6).map(m => {
          const isPos = m.quantity > 0;
          const diffSign = isPos ? '+' : '';
          const badgeClass = m.movement_type === 'PURCHASE' ? 'badge-green' :
                             m.movement_type === 'REORDER_RECEIVED' ? 'badge-green' :
                             m.movement_type === 'USAGE' ? 'badge-yellow' : 'badge-ghost';
          return `
            <div style="font-size:0.82rem; border-left:2.5px solid ${isPos ? 'var(--green-mid)' : 'var(--amber)'}; padding-left:0.6rem;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:var(--text);">${m.product_name}</strong>
                <span class="badge ${badgeClass}" style="font-size:0.72rem; padding:0.15rem 0.4rem;">
                  ${diffSign}${m.quantity} (${m.movement_type})
                </span>
              </div>
              <div style="color:var(--text-mid); font-size:0.75rem; margin-top:0.15rem;">
                Stock: ${m.previous_quantity} &rarr; <strong>${m.balance_after}</strong> • By ${m.username || 'System'}
              </div>
              <div style="color:var(--muted); font-size:0.72rem;">${m.movement_date || ''} — ${m.remarks || ''}</div>
            </div>
          `;
        }).join('')}
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
    // Quick reorder button opens Reorder modal with product preselected
    container.querySelectorAll('.btn-quick-reorder').forEach(btn => {
      btn.addEventListener('click', () => {
        const prodId = btn.dataset.prodId;
        App.openReorderModal(prodId);
      });
    });

    // Daily Farm Digest button
    const btnDigest = container.querySelector('#btnOpenDailyDigest');
    if (btnDigest) {
      btnDigest.addEventListener('click', () => {
        App.openDailyFarmDigest();
      });
    }

    // Stock Adjustment button
    const btnAdjust = container.querySelector('#btnOpenStockAdjust');
    if (btnAdjust) {
      btnAdjust.addEventListener('click', () => {
        App.openAdjustmentModal();
      });
    }
  },
};

App.registerView('dashboard', DashboardView);
