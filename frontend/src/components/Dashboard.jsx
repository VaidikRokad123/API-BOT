import React, { useState, useEffect } from 'react';

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

  return (
    <div className="animate-slide-up">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon purple">🤖</div>
          <div className="stat-value">{stats.provider}</div>
          <div className="stat-label">Active Provider</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">✓</div>
          <div className="stat-value">{stats.success}</div>
          <div className="stat-label">Successful Apps</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red">✗</div>
          <div className="stat-value">{stats.failure}</div>
          <div className="stat-label">Failed Apps</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan">%</div>
          <div className="stat-value">{stats.successRate}%</div>
          <div className="stat-label">Success Rate</div>
        </div>
      </div>

      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>Quick Actions</h2>
      <div className="action-cards">
        <a onClick={() => ctx.navigateTo('chat')} className="action-card">
          <div className="action-icon stat-icon purple">💬</div>
          <h3>Chat</h3>
          <p>Start an interactive conversation with your AI provider</p>
        </a>
        <a onClick={() => ctx.navigateTo('apply')} className="action-card">
          <div className="action-icon stat-icon green">📄</div>
          <h3>Apply to Job</h3>
          <p>AI-powered job application — auto-fills forms and submits</p>
        </a>
        <a onClick={() => ctx.navigateTo('browser')} className="action-card">
          <div className="action-icon stat-icon blue">🌐</div>
          <h3>Browser Agent</h3>
          <p>Delegate natural-language browser tasks to the AI</p>
        </a>
        <a onClick={() => ctx.navigateTo('settings')} className="action-card">
          <div className="action-icon stat-icon orange">⚙️</div>
          <h3>Settings</h3>
          <p>Manage providers, browser engine, and connection URL</p>
        </a>
      </div>

      <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '24px 0 16px' }}>Recent Applications</h2>
      <div className="card">
        {stats.recent.length === 0 ? (
          <div className="empty-state">
            <h3>No applications yet</h3>
            <p>Use the Apply feature to start automating your job applications</p>
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
                    <td style={{ maxWidth: '200px' }} className="truncate">
                      {app.company || '—'}
                    </td>
                    <td>{app.role || '—'}</td>
                    <td>
                      <span className={`badge ${app.verdict === 'success' ? 'badge-success' : 'badge-danger'}`}>
                        {app.verdict}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
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
