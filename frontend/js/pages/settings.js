export async function renderSettings(container, ctx) {
  container.innerHTML = `
    <div class="animate-slide-up">
      <div class="card" style="margin-bottom:24px">
        <div class="card-header">
          <div><div class="card-title">AI Providers</div>
          <div class="card-subtitle">Click a provider to set it as active. Use Login to save a new session.</div></div>
        </div>
        <div class="provider-grid" id="providerGrid">
          <div style="text-align:center;padding:20px;color:var(--text-muted)">Loading providers...</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:24px">
        <div class="card-header">
          <div><div class="card-title">Browser Engine</div>
          <div class="card-subtitle">Default engine for job application forms</div></div>
        </div>
        <div class="provider-grid" id="engineGrid">
          <div style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</div>
        </div>
      </div>
      
      <div class="card" style="margin-bottom:24px">
        <div class="card-header">
          <div><div class="card-title">Backend Connection</div>
          <div class="card-subtitle">Specify your Ngrok tunnel URL if hosting the frontend SPA on Render/GitHub Pages.</div></div>
        </div>
        <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
          <div class="input-group" style="flex:1;min-width:250px;margin-bottom:0">
            <label class="input-label">Ngrok Backend URL</label>
            <input type="text" class="input" id="backendUrlInput" placeholder="e.g. https://a1b2-c3d4.ngrok-free.app">
          </div>
          <button class="btn btn-primary" id="saveBackendBtn">Save URL</button>
          <button class="btn btn-danger" id="clearBackendBtn">Reset</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Login to Provider</div>
          <div class="card-subtitle">Opens a browser window — log in manually, then click Save Session</div></div>
        </div>
        <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
          <div class="input-group" style="flex:1;min-width:200px;margin-bottom:0">
            <label class="input-label">Provider</label>
            <select class="input" id="loginProvider"></select>
          </div>
          <button class="btn btn-primary" id="loginStartBtn">Open Browser</button>
          <button class="btn btn-success" id="loginSaveBtn" disabled>Save Session</button>
        </div>
        <p id="loginMsg" style="margin-top:12px;font-size:13px;color:var(--text-muted)"></p>
      </div>
    </div>
  `;

  // Load providers
  try {
    const data = await ctx.API.get('/providers');
    const grid = document.getElementById('providerGrid');
    const select = document.getElementById('loginProvider');

    grid.innerHTML = data.providers.map(p => `
      <div class="provider-card ${p.isActive ? 'active' : ''}" data-key="${p.key}">
        <div class="status-dot ${p.hasSession ? 'online' : 'offline'}"></div>
        <div class="provider-info">
          <h4>${p.label}</h4>
          <span>${p.host}</span>
        </div>
        ${p.isActive ? '<span class="badge badge-purple">Active</span>' : ''}
        ${p.hasSession ? '<span class="badge badge-success">Session</span>' : '<span class="badge badge-danger">No Session</span>'}
      </div>
    `).join('');

    select.innerHTML = data.providers.map(p => `<option value="${p.key}">${p.label}</option>`).join('');

    // Click to switch provider
    grid.querySelectorAll('.provider-card').forEach(card => {
      card.addEventListener('click', async () => {
        const key = card.dataset.key;
        const result = await ctx.API.post('/model', { provider: key });
        if (result.success) {
          ctx.showToast(`Switched to ${result.label}`, 'success');
          ctx.updateProviderStatus();
          renderSettings(container, ctx);
        }
      });
    });
  } catch (err) {
    document.getElementById('providerGrid').innerHTML = `<p style="color:var(--text-muted)">Error: ${err.message}</p>`;
  }

  // Load engines
  try {
    const status = await ctx.API.get('/status');
    const engines = status.engines || [];
    document.getElementById('engineGrid').innerHTML = engines.map(e => `
      <div class="provider-card ${e.key === status.browser ? 'active' : ''}" data-engine="${e.key}">
        <div class="provider-info">
          <h4>${e.name}</h4>
          <span>${e.key}</span>
        </div>
        ${e.key === status.browser ? '<span class="badge badge-purple">Active</span>' : ''}
      </div>
    `).join('');

    document.getElementById('engineGrid').querySelectorAll('.provider-card').forEach(card => {
      card.addEventListener('click', async () => {
        const engine = card.dataset.engine;
        const result = await ctx.API.post('/browser', { engine });
        if (result.success) {
          ctx.showToast(`Browser set to ${result.name}`, 'success');
          renderSettings(container, ctx);
        }
      });
    });
  } catch { /* ignore */ }

  // Login flow
  document.getElementById('loginStartBtn').addEventListener('click', async () => {
    const provider = document.getElementById('loginProvider').value;
    const btn = document.getElementById('loginStartBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Opening...';

    try {
      const result = await ctx.API.post('/login/start', { provider });
      if (result.error) throw new Error(result.error);
      document.getElementById('loginMsg').textContent = '✓ Browser opened. Log in to your account, then click "Save Session".';
      document.getElementById('loginMsg').style.color = '#34d399';
      document.getElementById('loginSaveBtn').disabled = false;
      ctx.showToast('Browser opened — log in manually', 'info');
    } catch (err) {
      ctx.showToast(err.message, 'error');
      document.getElementById('loginMsg').textContent = `✗ ${err.message}`;
      document.getElementById('loginMsg').style.color = '#f87171';
    }
    btn.disabled = false;
    btn.textContent = 'Open Browser';
  });

  document.getElementById('loginSaveBtn').addEventListener('click', async () => {
    const btn = document.getElementById('loginSaveBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';

    try {
      const result = await ctx.API.post('/login/save');
      if (result.error) throw new Error(result.error);
      ctx.showToast(`Session saved for ${result.provider}`, 'success');
      ctx.updateProviderStatus();
      document.getElementById('loginMsg').textContent = `✓ ${result.message}`;
      document.getElementById('loginMsg').style.color = '#34d399';
      renderSettings(container, ctx);
    } catch (err) {
      ctx.showToast(err.message, 'error');
      document.getElementById('loginMsg').textContent = `✗ ${err.message}`;
      document.getElementById('loginMsg').style.color = '#f87171';
      btn.disabled = false;
      btn.textContent = 'Save Session';
    }
  });

  // Backend connection settings logic
  const savedUrl = localStorage.getItem('BACKEND_URL') || '';
  const inputEl = document.getElementById('backendUrlInput');
  if (inputEl) inputEl.value = savedUrl;

  document.getElementById('saveBackendBtn')?.addEventListener('click', () => {
    let url = document.getElementById('backendUrlInput').value.trim();
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
  });

  document.getElementById('clearBackendBtn')?.addEventListener('click', () => {
    localStorage.removeItem('BACKEND_URL');
    ctx.showToast('Connection reset to default. Reloading...', 'info');
    setTimeout(() => window.location.reload(), 1200);
  });
}
