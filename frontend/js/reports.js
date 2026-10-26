/**
 * Tiger Farm — Reports & CSV Import/Export View Controller
 */

const ReportsView = {
  previewData: null,

  async render(container) {
    this.container = container;
    this.renderLayout();
  },

  refresh() {
    this.renderLayout();
  },

  renderLayout() {
    this.container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Reports, CSV & Data Export</h1>
          <small>Generate printable A4 PDF summaries, download spreadsheets, and bulk import inventory products.</small>
        </div>
      </div>

      <!-- Section 1: Printable PDF Reports -->
      <h3 style="font-size:1.1rem; margin-bottom:0.75rem;">📄 Printable PDF Reports (ReportLab)</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap:1.25rem; margin-bottom:2rem;">
        <!-- Stock Report -->
        <div class="card">
          <div style="font-size:1.8rem; margin-bottom:0.5rem;">📦</div>
          <h4 style="font-size:1rem; margin-bottom:0.25rem;">Complete Stock Report</h4>
          <p style="font-size:0.85rem; color:var(--muted); margin-bottom:1rem;">
            Full farm inventory list, category classifications, threshold flags, and total estimated stock valuation.
          </p>
          <a href="/api/reports/stock/pdf" target="_blank" class="btn btn-primary btn-sm" style="width:100%; justify-content:center;">
            Download Stock PDF
          </a>
        </div>

        <!-- Purchases Report -->
        <div class="card">
          <div style="font-size:1.8rem; margin-bottom:0.5rem;">🛒</div>
          <h4 style="font-size:1rem; margin-bottom:0.25rem;">Purchases & Cost Report</h4>
          <p style="font-size:0.85rem; color:var(--muted); margin-bottom:1rem;">
            Itemized breakdown of all supplier invoices, quantities, unit prices, and financial expenditures.
          </p>
          <div style="display:flex; flex-direction:column; gap:0.4rem; margin-bottom:0.75rem;">
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
              <input type="date" id="repPurchFrom" style="flex:1; min-width:120px; padding:0.45rem;" />
              <input type="date" id="repPurchTo" style="flex:1; min-width:120px; padding:0.45rem;" />
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" id="btnDownloadPurchPdf" style="width:100%; justify-content:center;">
            Download Purchases PDF
          </button>
        </div>

        <!-- Usage Report -->
        <div class="card">
          <div style="font-size:1.8rem; margin-bottom:0.5rem;">🌾</div>
          <h4 style="font-size:1rem; margin-bottom:0.25rem;">Usage & Consumption Report</h4>
          <p style="font-size:0.85rem; color:var(--muted); margin-bottom:1rem;">
            Chronological audit of input applications across farm plots, crops, spray schedules, and field sections.
          </p>
          <div style="display:flex; flex-direction:column; gap:0.4rem; margin-bottom:0.75rem;">
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
              <input type="date" id="repUsageFrom" style="flex:1; min-width:120px; padding:0.45rem;" />
              <input type="date" id="repUsageTo" style="flex:1; min-width:120px; padding:0.45rem;" />
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" id="btnDownloadUsagePdf" style="width:100%; justify-content:center;">
            Download Usage PDF
          </button>
        </div>
      </div>

      <!-- Section 2: CSV Exports -->
      <h3 style="font-size:1.1rem; margin-bottom:0.75rem;">📥 Spreadsheet CSV Exports</h3>
      <div class="card" style="margin-bottom:2rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div>
            <strong>Download raw datasets for Excel, Google Sheets, or farm accountants:</strong>
            <p style="font-size:0.85rem; color:var(--muted); margin-top:0.25rem;">
              Export full records without limits or formatting restrictions.
            </p>
          </div>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
            <a href="/api/export/products" target="_blank" class="btn btn-ghost btn-sm">📦 Products CSV</a>
            <a href="/api/export/purchases" target="_blank" class="btn btn-ghost btn-sm">🛒 Purchases CSV</a>
            <a href="/api/export/usage" target="_blank" class="btn btn-ghost btn-sm">🌾 Usage CSV</a>
          </div>
        </div>
      </div>

      <!-- Section 3: CSV Bulk Import -->
      <h3 style="font-size:1.1rem; margin-bottom:0.75rem;">📤 Bulk Import Products from CSV</h3>
      <div class="card">
        <p style="font-size:0.875rem; color:var(--muted); margin-bottom:1rem;">
          Upload a CSV file containing your existing farm inventory notebook. Expected columns:
          <code>name, category, unit, quantity, min_stock, description</code>.
        </p>

        <form id="formCsvImport" style="display:flex; gap:0.75rem; align-items:center; flex-wrap:wrap; margin-bottom:1.25rem;">
          <input type="file" id="csvFileInput" accept=".csv" required style="max-width:300px;" />
          <button type="submit" class="btn btn-secondary btn-sm" id="btnPreviewCsv">
            🔍 Validate & Preview CSV
          </button>
        </form>

        <!-- Preview Results Container -->
        <div id="csvPreviewContainer"></div>
      </div>
    `;

    this.bindEvents();
  },

  bindEvents() {
    // Purchase PDF with date filter
    document.getElementById('btnDownloadPurchPdf')?.addEventListener('click', () => {
      const from = document.getElementById('repPurchFrom').value;
      const to = document.getElementById('repPurchTo').value;
      const q = new URLSearchParams();
      if (from) q.set('start_date', from);
      if (to) q.set('end_date', to);
      window.open(`/api/reports/purchases/pdf?${q.toString()}`, '_blank');
    });

    // Usage PDF with date filter
    document.getElementById('btnDownloadUsagePdf')?.addEventListener('click', () => {
      const from = document.getElementById('repUsageFrom').value;
      const to = document.getElementById('repUsageTo').value;
      const q = new URLSearchParams();
      if (from) q.set('start_date', from);
      if (to) q.set('end_date', to);
      window.open(`/api/reports/usage/pdf?${q.toString()}`, '_blank');
    });

    // CSV Import Form
    const form = document.getElementById('formCsvImport');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById('csvFileInput');
      if (!fileInput.files.length) {
        App.showToast('Please select a CSV file to upload', 'error');
        return;
      }

      const btn = document.getElementById('btnPreviewCsv');
      btn.disabled = true;
      btn.textContent = 'Validating...';

      const formData = new FormData();
      formData.append('file', fileInput.files[0]);

      const previewDiv = document.getElementById('csvPreviewContainer');
      previewDiv.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

      try {
        const res = await fetch('/api/import/csv/preview', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (res.ok) {
          ReportsView.previewData = fileInput.files[0];
          ReportsView.renderPreviewResults(previewDiv, data);
        } else {
          previewDiv.innerHTML = `<div class="alert alert-error">${data.error || 'Validation failed'}</div>`;
        }
      } catch (err) {
        previewDiv.innerHTML = `<div class="alert alert-error">Network error validating CSV: ${err.message}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Validate & Preview CSV';
      }
    });
  },

  renderPreviewResults(container, data) {
    const valid = data.valid || [];
    const invalid = data.invalid || [];

    container.innerHTML = `
      <div style="border-top:1px solid var(--border); padding-top:1rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
          <div>
            <strong>Validation Results:</strong>
            <span class="badge badge-green">${data.valid_count || 0} Ready to Import</span>
            ${data.invalid_count > 0 ? `<span class="badge badge-red">${data.invalid_count} Invalid / Errors</span>` : ''}
          </div>

          ${valid.length > 0 ? `
            <button class="btn btn-primary btn-sm" id="btnConfirmCsvImport">
              ✓ Confirm & Import ${valid.length} Products
            </button>
          ` : ''}
        </div>

        ${invalid.length > 0 ? `
          <div class="alert alert-warning" style="font-size:0.85rem; margin-bottom:1rem;">
            <strong>Skipped Rows with Issues:</strong>
            <ul style="margin-left:1.25rem; margin-top:0.25rem;">
              ${invalid.map(inv => `<li>Row ${inv.row || '?'}: ${inv.error || JSON.stringify(inv)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <!-- Preview Table -->
        <div class="table-wrap" style="max-height:240px; overflow-y:auto;">
          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Initial Qty</th>
                <th>Min Stock</th>
              </tr>
            </thead>
            <tbody>
              ${valid.map(row => `
                <tr>
                  <td><strong>${row.name}</strong></td>
                  <td>${row.category || 'General'}</td>
                  <td>${row.unit || 'KG'}</td>
                  <td>${row.current_quantity || row.quantity || 0}</td>
                  <td>${row.minimum_stock || row.min_stock || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btnConfirmCsvImport')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnConfirmCsvImport');
      btn.disabled = true;
      btn.textContent = 'Importing...';

      const formData = new FormData();
      formData.append('file', ReportsView.previewData);

      try {
        const res = await fetch('/api/import/csv', {
          method: 'POST',
          body: formData,
        });
        const result = await res.json();
        if (res.ok) {
          App.showToast(result.message || 'CSV imported successfully!');
          await App.loadMetadata();
          container.innerHTML = `
            <div class="alert alert-success">
              ✅ ${result.message} Check the <a href="#products" style="color:var(--green-dark); font-weight:700;">Products catalog</a> to view your newly imported items.
            </div>`;
        } else {
          App.showToast(result.error || 'Import failed', 'error');
          btn.disabled = false;
        }
      } catch (err) {
        App.showToast('Server error while importing', 'error');
        btn.disabled = false;
      }
    });
  },
};

App.registerView('reports', ReportsView);
