/**
 * Tiger Farm — Notifications View Controller
 */

const NotificationsView = {
  unreadOnly: false,
  page: 1,

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
          <h1 class="page-title">Alerts & System Notifications</h1>
          <small>Automated triggers for low stock thresholds, stock-outs, and farm activity warnings.</small>
        </div>
        <div style="display:flex; gap:0.5rem;">
          <button class="btn btn-secondary btn-sm" id="btnMarkAllRead">✓ Mark All as Read</button>
        </div>
      </div>

      <!-- Filter Controls -->
      <div class="filters-bar">
        <button class="btn ${!this.unreadOnly ? 'btn-primary' : 'btn-ghost'} btn-sm" id="btnNotifAll">All Notifications</button>
        <button class="btn ${this.unreadOnly ? 'btn-primary' : 'btn-ghost'} btn-sm" id="btnNotifUnread">Unread Only</button>
      </div>

      <!-- Notifications List Container -->
      <div class="card" id="notificationsListContainer" style="padding:0; overflow:hidden;">
        <div class="loading-overlay"><div class="spinner"></div></div>
      </div>

      <!-- Pagination -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; font-size:0.875rem;" id="notifPaginationContainer"></div>
    `;

    this.bindControls();
  },

  bindControls() {
    document.getElementById('btnNotifAll')?.addEventListener('click', () => {
      this.unreadOnly = false;
      this.page = 1;
      this.renderLayout();
      this.fetchAndRenderList();
    });

    document.getElementById('btnNotifUnread')?.addEventListener('click', () => {
      this.unreadOnly = true;
      this.page = 1;
      this.renderLayout();
      this.fetchAndRenderList();
    });

    document.getElementById('btnMarkAllRead')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/notifications/read-all', { method: 'POST' });
        if (res.ok) {
          App.showToast('All notifications marked as read.');
          App.fetchUnreadCount();
          this.fetchAndRenderList();
        }
      } catch {
        App.showToast('Failed to mark all as read', 'error');
      }
    });
  },

  async fetchAndRenderList() {
    const container = document.getElementById('notificationsListContainer');
    if (!container) return;
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
      const res = await fetch(`/api/notifications?unread_only=${this.unreadOnly}&page=${this.page}&per_page=20`);
      if (!res.ok) throw new Error('Failed to load notifications');
      const data = await res.json();
      this.renderList(container, data.notifications || [], data.total || 0, data.pages || 1);
    } catch (err) {
      container.innerHTML = `<div class="alert alert-error" style="margin:1rem;">Error: ${err.message}</div>`;
    }
  },

  renderList(container, notifs, total, totalPages) {
    if (!notifs.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔔</div>
          <h3>No notifications found</h3>
          <p>${this.unreadOnly ? 'You have no unread notifications.' : 'No alerts have been logged yet.'}</p>
        </div>`;
      document.getElementById('notifPaginationContainer').innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column;">
        ${notifs.map(n => {
          const isUnread = !n.is_read;
          const icon = n.type === 'out_of_stock' ? '🚨' : n.type === 'low_stock' ? '⚠️' : 'ℹ️';
          const badgeClass = n.type === 'out_of_stock' ? 'badge-red' : n.type === 'low_stock' ? 'badge-amber' : 'badge-blue';

          return `
            <div style="display:flex; align-items:flex-start; justify-content:space-between; padding:1rem 1.25rem; border-bottom:1px solid var(--border); background:${isUnread ? 'rgba(82,183,136,0.06)' : 'transparent'};">
              <div style="display:flex; gap:0.75rem; align-items:flex-start;">
                <span style="font-size:1.3rem; line-height:1;">${icon}</span>
                <div>
                  <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                    <strong style="font-size:0.95rem; color:var(--text);">${n.title}</strong>
                    <span class="badge ${badgeClass}">${(n.type || 'info').replace('_', ' ').toUpperCase()}</span>
                    ${isUnread ? '<span class="badge badge-green">NEW</span>' : ''}
                  </div>
                  <div style="font-size:0.875rem; color:var(--text-mid); margin-top:0.2rem;">${n.message}</div>
                  <small style="color:var(--muted); font-size:0.75rem; margin-top:0.25rem; display:block;">${n.created_at}</small>
                </div>
              </div>

              ${isUnread ? `
                <button class="btn btn-ghost btn-sm btn-mark-read" data-id="${n.id}" style="margin-left:0.5rem; flex-shrink:0;">
                  Mark Read
                </button>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Pagination
    const pag = document.getElementById('notifPaginationContainer');
    if (pag) {
      pag.innerHTML = `
        <span style="color:var(--muted);">Showing ${notifs.length} of ${total} alerts (Page ${this.page} of ${totalPages})</span>
        <div style="display:flex; gap:0.4rem;">
          <button class="btn btn-ghost btn-sm" id="btnNotifPrev" ${this.page <= 1 ? 'disabled' : ''}>&larr; Previous</button>
          <button class="btn btn-ghost btn-sm" id="btnNotifNext" ${this.page >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
        </div>
      `;

      document.getElementById('btnNotifPrev')?.addEventListener('click', () => {
        if (this.page > 1) {
          this.page--;
          this.fetchAndRenderList();
        }
      });
      document.getElementById('btnNotifNext')?.addEventListener('click', () => {
        if (this.page < totalPages) {
          this.page++;
          this.fetchAndRenderList();
        }
      });
    }

    // Bind individual mark read
    container.querySelectorAll('.btn-mark-read').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          const res = await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
          if (res.ok) {
            App.showToast('Notification marked as read.');
            App.fetchUnreadCount();
            this.fetchAndRenderList();
          }
        } catch {
          App.showToast('Error marking notification', 'error');
        }
      });
    });
  },
};

App.registerView('notifications', NotificationsView);
