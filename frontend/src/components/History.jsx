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
      // Load Stats
      try {
        const statsData = await ctx.API.get('/history/stats');
        setStats({
          total: statsData.total || 0,
          success: statsData.success || 0,
          failure: statsData.failure || 0,
          successRate: statsData.successRate || 0
        });
      } catch (statErr) {
        console.warn('Failed to load history stats:', statErr);
      }

      // Load Applications List
      const params = currentFilter ? `?verdict=${currentFilter}` : '';
      const data = await ctx.API.get(`/history${params}`);
      setApplications(data.applications || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(filter);
  }, [filter]);

  return (
    <div className="animate-slide-up">
      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">📊</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Applications</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">✓</div>
          <div className="stat-value">{stats.success}</div>
          <div className="stat-label">Successful</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red">✗</div>
          <div className="stat-value">{stats.failure}</div>
          <div className="stat-label">Failed</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan">%</div>
          <div className="stat-value">{stats.successRate}%</div>
          <div className="stat-label">Success Rate</div>
        </div>
      </div>

      {/* History Card */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title">Application History</div>
          <div>
            <select
              className="input"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: 'auto', padding: '6px 32px 6px 12px' }}
            >
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">
            <h3>Loading...</h3>
          </div>
        ) : error ? (
          <div className="empty-state">
            <h3 style={{ color: 'var(--accent-red)' }}>Could not load history</h3>
            <p>{error}</p>
          </div>
        ) : applications.length === 0 ? (
          <div className="empty-state">
            <h3>No applications found</h3>
            <p>Start applying to jobs to see your history here</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Company / URL</th>
                  <th>Role</th>
                  <th>Verdict</th>
                  <th>Reason</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app, index) => (
                  <tr key={app._id || index}>
                    <td style={{ maxWidth: '180px' }} className="truncate" title={app.url || ''}>
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
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
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
