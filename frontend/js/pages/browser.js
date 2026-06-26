export function renderBrowser(container, ctx) {
  container.innerHTML = `
    <div class="animate-slide-up">
      <div class="card" style="max-width:700px">
        <div class="card-header">
          <div><div class="card-title">Browser Agent</div>
          <div class="card-subtitle">Describe a task in plain English — the AI will execute it in the browser</div></div>
        </div>

        <div class="input-group">
          <label class="input-label">Task Description</label>
          <textarea class="input" id="browserTask" rows="3" placeholder="e.g., Go to reddit.com/r/programming and list the top 10 posts with upvote counts"></textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="input-group">
            <label class="input-label">Browser Engine</label>
            <select class="input" id="browserEngine">
              <option value="">Default</option>
              <option value="playwright">Playwright</option>
              <option value="real-chrome">Real Chrome</option>
              <option value="real-brave">Real Brave</option>
              <option value="real-opera">Real Opera</option>
            </select>
          </div>
          <div class="input-group">
            <label class="input-label">Mode</label>
            <select class="input" id="browserHidden">
              <option value="false">Visible</option>
              <option value="true">Hidden (headless)</option>
            </select>
          </div>
        </div>

        <button class="btn btn-primary btn-lg w-full" id="browserRunBtn">
          ▶ Run Task
        </button>
      </div>

      <div id="browserProgress" style="display:none;margin-top:24px">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Task Execution</div>
            <span class="badge badge-info" id="browserStatus">Running</span>
          </div>
          <div class="log-panel" id="browserLog"></div>
        </div>
      </div>

      <div id="browserResult" style="display:none;margin-top:24px"></div>
    </div>
  `;

  let running = false;

  document.getElementById('browserRunBtn').addEventListener('click', async () => {
    const task = document.getElementById('browserTask').value.trim();
    if (!task) return ctx.showToast('Please describe a task', 'warning');
    if (running) return;
    running = true;

    const btn = document.getElementById('browserRunBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Running...';

    document.getElementById('browserProgress').style.display = 'block';
    document.getElementById('browserResult').style.display = 'none';
    document.getElementById('browserLog').innerHTML = '';

    const engine = document.getElementById('browserEngine').value || undefined;
    const hidden = document.getElementById('browserHidden').value === 'true';

    try {
      const data = await ctx.API.post('/browser/task', { task, engine, hidden });
      const passed = data.verdict?.passed;
      document.getElementById('browserStatus').textContent = passed ? 'Passed' : 'Failed';
      document.getElementById('browserStatus').className = `badge ${passed ? 'badge-success' : 'badge-danger'}`;

      document.getElementById('browserResult').style.display = 'block';
      document.getElementById('browserResult').innerHTML = `
        <div class="verdict-card ${passed ? 'passed' : 'failed'}">
          <div class="verdict-icon">${passed ? '✅' : '❌'}</div>
          <h3>${passed ? 'Task Completed' : 'Task Failed'}</h3>
          <p>${data.verdict?.reason || ''}</p>
          ${data.runId ? `<p style="margin-top:8px;font-size:12px;color:var(--text-muted)">Run: ${data.runId}</p>` : ''}
        </div>`;
    } catch (err) {
      ctx.showToast(err.message, 'error');
    }

    running = false;
    btn.disabled = false;
    btn.textContent = '▶ Run Task';
  });

  // Socket events
  if (ctx.socket) {
    ctx.socket.off('browser:start');
    ctx.socket.off('browser:done');
    ctx.socket.off('browser:error');
    ctx.socket.on('browser:start', (d) => addLog(`▶ Task started: ${d.task}`));
    ctx.socket.on('browser:done', () => addLog('✓ Task completed'));
    ctx.socket.on('browser:error', (d) => addLog(`✗ Error: ${d.error}`));
  }

  function addLog(msg) {
    const panel = document.getElementById('browserLog');
    if (!panel) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (/✓/.test(msg)) entry.classList.add('success');
    else if (/✗/.test(msg)) entry.classList.add('error');
    entry.textContent = msg;
    panel.appendChild(entry);
    panel.scrollTop = panel.scrollHeight;
  }
}
