import React, { useState, useEffect, useRef } from 'react';

export default function Apply({ ctx }) {
  const [url, setUrl] = useState('');
  const [doResearch, setDoResearch] = useState(true);
  const [running, setRunning] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('Running');
  const [progressFill, setProgressFill] = useState(0);
  const [result, setResult] = useState(null);
  const logPanelRef = useRef(null);

  useEffect(() => {
    if (logPanelRef.current) logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!ctx.socket || !running) return;
    const handleLog = (data) => {
      setLogs(prev => [...prev, data.message]);
      setProgressFill(prev => Math.min(95, prev + 2.5));
    };
    const handleDone = () => setLogs(prev => [...prev, '✓ Application process complete']);
    const handleError = (data) => setLogs(prev => [...prev, `✗ Error: ${data.error}`]);
    ctx.socket.on('apply:log', handleLog);
    ctx.socket.on('apply:done', handleDone);
    ctx.socket.on('apply:error', handleError);
    return () => {
      ctx.socket.off('apply:log', handleLog);
      ctx.socket.off('apply:done', handleDone);
      ctx.socket.off('apply:error', handleError);
    };
  }, [ctx.socket, running]);

  const showResult = (type, icon, title, desc) => {
    setResult({ type, icon, title, desc });
    setStatus(type === 'passed' ? 'Success' : 'Failed');
    setProgressFill(100);
  };

  const handleStart = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return ctx.showToast('Please enter a job URL', 'warning');
    if (running) return;

    setRunning(true);
    setProgressVisible(true);
    setResult(null);
    setLogs([]);
    setProgressFill(0);
    setStatus('Running');

    try {
      const data = await ctx.API.post('/apply', { url: trimmedUrl, doResearch });
      if (data.skipped) {
        showResult('info', '⏭', 'Already Applied', 'This job was previously submitted successfully.');
      } else if (data.verdict?.passed) {
        showResult('passed', '✓', 'Application Submitted', data.verdict.reason || 'Successfully completed.');
      } else {
        showResult('failed', '✕', 'Application Failed', `${data.verdict?.failure_reason || 'Unknown'}: ${data.verdict?.reason || ''}`);
      }
    } catch (err) {
      showResult('failed', '✕', 'Error', err.message);
      ctx.showToast(err.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const getLogClass = (msg) => {
    if (/✓|success|saved|ready/i.test(msg)) return 'log-entry success';
    if (/✗|error|fail/i.test(msg)) return 'log-entry error';
    if (/⚠|warn|pause|captcha/i.test(msg)) return 'log-entry warning';
    return 'log-entry';
  };

  return (
    <div className="animate-slide-up stack-lg">
      <div className="card form-card">
        <div className="card-header">
          <div>
            <div className="card-title">New Application</div>
            <div className="card-subtitle">The agent researches the company, fills required fields, and submits the form.</div>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label" htmlFor="job-url">Job URL</label>
          <input
            id="job-url"
            type="url"
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://company.com/careers/apply/123"
            disabled={running}
          />
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={doResearch} onChange={(e) => setDoResearch(e.target.checked)} disabled={running} />
          Research company and role before filling
        </label>

        <button type="button" className="btn btn-primary btn-lg w-full" onClick={handleStart} disabled={running} style={{ marginTop: 16 }}>
          {running ? <><span className="spinner" /> Applying…</> : 'Start application'}
        </button>
      </div>

      {progressVisible && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Live progress</div>
            <span className={`badge ${status === 'Success' ? 'badge-success' : status === 'Failed' ? 'badge-danger' : 'badge-info'}`}>
              {status}
            </span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressFill}%` }} />
          </div>
          <div className="log-panel" ref={logPanelRef}>
            {logs.length === 0 ? (
              <div className="log-entry info">Waiting for agent output…</div>
            ) : (
              logs.map((log, i) => <div key={i} className={getLogClass(log)}>{log}</div>)
            )}
          </div>
        </div>
      )}

      {result && (
        <div className={`verdict-card ${result.type === 'passed' ? 'passed' : 'failed'}`}>
          <div className="verdict-icon">{result.icon}</div>
          <h3>{result.title}</h3>
          <p>{result.desc}</p>
        </div>
      )}
    </div>
  );
}
