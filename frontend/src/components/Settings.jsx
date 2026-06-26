import React, { useState, useEffect } from 'react';

function SettingsCard({ title, subtitle, children }) {
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <div>
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function Settings({ ctx }) {
  const [providers, setProviders] = useState([]);
  const [engines, setEngines] = useState([]);
  const [activeEngine, setActiveEngine] = useState('');
  const [activeAiEngine, setActiveAiEngine] = useState('');
  const [loginProvider, setLoginProvider] = useState('');
  const [backendUrl, setBackendUrl] = useState('');
  const [loginMsg, setLoginMsg] = useState({ text: '', type: '' });
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [canSaveSession, setCanSaveSession] = useState(false);

  const loadSettingsData = async () => {
    try {
      const providersData = await ctx.API.get('/providers');
      setProviders(providersData.providers || []);
      if (providersData.providers?.length > 0 && !loginProvider) {
        setLoginProvider(providersData.providers[0].key);
      }
      const statusData = await ctx.API.get('/status');
      setEngines(statusData.engines || []);
      setActiveEngine(statusData.browser || '');
      setActiveAiEngine(statusData.aiBrowser || '');
    } catch (err) {
      ctx.showToast(err.message, 'error');
    }
  };

  useEffect(() => {
    loadSettingsData();
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

  const handleSwitchAiEngine = async (engineKey) => {
    try {
      const result = await ctx.API.post('/browser/ai', { engine: engineKey });
      if (result.success) {
        ctx.showToast(`AI browser set to ${result.name}`, 'success');
        loadSettingsData();
      }
    } catch (err) {
      ctx.showToast(err.message, 'error');
    }
  };

  const handleSaveBackendUrl = () => {
    let url = backendUrl.trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
    if (url) {
      localStorage.setItem('BACKEND_URL', url);
      ctx.showToast('Backend URL saved — reloading…', 'success');
      setTimeout(() => window.location.reload(), 1200);
    } else {
      ctx.showToast('Please enter a valid URL', 'warning');
    }
  };

  const handleClearBackendUrl = () => {
    localStorage.removeItem('BACKEND_URL');
    ctx.showToast('Reset to default — reloading…', 'info');
    setTimeout(() => window.location.reload(), 1200);
  };

  const handleStartLogin = async () => {
    if (!loginProvider) return ctx.showToast('Select a provider first', 'warning');
    setOpeningBrowser(true);
    setLoginMsg({ text: '', type: '' });
    try {
      const result = await ctx.API.post('/login/start', { provider: loginProvider });
      if (result.error) throw new Error(result.error);
      setLoginMsg({ text: 'Browser opened — log in, then save session.', type: 'success' });
      setCanSaveSession(true);
      ctx.showToast('Browser opened', 'info');
    } catch (err) {
      ctx.showToast(err.message, 'error');
      setLoginMsg({ text: err.message, type: 'error' });
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
      setLoginMsg({ text: result.message, type: 'success' });
      setCanSaveSession(false);
      loadSettingsData();
    } catch (err) {
      ctx.showToast(err.message, 'error');
      setLoginMsg({ text: err.message, type: 'error' });
    } finally {
      setSavingSession(false);
    }
  };

  return (
    <div className="animate-slide-up">
      <SettingsCard title="AI Providers" subtitle="Click to activate. Login below to save a new session.">
        <div className="provider-grid">
          {providers.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', padding: 12 }}>Loading providers…</p>
          ) : (
            providers.map(p => (
              <div
                key={p.key}
                className={`provider-card ${p.isActive ? 'active' : ''}`}
                onClick={() => handleSwitchProvider(p.key)}
                role="button"
                tabIndex={0}
              >
                <div className={`status-dot ${p.hasSession ? 'online' : 'offline'}`} />
                <div className="provider-info">
                  <h4>{p.label}</h4>
                  <span>{p.host}</span>
                </div>
                {p.isActive && <span className="badge badge-purple">Active</span>}
                {p.hasSession ? <span className="badge badge-success">Session</span> : <span className="badge badge-danger">None</span>}
              </div>
            ))
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Browser Engine (Hands)" subtitle="Executes form filling and browser tasks.">
        <div className="provider-grid">
          {engines.map(e => (
            <div
              key={e.key}
              className={`provider-card ${e.key === activeEngine ? 'active' : ''} ${e.blocked ? 'blocked' : ''}`}
              onClick={() => !e.blocked && handleSwitchEngine(e.key)}
              role="button"
              tabIndex={0}
            >
              <div className="provider-info">
                <h4>{e.name}</h4>
                <span>{e.key}{e.blocked && ' · blocked'}</span>
              </div>
              {e.key === activeEngine && <span className="badge badge-purple">Active</span>}
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="AI Engine (Brain)" subtitle="Runs the active AI provider session for reasoning.">
        <div className="provider-grid">
          {engines.map(e => (
            <div
              key={`ai-${e.key}`}
              className={`provider-card ${e.key === activeAiEngine ? 'active' : ''} ${e.aiBlocked ? 'blocked' : ''}`}
              onClick={() => !e.aiBlocked && handleSwitchAiEngine(e.key)}
              role="button"
              tabIndex={0}
            >
              <div className="provider-info">
                <h4>{e.name}</h4>
                <span>{e.key}{e.aiBlocked && ' · blocked'}</span>
              </div>
              {e.key === activeAiEngine && <span className="badge badge-purple">Active</span>}
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Backend Connection" subtitle="Point the UI at your API when hosting the SPA separately (e.g. ngrok).">
        <div className="flex-row">
          <div className="input-group">
            <label className="input-label">Backend URL</label>
            <input
              type="text"
              className="input"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="https://your-tunnel.ngrok-free.app"
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={handleSaveBackendUrl}>Save</button>
          <button type="button" className="btn btn-secondary" onClick={handleClearBackendUrl}>Reset</button>
        </div>
      </SettingsCard>

      <SettingsCard title="Provider Login" subtitle="Opens a browser — sign in manually, then save the session.">
        <div className="flex-row">
          <div className="input-group">
            <label className="input-label">Provider</label>
            <select className="input" value={loginProvider} onChange={(e) => setLoginProvider(e.target.value)}>
              {providers.map(p => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-primary" onClick={handleStartLogin} disabled={openingBrowser}>
            {openingBrowser ? <><span className="spinner" /> Opening…</> : 'Open browser'}
          </button>
          <button type="button" className="btn btn-success" onClick={handleSaveLoginSession} disabled={savingSession || !canSaveSession}>
            {savingSession ? <><span className="spinner" /> Saving…</> : 'Save session'}
          </button>
        </div>
        {loginMsg.text && (
          <p style={{ marginTop: 14, fontSize: 13, color: loginMsg.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {loginMsg.text}
          </p>
        )}
      </SettingsCard>
    </div>
  );
}
