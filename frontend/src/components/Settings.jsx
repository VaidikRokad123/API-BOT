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
  const [apiKey, setApiKey] = useState('');
  const [loginMsg, setLoginMsg] = useState({ text: '', type: '' });
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [canSaveSession, setCanSaveSession] = useState(false);

  // Cloud & Session Management State
  const [envInfo, setEnvInfo] = useState(null);
  const [importProvider, setImportProvider] = useState('');
  const [importData, setImportData] = useState('');
  const [importing, setImporting] = useState(false);
  const [exportedSessions, setExportedSessions] = useState(null);
  const [loadingExport, setLoadingExport] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  const loadSettingsData = async () => {
    try {
      const providersData = await ctx.API.get('/providers');
      setProviders(providersData.providers || []);
      if (providersData.providers?.length > 0 && !loginProvider) {
        setLoginProvider(providersData.providers[0].key);
      }
      if (providersData.providers?.length > 0 && !importProvider) {
        setImportProvider(providersData.providers[0].key);
      }
      const statusData = await ctx.API.get('/status');
      setEngines(statusData.engines || []);
      setActiveEngine(statusData.browser || '');
      setActiveAiEngine(statusData.aiBrowser || '');

      const envData = await ctx.API.get('/environment').catch(() => null);
      if (envData) setEnvInfo(envData);
    } catch (err) {
      ctx.showToast(err.message, 'error');
    }
  };

  useEffect(() => {
    loadSettingsData();
    setBackendUrl(localStorage.getItem('BACKEND_URL') || '');
    setApiKey(localStorage.getItem('LLM_API_KEY') || '');
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

  const handleSaveApiKey = () => {
    if (apiKey.trim()) {
      localStorage.setItem('LLM_API_KEY', apiKey.trim());
      ctx.showToast('API Key saved!', 'success');
    } else {
      localStorage.removeItem('LLM_API_KEY');
      ctx.showToast('API Key cleared', 'info');
    }
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

  const handleImportSession = async () => {
    if (!importProvider) return ctx.showToast('Select a provider', 'warning');
    if (!importData.trim()) return ctx.showToast('Paste session Base64 or JSON data', 'warning');

    setImporting(true);
    try {
      const res = await ctx.API.post('/sessions/import', {
        provider: importProvider,
        sessionData: importData.trim()
      });
      if (res.error) throw new Error(res.error);
      ctx.showToast(res.message || 'Session imported successfully!', 'success');
      setImportData('');
      ctx.updateProviderStatus();
      loadSettingsData();
    } catch (err) {
      ctx.showToast(err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleFetchExport = async () => {
    setLoadingExport(true);
    try {
      const res = await ctx.API.get('/sessions/export');
      if (res.error) throw new Error(res.error);
      setExportedSessions(res.sessions || {});
      setShowExportModal(true);
    } catch (err) {
      ctx.showToast(err.message, 'error');
    } finally {
      setLoadingExport(false);
    }
  };

  const handleDeleteSession = async (key) => {
    if (!window.confirm(`Delete saved session for ${key}?`)) return;
    try {
      const res = await ctx.API.delete(`/sessions/${key}`);
      if (res.error) throw new Error(res.error);
      ctx.showToast(`Session deleted for ${key}`, 'info');
      ctx.updateProviderStatus();
      loadSettingsData();
    } catch (err) {
      ctx.showToast(err.message, 'error');
    }
  };

  const handleCopyText = (text, label) => {
    navigator.clipboard.writeText(text);
    ctx.showToast(`${label} copied to clipboard!`, 'success');
  };

  const vncUrl = envInfo?.enableVnc
    ? (envInfo.vncPath || '/novnc/vnc.html?autoconnect=true&resize=remote')
    : null;

  return (
    <div className="animate-slide-up">
      {/* Cloud & Docker Environment Banner */}
      {envInfo && (
        <SettingsCard title="Deployment & Environment Status" subtitle="Runtime container configuration and network routing.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Runtime Container</div>
              <div style={{ fontWeight: 600, marginTop: 4 }}>{envInfo.isDocker ? '🐳 Docker Container' : '💻 Local / Node.js'}</div>
            </div>
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Virtual Display (Xvfb)</div>
              <div style={{ fontWeight: 600, marginTop: 4, color: envInfo.hasDisplay ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                {envInfo.hasDisplay ? `✓ Active (${envInfo.display})` : '✕ Headless'}
              </div>
            </div>
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Residential / Custom Proxy</div>
              <div style={{ fontWeight: 600, marginTop: 4, color: envInfo.hasProxy ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                {envInfo.hasProxy ? `✓ Configured` : 'Direct IP'}
              </div>
            </div>
          </div>

          {vncUrl && (
            <div style={{ marginTop: 12, padding: 14, borderRadius: 8, background: 'rgba(99, 102, 241, 0.1)', border: '1px solid var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <strong>Web Remote Browser GUI (noVNC)</strong>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Interact with the container browser live to solve 2FA or Cloudflare challenges.</div>
              </div>
              <a href={vncUrl} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                Open Remote GUI ↗
              </a>
            </div>
          )}
        </SettingsCard>
      )}

      <SettingsCard title="AI Providers" subtitle="Click to activate. Login below or import session tokens.">
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
                {p.hasSession ? (
                  <span className="badge badge-success" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); handleDeleteSession(p.key); }} title="Click to delete session">
                    Session ✕
                  </span>
                ) : (
                  <span className="badge badge-danger">None</span>
                )}
              </div>
            ))
          )}
        </div>
      </SettingsCard>

      {/* Cloud Session Importer & Exporter */}
      <SettingsCard title="Session Importer & Cloud Exporter" subtitle="Import or export Base64 session tokens without restarting your container.">
        <div style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={handleFetchExport} disabled={loadingExport}>
            {loadingExport ? <><span className="spinner" /> Exporting…</> : '📥 Export All Sessions to Base64'}
          </button>
        </div>

        <div className="flex-row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div className="input-group" style={{ minWidth: 140 }}>
            <label className="input-label">Provider</label>
            <select className="input" value={importProvider} onChange={(e) => setImportProvider(e.target.value)}>
              {providers.map(p => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="input-group" style={{ flex: 1 }}>
            <label className="input-label">Paste Base64 Session Token or storageState JSON</label>
            <textarea
              className="input"
              rows={2}
              style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              value={importData}
              onChange={(e) => setImportData(e.target.value)}
              placeholder="Paste Base64 session string or JSON { cookies, origins }..."
            />
          </div>
          <div style={{ marginTop: 24 }}>
            <button type="button" className="btn btn-primary" onClick={handleImportSession} disabled={importing || !importData.trim()}>
              {importing ? <><span className="spinner" /> Importing…</> : 'Import & Save'}
            </button>
          </div>
        </div>

        {/* Export Modal / Viewer */}
        {showExportModal && exportedSessions && (
          <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0 }}>Exported Cloud Environment Variables</h4>
              <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setShowExportModal(false)}>Close</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Copy these Base64 strings into your Render / Docker / Railway environment variables:
            </p>
            {Object.keys(exportedSessions).length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No active sessions found to export.</p>
            ) : (
              Object.entries(exportedSessions).map(([key, s]) => (
                <div key={key} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent-purple)' }}>{s.envVar}</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => handleCopyText(s.base64, s.envVar)}
                    >
                      Copy Base64
                    </button>
                  </div>
                  <input
                    type="text"
                    readOnly
                    className="input"
                    value={s.base64}
                    style={{ fontSize: 11, fontFamily: 'monospace', background: 'var(--bg-primary)' }}
                    onClick={(e) => e.target.select()}
                  />
                </div>
              ))
            )}
          </div>
        )}
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

      <SettingsCard title="Backend Connection & API Security" subtitle="Configure your API key and connection when hosting remotely.">
        <div className="flex-row" style={{ marginBottom: 12 }}>
          <div className="input-group">
            <label className="input-label">Backend URL (leave empty for same-origin)</label>
            <input
              type="text"
              className="input"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="https://my-local-llm-api.onrender.com"
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={handleSaveBackendUrl}>Save</button>
          <button type="button" className="btn btn-secondary" onClick={handleClearBackendUrl}>Reset</button>
        </div>

        <div className="flex-row">
          <div className="input-group">
            <label className="input-label">LLM API Key (Optional — matches LLM_API_KEY env var)</label>
            <input
              type="password"
              className="input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your secret API key..."
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={handleSaveApiKey}>Save Key</button>
        </div>
      </SettingsCard>

      <SettingsCard title="Provider Login (Interactive)" subtitle="Opens a browser — sign in manually, then save the session.">
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
