export async function renderDashboard(container, ctx) {
  container.innerHTML = `
    <div class="animate-slide-up">
      <div class="stats-grid" id="dashStats">
        <div class="stat-card">
          <div class="stat-icon purple">🤖</div>
          <div class="stat-value" id="statProvider">—</div>
          <div class="stat-label">Active Provider</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">✓</div>
          <div class="stat-value" id="statSuccess">0</div>
          <div class="stat-label">Successful Apps</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red">✗</div>
          <div class="stat-value" id="statFailed">0</div>
          <div class="stat-label">Failed Apps</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon cyan">%</div>
          <div class="stat-value" id="statRate">0%</div>
          <div class="stat-label">Success Rate</div>
        </div>
      </div>

      <h2 style="font-size:18px;font-weight:700;margin-bottom:16px;">Quick Actions</h2>
      <div class="action-cards">
        <a href="#chat" class="action-card" data-goto="chat">
          <div class="action-icon stat-icon purple">💬</div>
          <h3>Chat</h3>
          <p>Start an interactive conversation with your AI provider</p>
        </a>
        <a href="#apply" class="action-card" data-goto="apply">
          <div class="action-icon stat-icon green">📄</div>
          <h3>Apply to Job</h3>
          <p>AI-powered job application — auto-fills forms and submits</p>
        </a>
        <a href="#browser" class="action-card" data-goto="browser">
          <div class="action-icon stat-icon blue">🌐</div>
          <h3>Browser Agent</h3>
          <p>Delegate natural-language browser tasks to the AI</p>
        </a>
        <a href="#settings" class="action-card" data-goto="settings">
          <div class="action-icon stat-icon orange">⚙️</div>
          <h3>Settings</h3>
          <p>Manage providers, browser engine, and permissions</p>
        </a>
      </div>

      <h2 style="font-size:18px;font-weight:700;margin:24px 0 16px;">Recent Applications</h2>
      <div class="card" id="recentApps">
        <div class="empty-state">
          <h3>No applications yet</h3>
          <p>Use the Apply feature to start automating your job applications</p>
        </div>
      </div>
    </div>
  `;

  // Load stats
  try {
    const status = await ctx.API.get('/status');
    document.getElementById('statProvider').textContent = status.providerLabel || 'None';
  } catch { /* ignore */ }

  try {
    const stats = await ctx.API.get('/history/stats');
    document.getElementById('statSuccess').textContent = stats.success || 0;
    document.getElementById('statFailed').textContent = stats.failure || 0;
    document.getElementById('statRate').textContent = `${stats.successRate || 0}%`;

    if (stats.recent?.length) {
      const rows = stats.recent.map(app => `
        <tr>
          <td style="max-width:200px" class="truncate">${app.company || '—'}</td>
          <td>${app.role || '—'}</td>
          <td><span class="badge ${app.verdict === 'success' ? 'badge-success' : 'badge-danger'}">${app.verdict}</span></td>
          <td style="color:var(--text-muted);font-size:12px">${new Date(app.timestamp).toLocaleDateString()}</td>
        </tr>
      `).join('');
      document.getElementById('recentApps').innerHTML = `
        <div class="table-wrapper">
          <table><thead><tr><th>Company</th><th>Role</th><th>Verdict</th><th>Date</th></tr></thead>
          <tbody>${rows}</tbody></table>
        </div>`;
    }
  } catch { /* ignore */ }
}
