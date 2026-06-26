import React, { useState, useEffect } from 'react';

function StatIcon({ type }) {
  const p = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (type === 'provider') return <svg {...p}><path d="M12 2a4 4 0 0 1 4 4v2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h2V6a4 4 0 0 1 4-4z"/></svg>;
  if (type === 'success') return <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>;
  if (type === 'fail') return <svg {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>;
}

export default function Dashboard({ ctx }) {
  const [stats, setStats] = useState({
    provider: 'None',
    success: 0,
    failure: 0,
    successRate: 0,
    recent: []
  });

  useEffect(() => {
    async function loadData() {
      try {
        const status = await ctx.API.get('/status');
        const historyStats = await ctx.API.get('/history/stats');
        setStats({
          provider: status.providerLabel || 'None',
          success: historyStats.success || 0,
          failure: historyStats.failure || 0,
          successRate: historyStats.successRate || 0,
          recent: historyStats.recent || []
        });
      } catch (err) {
        console.warn('Dashboard stats load error:', err);
      }
    }
    loadData();
  }, []);

  const actions = [
    { id: 'chat', icon: 'teal', title: 'Chat', desc: 'Interactive session with your logged-in AI provider', stat: 'teal' },
    { id: 'apply', icon: 'green', title: 'Apply to Job', desc: 'Research company, fill forms, and submit applications', stat: 'green' },
    { id: 'browser', icon: 'blue', title: 'Browser Agent', desc: 'Delegate research and extraction tasks in plain English', stat: 'blue' },
    { id: 'settings', icon: 'violet', title: 'Settings', desc: 'Manage providers, browser engines, and sessions', stat: 'violet' }
  ];

  return (
    <div className="animate-slide-up">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon teal"><StatIcon type="provider" /></div>
          <div className="stat-value" title={stats.provider}>{stats.provider}</div>
          <div className="stat-label">Active Provider</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><StatIcon type="success" /></div>
          <div className="stat-value">{stats.success}</div>
          <div className="stat-label">Successful</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red"><StatIcon type="fail" /></div>
          <div className="stat-value">{stats.failure}</div>
          <div className="stat-label">Failed</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><StatIcon type="rate" /></div>
          <div className="stat-value">{stats.successRate}%</div>
          <div className="stat-label">Success Rate</div>
        </div>
      </div>

      <p className="section-title">Quick Actions</p>
      <div className="action-cards">
        {actions.map(a => (
          <div key={a.id} className="action-card" onClick={() => ctx.navigateTo(a.id)} role="button" tabIndex={0}>
            <div className={`action-icon stat-icon ${a.stat}`}>
              <StatIcon type={a.id === 'apply' ? 'success' : a.id === 'browser' ? 'rate' : 'provider'} />
            </div>
            <h3>{a.title}</h3>
            <p>{a.desc}</p>
            <span className="action-arrow">Open →</span>
          </div>
        ))}
      </div>

      <p className="section-title">Recent Applications</p>
      <div className="card">
        {stats.recent.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <h3>No applications yet</h3>
            <p>Run your first job application from the Apply page to see results here.</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => ctx.navigateTo('apply')}>
              Start applying
            </button>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Role</th>
                  <th>Verdict</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((app, i) => (
                  <tr key={i}>
                    <td className="truncate" style={{ maxWidth: 200 }}>{app.company || '—'}</td>
                    <td>{app.role || '—'}</td>
                    <td>
                      <span className={`badge ${app.verdict === 'success' ? 'badge-success' : 'badge-danger'}`}>
                        {app.verdict}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {new Date(app.timestamp).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
