import React, { useState, useEffect } from 'react';

export default function ApiDashboard({ ctx }) {
  const [models, setModels] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [copiedKey, setCopiedKey] = useState(null);

  // Playground state
  const [playgroundModel, setPlaygroundModel] = useState('chatgpt');
  const [playgroundPrompt, setPlaygroundPrompt] = useState('Explain what an API is in 2 simple sentences.');
  const [playgroundSystem, setPlaygroundSystem] = useState('You are a helpful AI assistant.');
  const [playgroundLoading, setPlaygroundLoading] = useState(false);
  const [playgroundResponse, setPlaygroundResponse] = useState('');
  const [playgroundStats, setPlaygroundStats] = useState(null);

  const localBaseUrl = 'http://localhost:3000/v1';
  const remoteBaseUrl = `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000'}/v1`;

  const fetchModels = async () => {
    try {
      setLoadingModels(true);
      const res = await ctx.API.rawGet('/v1/models');
      if (res && res.data) {
        setModels(res.data);
      }
    } catch (err) {
      console.warn('Failed to load models:', err);
    } finally {
      setLoadingModels(false);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await ctx.API.get('/v1/sessions');
      if (res && res.sessions) {
        setSessions(res.sessions);
      }
    } catch (err) {
      console.warn('Failed to load sessions:', err);
    }
  };

  useEffect(() => {
    fetchModels();
    fetchSessions();
  }, []);

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    ctx.showToast('Copied to clipboard!', 'success');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handlePlaygroundSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!playgroundPrompt.trim() || playgroundLoading) return;

    setPlaygroundLoading(true);
    setPlaygroundResponse('');
    setPlaygroundStats(null);

    const startTime = Date.now();
    try {
      const body = {
        model: playgroundModel,
        messages: [
          ...(playgroundSystem ? [{ role: 'system', content: playgroundSystem }] : []),
          { role: 'user', content: playgroundPrompt }
        ]
      };

      const res = await ctx.API.rawPost('/v1/chat/completions', body);
      const elapsedMs = Date.now() - startTime;

      if (res.error) {
        setPlaygroundResponse(`Error: ${res.error.message || JSON.stringify(res.error)}`);
      } else if (res.choices && res.choices[0]?.message) {
        setPlaygroundResponse(res.choices[0].message.content);
        setPlaygroundStats({
          timeMs: elapsedMs,
          model: res.model,
          promptTokens: res.usage?.prompt_tokens || 0,
          completionTokens: res.usage?.completion_tokens || 0,
          totalTokens: res.usage?.total_tokens || 0
        });
        fetchSessions();
      }
    } catch (err) {
      setPlaygroundResponse(`Request Error: ${err.message}`);
    } finally {
      setPlaygroundLoading(false);
    }
  };

  const handleCloseSession = async (sessionId) => {
    try {
      await ctx.API.rawPost(`/api/v1/sessions/${sessionId}`, {}, { method: 'DELETE' });
      ctx.showToast(`Closed session ${sessionId}`, 'info');
      fetchSessions();
    } catch (err) {
      ctx.showToast(err.message, 'error');
    }
  };

  const pythonSnippet = `from openai import OpenAI

# Connect to your local/ngrok API
client = OpenAI(
    base_url="${remoteBaseUrl}",
    api_key="local",
    default_headers={"ngrok-skip-browser-warning": "true"}
)

response = client.chat.completions.create(
    model="${playgroundModel}",
    messages=[
        {"role": "user", "content": "Explain quantum computing simply."}
    ]
)

print(response.choices[0].message.content)`;

  const curlSnippet = `curl ${remoteBaseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "ngrok-skip-browser-warning: true" \\
  -d '{
    "model": "${playgroundModel}",
    "messages": [{"role": "user", "content": "Hello world!"}]
  }'`;

  return (
    <div className="animate-slide-up stack-lg">
      {/* Endpoint URLs Banner */}
      <div className="card api-endpoint-banner">
        <div className="api-endpoint-header">
          <div className="api-badge">
            <span className="status-dot online" />
            <span>OpenAI Compatible Server</span>
          </div>
          <span className="api-subtitle">Drop-in replacement for OpenAI SDKs, LangChain, Chatbox & Cursor</span>
        </div>

        <div className="api-urls-grid">
          <div className="api-url-card">
            <div className="api-url-label">
              <span>🌐 Public ngrok Base URL (Use Anywhere)</span>
              <button
                type="button"
                className="btn-copy"
                onClick={() => handleCopy(remoteBaseUrl, 'remote-url')}
              >
                {copiedKey === 'remote-url' ? '✓ Copied' : 'Copy URL'}
              </button>
            </div>
            <code className="api-url-code">{remoteBaseUrl}</code>
          </div>

          <div className="api-url-card">
            <div className="api-url-label">
              <span>💻 Localhost Base URL</span>
              <button
                type="button"
                className="btn-copy"
                onClick={() => handleCopy(localBaseUrl, 'local-url')}
              >
                {copiedKey === 'local-url' ? '✓ Copied' : 'Copy URL'}
              </button>
            </div>
            <code className="api-url-code">{localBaseUrl}</code>
          </div>
        </div>
      </div>

      {/* Interactive Playground & Code Snippets Grid */}
      <div className="api-grid-split">
        {/* Playground */}
        <div className="card api-playground-card">
          <div className="card-header">
            <div>
              <div className="card-title">Live API Playground</div>
              <div className="card-subtitle">Test completions directly against your active web sessions</div>
            </div>
            <select
              className="select api-model-select"
              value={playgroundModel}
              onChange={(e) => setPlaygroundModel(e.target.value)}
            >
              <option value="chatgpt">ChatGPT (OpenAI)</option>
              <option value="grok">Grok (xAI)</option>
              <option value="gemini">Gemini (Google)</option>
              <option value="perplexity">Perplexity</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </div>

          <form onSubmit={handlePlaygroundSubmit} className="api-playground-form">
            <div className="input-group">
              <label className="input-label" htmlFor="api-system-input">System Prompt (Optional)</label>
              <input
                id="api-system-input"
                type="text"
                className="input input-sm"
                value={playgroundSystem}
                onChange={(e) => setPlaygroundSystem(e.target.value)}
                placeholder="You are a helpful AI assistant."
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="api-prompt-input">User Prompt</label>
              <textarea
                id="api-prompt-input"
                className="input api-prompt-textarea"
                rows={3}
                value={playgroundPrompt}
                onChange={(e) => setPlaygroundPrompt(e.target.value)}
                placeholder="Enter prompt to send..."
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={playgroundLoading}
            >
              {playgroundLoading ? (
                <>
                  <span className="spinner" />
                  <span>Generating Response...</span>
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  <span>Execute /v1/chat/completions</span>
                </>
              )}
            </button>
          </form>

          {/* Response Box */}
          {playgroundResponse && (
            <div className="api-response-container animate-slide-up">
              <div className="api-response-header">
                <span>Output:</span>
                {playgroundStats && (
                  <span className="api-stats-badge">
                    ⚡ {(playgroundStats.timeMs / 1000).toFixed(2)}s · {playgroundStats.totalTokens} tokens
                  </span>
                )}
              </div>
              <div className="api-response-content">
                <pre>{playgroundResponse}</pre>
              </div>
            </div>
          )}
        </div>

        {/* Code Snippets */}
        <div className="card api-snippets-card">
          <div className="card-header">
            <div>
              <div className="card-title">Integration Code</div>
              <div className="card-subtitle">Ready-to-use snippets for Python and cURL</div>
            </div>
          </div>

          <div className="api-snippet-section">
            <div className="api-snippet-header">
              <span className="snippet-lang">🐍 Python (openai SDK)</span>
              <button
                type="button"
                className="btn-copy-sm"
                onClick={() => handleCopy(pythonSnippet, 'python')}
              >
                {copiedKey === 'python' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <pre className="code-block"><code>{pythonSnippet}</code></pre>
          </div>

          <div className="api-snippet-section" style={{ marginTop: '16px' }}>
            <div className="api-snippet-header">
              <span className="snippet-lang">💻 cURL</span>
              <button
                type="button"
                className="btn-copy-sm"
                onClick={() => handleCopy(curlSnippet, 'curl')}
              >
                {copiedKey === 'curl' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <pre className="code-block"><code>{curlSnippet}</code></pre>
          </div>
        </div>
      </div>

      {/* Models & Active Sessions Table */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Supported Models & Providers</div>
            <div className="card-subtitle">Available AI providers registered with your local server</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={fetchModels}>
            Refresh Models
          </button>
        </div>

        <div className="models-grid">
          {models.map(m => (
            <div key={m.id} className="model-status-card">
              <div className="model-status-top">
                <span className="model-name">{m.meta?.name || m.id}</span>
                <span className={`badge ${m.meta?.loggedIn ? 'badge-green' : 'badge-amber'}`}>
                  {m.meta?.loggedIn ? '✓ Logged In' : 'Not Logged In'}
                </span>
              </div>
              <div className="model-id-code">ID: <code>{m.id}</code></div>
              <div className="model-provider-sub">Owner: {m.owned_by}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
