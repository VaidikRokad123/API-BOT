export async function renderHistory(container, ctx) {
  container.innerHTML = `
    <div class="animate-slide-up">
      <div class="stats-grid" id="histStats">
        <div class="stat-card"><div class="stat-icon blue">📊</div><div class="stat-value" id="hTotal">0</div><div class="stat-label">Total Applications</div></div>
        <div class="stat-card"><div class="stat-icon green">✓</div><div class="stat-value" id="hSuccess">0</div><div class="stat-label">Successful</div></div>
        <div class="stat-card"><div class="stat-icon red">✗</div><div class="stat-value" id="hFailed">0</div><div class="stat-label">Failed</div></div>
        <div class="stat-card"><div class="stat-icon cyan">%</div><div class="stat-value" id="hRate">0%</div><div class="stat-label">Success Rate</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Application History</div>
          <div style="display:flex;gap:8px">
            <select class="input" id="histFilter" style="width:auto;padding:6px 32px 6px 12px">
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
            </select>
          </div>
        </div>
        <div id="histTable">
          <div class="empty-state"><h3>Loading...</h3></div>
        </div>
      </div>
    </div>
  `;

  async function load(verdict) {
    try {
      const stats = await ctx.API.get('/history/stats');
      document.getElementById('hTotal').textContent = stats.total || 0;
      document.getElementById('hSuccess').textContent = stats.success || 0;
      document.getElementById('hFailed').textContent = stats.failure || 0;
      document.getElementById('hRate').textContent = `${stats.successRate || 0}%`;
    } catch { /* ignore */ }

    try {
      const params = verdict ? `?verdict=${verdict}` : '';
      const data = await ctx.API.get(`/history${params}`);

      if (!data.applications?.length) {
        document.getElementById('histTable').innerHTML = `
          <div class="empty-state"><h3>No applications found</h3><p>Start applying to jobs to see your history here</p></div>`;
        return;
      }

      const rows = data.applications.map(app => `
        <tr>
          <td style="max-width:180px" class="truncate" title="${app.url || ''}">${app.company || app.url || '—'}</td>
          <td>${app.role || '—'}</td>
          <td><span class="badge ${app.verdict === 'success' ? 'badge-success' : 'badge-danger'}">${app.verdict}</span></td>
          <td>${app.failure_reason ? `<span class="badge badge-warning">${app.failure_reason}</span>` : '—'}</td>
          <td style="color:var(--text-muted);font-size:12px">${app.timestamp ? new Date(app.timestamp).toLocaleString() : '—'}</td>
        </tr>
      `).join('');

      document.getElementById('histTable').innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Company / URL</th><th>Role</th><th>Verdict</th><th>Reason</th><th>Date</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    } catch (err) {
      document.getElementById('histTable').innerHTML = `
        <div class="empty-state"><h3>Could not load history</h3><p>${err.message}</p></div>`;
    }
  }

  document.getElementById('histFilter').addEventListener('change', (e) => load(e.target.value));
  load();
}
