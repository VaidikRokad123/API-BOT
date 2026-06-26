import React, { useState, useEffect } from 'react';

export default function Settings({ ctx }) {
  const [providers, setProviders] = useState([]);
  const [engines, setEngines] = useState([]);
  const [activeEngine, setActiveEngine] = useState('');
  const [loginProvider, setLoginProvider] = useState('');
  const [backendUrl, setBackendUrl] = useState('');
  const [loginMsg, setLoginMsg] = useState({ text: '', type: '' });
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [canSaveSession, setCanSaveSession] = useState(false);

  const loadSettingsData = async () => {
    try {
      // Get providers
      const providersData = await ctx.API.get('/providers');
      setProviders(providersData.providers || []);
      if (providersData.providers?.length > 0 && !loginProvider) {
        setLoginProvider(providersData.providers[0].key);
      }

      // Get browser status / engines
      const statusData = await ctx.API.get('/status');
      setEngines(statusData.engines || []);
      setActiveEngine(statusData.browser || '');
    } catch (err) {
      console.warn('Failed to load settings data:', err);
      ctx.showToast(err.message, 'error');
    }
  };

  useEffect(() => {
    loadSettingsData();
    // Load backend URL from localStorage
    setBackendUrl(localStorage.getItem('BACKEND_URL') || '');
  }, []);

  const handleSwitchProvider = async (key) => {
    try {
      const result = await ctx.API.post('/model', { provider: key });
      if (result.success) {
        ctx.showToast(`Switched to ${result.label}`, 'success');
        ctx.updateProviderStatus();
        loadSettingsData();
      }
    } catch (err) {
      ctx.showToast(err.message, 'error');
    }
  };

  const handleSwitchEngine = async (engineKey) => {
    try {
      const result = await ctx.API.post('/browser', { engine: engineKey });
      if (result.success) {
        ctx.showToast(`Browser set to ${result.name}`, 'success');
        loadSettingsData();
      }
    } catch (err) {
      ctx.showToast(err.message, 'error');
    }
  };

  const handleSaveBackendUrl = () => {
    let url = backendUrl.trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    if (url) {
      localStorage.setItem('BACKEND_URL', url);
      ctx.showToast('Backend URL saved! Reloading...', 'success');
      setTimeout(() => window.location.reload(), 1200);
    } else {
      ctx.showToast('Please enter a valid URL', 'warning');
    }
  };

  const handleClearBackendUrl = () => {
    localStorage.removeItem('BACKEND_URL');
    ctx.showToast('Connection reset to default. Reloading...', 'info');
    setTimeout(() => window.location.reload(), 1200);
  };

  const handleStartLogin = async () => {
    if (!loginProvider) return ctx.showToast('Please select a provider', 'warning');
    setOpeningBrowser(true);
    setLoginMsg({ text: '', type: '' });

    try {
      const result = await ctx.API.post('/login/start', { provider: loginProvider });
      if (result.error) throw new Error(result.error);
      setLoginMsg({
        text: '✓ Browser opened. Log in to your account, then click "Save Session".',
        type: 'success'
      });
      setCanSaveSession(true);
      ctx.showToast('Browser opened — log in manually', 'info');
    } catch (err) {
      ctx.showToast(err.message, 'error');
      setLoginMsg({ text: `✗ ${err.message}`, type: 'error' });
    } finally {
      setOpeningBrowser(false);
    }
  };

  const handleSaveLoginSession = async () => {
    setSavingSession(true);

    try {
      const result = await ctx.API.post('/login/save');
      if (result.error) throw new Error(result.error);
      ctx.showToast(`Session saved for ${result.provider}`, 'success');
      ctx.updateProviderStatus();
      setLoginMsg({ text: `✓ ${result.message}`, type: 'success' });
      setCanSaveSession(false);
      loadSettingsData();
    } catch (err) {
      ctx.showToast(err.message, 'error');
      setLoginMsg({ text: `✗ ${err.message}`, type: 'error' });
    } finally {
      setSavingSession(false);
    }
  };

  return (
    <div className="animate-slide-up">
      {/* AI Providers Card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <div>
            <div className="card-title">AI Providers</div>
            <div className="card-subtitle">
              Click a provider to set it as active. Use Login to save a new session.
            </div>
          </div>
        </div>
        <div className="provider-grid">
          {providers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
              Loading providers...
            </div>
          ) : (
            providers.map((p) => (
              <div
                key={p.key}
                className={`provider-card ${p.isActive ? 'active' : ''}`}
                onClick={() => handleSwitchProvider(p.key)}
                style={{ cursor: 'pointer' }}
              >
                <div className={`status-dot ${p.hasSession ? 'online' : 'offline'}`}></div>
                <div className="provider-info">
                  <h4>{p.label}</h4>
                  <span>{p.host}</span>
                </div>
                {p.isActive && <span className="badge badge-purple">Active</span>}
                {p.hasSession ? (
                  <span className="badge badge-success">Session</span>
                ) : (
                  <span className="badge badge-danger">No Session</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Browser Engine Card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <div>
            <div className="card-title">Browser Engine</div>
            <div className="card-subtitle">Default engine for job application forms</div>
          </div>
        </div>
        <div className="provider-grid">
          {engines.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
              Loading engines...
            </div>
          ) : (
            engines.map((e) => (
              <div
                key={e.key}
                className={`provider-card ${e.key === activeEngine ? 'active' : ''}`}
                onClick={() => handleSwitchEngine(e.key)}
                style={{ cursor: 'pointer' }}
              >
                <div className="provider-info">
                  <h4>{e.name}</h4>
                  <span>{e.key}</span>
                </div>
                {e.key === activeEngine && <span className="badge badge-purple">Active</span>}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Backend Connection Card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <div>
            <div className="card-title">Backend Connection</div>
            <div className="card-subtitle">
              Specify your Ngrok tunnel URL if hosting the frontend SPA on Render/GitHub Pages.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="input-group" style={{ flex: 1, minWidth: '250px', marginBottom: 0 }}>
            <label className="input-label">Ngrok Backend URL</label>
            <input
              type="text"
              className="input"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="e.g. https://a1b2-c3d4.ngrok-free.app"
            />
          </div>
          <button className="btn btn-primary" onClick={handleSaveBackendUrl}>
            Save URL
          </button>
          <button className="btn btn-danger" onClick={handleClearBackendUrl}>
            Reset
          </button>
        </div>
      </div>

      {/* Login to Provider Card */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Login to Provider</div>
            <div className="card-subtitle">
              Opens a browser window — log in manually, then click Save Session
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="input-group" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
            <label className="input-label">Provider</label>
            <select
              className="input"
              value={loginProvider}
              onChange={(e) => setLoginProvider(e.target.value)}
            >
              {providers.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleStartLogin} disabled={openingBrowser}>
            {openingBrowser ? (
              <>
                <span className="spinner"></span> Opening...
              </>
            ) : (
              'Open Browser'
            )}
          </button>
          <button
            className="btn btn-success"
            onClick={handleSaveLoginSession}
            disabled={savingSession || !canSaveSession}
          >
            {savingSession ? (
              <>
                <span className="spinner"></span> Saving...
              </>
            ) : (
              'Save Session'
            )}
          </button>
        </div>
        {loginMsg.text && (
          <p
            style={{
              marginTop: '12px',
              fontSize: '13px',
              color: loginMsg.type === 'success' ? '#34d399' : '#f87171'
            }}
          >
            {loginMsg.text}
          </p>
        )}
      </div>
    </div>
  );
}
