import React, { useState, useEffect } from 'react';

export default function History({ ctx }) {
  const [stats, setStats] = useState({ total: 0, success: 0, failure: 0, successRate: 0 });
  const [applications, setApplications] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = async (currentFilter) => {
    setLoading(true);
    setError(null);
    try {
      try {
        const statsData = await ctx.API.get('/history/stats');
        setStats({
          total: statsData.total || 0,
          success: statsData.success || 0,
          failure: statsData.failure || 0,
          successRate: statsData.successRate || 0
        });
      } catch { /* stats optional */ }

      const params = currentFilter ? `?verdict=${currentFilter}` : '';
      const data = await ctx.API.get(`/history${params}`);
      setApplications(data.applications || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(filter); }, [filter]);

  return (
    <div className="animate-slide-up">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
          </div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div className="stat-value">{stats.success}</div>
          <div className="stat-label">Successful</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
          <div className="stat-value">{stats.failure}</div>
          <div className="stat-label">Failed</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon teal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          </div>
          <div className="stat-value">{stats.successRate}%</div>
          <div className="stat-label">Success rate</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">All applications</div>
          <select
            className="input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 'auto', padding: '8px 32px 8px 12px', fontSize: 13 }}
          >
            <option value="">All verdicts</option>
            <option value="success">Success only</option>
            <option value="failure">Failure only</option>
          </select>
        </div>

        {loading ? (
          <div className="empty-state"><h3>Loading…</h3></div>
        ) : error ? (
          <div className="empty-state error">
            <h3>Could not load history</h3>
            <p>{error}</p>
          </div>
        ) : applications.length === 0 ? (
          <div className="empty-state">
            <h3>No records found</h3>
            <p>{filter ? 'Try changing the filter.' : 'Applications will appear here after you run Apply.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Company / URL</th>
                  <th>Role</th>
                  <th>Verdict</th>
                  <th>Failure</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app, index) => (
                  <tr key={app._id || index}>
                    <td className="truncate" style={{ maxWidth: 180 }} title={app.url || ''}>
                      {app.company || app.url || '—'}
                    </td>
                    <td>{app.role || '—'}</td>
                    <td>
                      <span className={`badge ${app.verdict === 'success' ? 'badge-success' : 'badge-danger'}`}>
                        {app.verdict}
                      </span>
                    </td>
                    <td>
                      {app.failure_reason ? (
                        <span className="badge badge-warning">{app.failure_reason}</span>
                      ) : '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {app.timestamp ? new Date(app.timestamp).toLocaleString() : '—'}
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
