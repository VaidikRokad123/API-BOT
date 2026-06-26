export function renderApply(container, ctx) {
  container.innerHTML = `
    <div class="animate-slide-up">
      <div class="card" style="max-width:700px">
        <div class="card-header">
          <div><div class="card-title">Job Application</div>
          <div class="card-subtitle">AI will research the company and auto-fill the application form</div></div>
        </div>

        <div class="input-group">
          <label class="input-label">Job URL</label>
          <input type="url" class="input" id="applyUrl" placeholder="https://company.com/jobs/apply/123">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="input-group">
            <label class="input-label">Browser Engine (Hands)</label>
            <select class="input" id="applyEngine">
              <option value="real-chrome">Real Chrome (CDP)</option>
              <option value="real-brave">Real Brave (CDP)</option>
              <option value="real-opera">Real Opera (CDP)</option>
              <option value="playwright">Playwright</option>
            </select>
          </div>
          <div class="input-group">
            <label class="input-label">AI Engine (Brain)</label>
            <select class="input" id="applyAiEngine">
              <option value="playwright">Playwright</option>
            </select>
          </div>
        </div>

        <div class="input-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;color:var(--text-secondary)">
            <input type="checkbox" id="applyResearch" checked> Conduct company/job research before filling
          </label>
        </div>

        <button class="btn btn-primary btn-lg w-full" id="applyBtn" style="margin-top:8px">
          🚀 Start Application
        </button>
      </div>

      <div id="applyProgress" style="display:none;margin-top:24px">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Application Progress</div>
            <span class="badge badge-info" id="applyStatus">Running</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" id="applyProgressFill" style="width:0%"></div></div>
          <div class="log-panel" id="applyLog"></div>
        </div>
      </div>

      <div id="applyResult" style="display:none;margin-top:24px"></div>
    </div>
  `;

  let running = false;
  let logCount = 0;

  document.getElementById('applyBtn').addEventListener('click', async () => {
    const url = document.getElementById('applyUrl').value.trim();
    if (!url) return ctx.showToast('Please enter a job URL', 'warning');
    if (running) return;
    running = true;

    const btn = document.getElementById('applyBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Applying...';

    document.getElementById('applyProgress').style.display = 'block';
    document.getElementById('applyResult').style.display = 'none';
    document.getElementById('applyLog').innerHTML = '';
    logCount = 0;

    const engine = document.getElementById('applyEngine').value;
    const aiEngine = document.getElementById('applyAiEngine').value;
    const doResearch = document.getElementById('applyResearch').checked;

    try {
      const data = await ctx.API.post('/apply', { url, engine, aiEngine, doResearch });

      if (data.skipped) {
        showResult('info', '⏭️', 'Already Applied', 'This job was already successfully applied to.');
      } else if (data.verdict?.passed) {
        showResult('passed', '✅', 'Application Submitted!', data.verdict.reason || 'Successfully completed.');
      } else {
        showResult('failed', '❌', 'Application Failed', `${data.verdict?.failure_reason || 'Unknown'}: ${data.verdict?.reason || ''}`);
      }
    } catch (err) {
      showResult('failed', '❌', 'Error', err.message);
      ctx.showToast(err.message, 'error');
    }

    running = false;
    btn.disabled = false;
    btn.textContent = '🚀 Start Application';
  });

  function showResult(type, icon, title, desc) {
    const cls = type === 'passed' ? 'passed' : 'failed';
    document.getElementById('applyResult').style.display = 'block';
    document.getElementById('applyResult').innerHTML = `
      <div class="verdict-card ${cls}">
        <div class="verdict-icon">${icon}</div>
        <h3>${title}</h3>
        <p>${desc}</p>
      </div>`;
    document.getElementById('applyStatus').textContent = type === 'passed' ? 'Success' : 'Failed';
    document.getElementById('applyStatus').className = `badge ${type === 'passed' ? 'badge-success' : 'badge-danger'}`;
    document.getElementById('applyProgressFill').style.width = '100%';
  }

  function addLog(msg) {
    logCount++;
    const panel = document.getElementById('applyLog');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (/✓|success|saved|ready/i.test(msg)) entry.classList.add('success');
    else if (/✗|error|fail/i.test(msg)) entry.classList.add('error');
    else if (/⚠|warn|pause|captcha/i.test(msg)) entry.classList.add('warning');
    entry.textContent = msg;
    panel.appendChild(entry);
    panel.scrollTop = panel.scrollHeight;
    // Simulate progress
    const pct = Math.min(95, logCount * 5);
    document.getElementById('applyProgressFill').style.width = `${pct}%`;
  }

  // Socket.IO events
  if (ctx.socket) {
    ctx.socket.off('apply:log');
    ctx.socket.off('apply:done');
    ctx.socket.off('apply:error');
    ctx.socket.on('apply:log', (d) => addLog(d.message));
    ctx.socket.on('apply:done', () => addLog('✓ Application process complete'));
    ctx.socket.on('apply:error', (d) => addLog(`✗ Error: ${d.error}`));
  }
}
