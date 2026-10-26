/**
 * Tiger Farm — Analytics View Controller (Chart.js Powered)
 */

const AnalyticsView = {
  charts: {},

  async render(container) {
    this.container = container;
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth() + 1;

    this.renderLayout();
    await this.loadAnalyticsData();
  },

  refresh() {
    this.loadAnalyticsData();
  },

  renderLayout() {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    this.container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Farm Inventory Analytics & Insights</h1>
          <small>Expenditure patterns, consumption velocity, and automated reorder recommendations.</small>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <select id="analyticsMonthSelect" style="padding:0.45rem 0.8rem; border-radius:6px; border:1.5px solid var(--border);">
            ${months.map((m, i) => `<option value="${i + 1}" ${this.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
          <select id="analyticsYearSelect" style="padding:0.45rem 0.8rem; border-radius:6px; border:1.5px solid var(--border);">
            ${[this.year - 1, this.year, this.year + 1].map(y => `<option value="${y}" ${this.year === y ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
          <button class="btn btn-secondary btn-sm" id="btnRefreshAnalytics">🔄 Refresh</button>
        </div>
      </div>

      <!-- Smart Insights Cards -->
      <div id="analyticsInsightsContainer" style="margin-bottom:1.5rem;">
        <div class="loading-overlay"><div class="spinner"></div></div>
      </div>

      <!-- Charts Row 1: Trend & Category -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap:1.25rem; margin-bottom:1.5rem;">
        <!-- 6-Month Expenditure Trend -->
        <div class="card">
          <h3 class="card-title">📈 6-Month Purchase Trend (₹)</h3>
          <div class="chart-container">
            <canvas id="chartPurchaseTrend"></canvas>
          </div>
        </div>

        <!-- Category Spending Distribution -->
        <div class="card">
          <h3 class="card-title">🍩 Spending by Category</h3>
          <div class="chart-container">
            <canvas id="chartCategorySpending"></canvas>
          </div>
        </div>

        <!-- Inventory Stock Health -->
        <div class="card">
          <h3 class="card-title">🛡️ Inventory Health Ratio</h3>
          <div class="chart-container">
            <canvas id="chartStockHealth"></canvas>
          </div>
        </div>
      </div>

      <!-- Row 2: Tables for Reorder & Top Consumed -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap:1.25rem;">
        <!-- Reorder Suggestions -->
        <div class="card">
          <h3 class="card-title">🚨 Smart Reorder Suggestions</h3>
          <div id="reorderTableContainer">
            <div class="loading-overlay"><div class="spinner"></div></div>
          </div>
        </div>

        <!-- Most Used Ranking -->
        <div class="card">
          <h3 class="card-title">🏆 Top Consumed Products</h3>
          <div id="topUsedTableContainer">
            <div class="loading-overlay"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    `;

    this.bindControls();
  },

  bindControls() {
    document.getElementById('analyticsMonthSelect')?.addEventListener('change', (e) => {
      this.month = parseInt(e.target.value);
      this.loadAnalyticsData();
    });

    document.getElementById('analyticsYearSelect')?.addEventListener('change', (e) => {
      this.year = parseInt(e.target.value);
      this.loadAnalyticsData();
    });

    document.getElementById('btnRefreshAnalytics')?.addEventListener('click', () => {
      this.loadAnalyticsData();
    });
  },

  async loadAnalyticsData() {
    // Destroy previous chart instances
    Object.values(this.charts).forEach(c => c && c.destroy());
    this.charts = {};

    try {
      const res = await fetch(`/api/analytics?year=${this.year}&month=${this.month}`);
      if (!res.ok) throw new Error('Failed to load analytics data');
      const data = await res.json();

      this.renderInsights(data.insights || []);
      this.renderPurchaseTrendChart(data.purchase_trend || []);
      this.renderCategoryChart(data.category_spending || []);
      this.renderStockHealthChart(data.stock_status || {});
      this.renderReorderTable(data.reorder_suggestions || []);
      this.renderTopUsedTable(data.most_used_products || []);
    } catch (err) {
      document.getElementById('analyticsInsightsContainer').innerHTML = `
        <div class="alert alert-error">Error loading analytics: ${err.message}</div>`;
    }
  },

  renderInsights(insights) {
    const container = document.getElementById('analyticsInsightsContainer');
    if (!container) return;

    if (!insights.length) {
      container.innerHTML = `
        <div class="smart-summary" style="background:var(--card-bg); color:var(--text); border:1px solid var(--border);">
          <span class="summary-icon">💡</span>
          <div>All spending and consumption patterns are steady for this period.</div>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:1rem;">
        ${insights.map(item => {
          const type = typeof item === 'object' ? item.type : 'info';
          const text = typeof item === 'object' ? item.text || item.message : item;
          const bg = type === 'warning' ? 'var(--amber-bg)' : type === 'danger' ? 'var(--red-bg)' : 'var(--green-light)';
          const color = type === 'warning' ? '#92580A' : type === 'danger' ? 'var(--red)' : 'var(--green-dark)';
          const icon = type === 'warning' ? '⚠️' : type === 'danger' ? '🚨' : '💡';

          return `
            <div style="background:${bg}; color:${color}; padding:0.9rem 1.1rem; border-radius:10px; font-size:0.875rem; display:flex; align-items:flex-start; gap:0.6rem;">
              <span style="font-size:1.1rem; flex-shrink:0;">${icon}</span>
              <div>${text}</div>
            </div>`;
        }).join('')}
      </div>`;
  },

  renderPurchaseTrendChart(trend) {
    const canvas = document.getElementById('chartPurchaseTrend');
    if (!canvas) return;

    const labels = trend.map(t => t.month_label || t.month || '');
    const values = trend.map(t => t.total || t.amount || 0);

    this.charts.purchaseTrend = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['No Data'],
        datasets: [{
          label: 'Total Purchases (₹)',
          data: values.length ? values : [0],
          backgroundColor: '#2D6A4F',
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `₹${ctx.raw.toLocaleString('en-IN')}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (v) => '₹' + v.toLocaleString('en-IN')
            }
          }
        }
      }
    });
  },

  renderCategoryChart(cats) {
    const canvas = document.getElementById('chartCategorySpending');
    if (!canvas) return;

    const labels = cats.map(c => c.category_name || c.name || '');
    const values = cats.map(c => c.total_spent || c.amount || 0);
    const colors = ['#2D6A4F', '#52B788', '#D4A017', '#C1292E', '#3B82F6', '#6B3A8C', '#7FB069', '#E07A5F'];

    this.charts.categorySpending = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['No Spend'],
        datasets: [{
          data: values.length ? values : [1],
          backgroundColor: colors.slice(0, Math.max(labels.length, 1)),
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ₹${ctx.raw.toLocaleString('en-IN')}`
            }
          }
        }
      }
    });
  },

  renderStockHealthChart(status) {
    const canvas = document.getElementById('chartStockHealth');
    if (!canvas) return;

    const inStock = status.in_stock || 0;
    const lowStock = status.low_stock || 0;
    const outOfStock = status.out_of_stock || 0;

    this.charts.stockHealth = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Healthy Stock', 'Low Stock', 'Out of Stock'],
        datasets: [{
          data: [inStock, lowStock, outOfStock],
          backgroundColor: ['#2D6A4F', '#D4A017', '#C1292E'],
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
        }
      }
    });
  },

  renderReorderTable(items) {
    const container = document.getElementById('reorderTableContainer');
    if (!container) return;

    if (!items.length) {
      container.innerHTML = `
        <div style="text-align:center; padding:1.5rem; color:var(--green-dark);">
          <div style="font-size:1.6rem; margin-bottom:0.25rem;">✨</div>
          <strong style="font-size:0.9rem;">No Reorders Needed</strong>
          <p style="font-size:0.8rem; color:var(--muted); margin-top:0.25rem;">All catalog items have sufficient stock buffers.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Current</th>
              <th>Min Stock</th>
              <th>Suggested Order</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr>
                <td><strong>${item.name}</strong></td>
                <td><strong style="color:var(--red);">${item.current_stock} ${item.unit || ''}</strong></td>
                <td>${item.minimum_stock} ${item.unit || ''}</td>
                <td><span class="badge badge-amber">+${item.suggested_order || (item.minimum_stock * 2)} ${item.unit || ''}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  },

  renderTopUsedTable(items) {
    const container = document.getElementById('topUsedTableContainer');
    if (!container) return;

    if (!items.length) {
      container.innerHTML = '<div class="empty-state" style="padding:1.5rem;"><p>No consumption recorded for this period.</p></div>';
      return;
    }

    container.innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Product</th>
              <th>Total Consumed</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, idx) => `
              <tr>
                <td style="font-weight:700; color:var(--muted);">#${idx + 1}</td>
                <td><strong>${item.name}</strong></td>
                <td><span class="badge badge-green">${item.total_used} ${item.unit}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  },
};

App.registerView('analytics', AnalyticsView);
