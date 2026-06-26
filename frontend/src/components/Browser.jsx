import React, { useState, useEffect, useRef } from 'react';

export default function Browser({ ctx }) {
  const [task, setTask] = useState('');
  const [hidden, setHidden] = useState(false);
  const [running, setRunning] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [status, setStatus] = useState('Running');
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const logPanelRef = useRef(null);

  useEffect(() => {
    if (logPanelRef.current) logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!ctx.socket) return;
    const handleStart = (data) => setLogs(prev => [...prev, `▶ ${data.task}`]);
    const handleDone = () => setLogs(prev => [...prev, '✓ Task completed']);
    const handleError = (data) => setLogs(prev => [...prev, `✗ ${data.error}`]);
    ctx.socket.on('browser:start', handleStart);
    ctx.socket.on('browser:done', handleDone);
    ctx.socket.on('browser:error', handleError);
    return () => {
      ctx.socket.off('browser:start', handleStart);
      ctx.socket.off('browser:done', handleDone);
      ctx.socket.off('browser:error', handleError);
    };
  }, [ctx.socket]);

  const handleRunTask = async () => {
    const trimmedTask = task.trim();
    if (!trimmedTask) return ctx.showToast('Please describe a task', 'warning');
    if (running) return;

    setRunning(true);
    setProgressVisible(true);
    setResult(null);
    setLogs([]);
    setStatus('Running');

    try {
      const data = await ctx.API.post('/browser/task', { task: trimmedTask, hidden });
      const passed = data.verdict?.passed;
      setStatus(passed ? 'Success' : 'Failed');
      setResult({
        passed,
        reason: data.verdict?.reason || '',
        runId: data.runId || null,
        report: data.report || null
      });
    } catch (err) {
      setLogs(prev => [...prev, `✗ ${err.message}`]);
      setStatus('Failed');
      ctx.showToast(err.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const getLogClass = (msg) => {
    if (/✓/.test(msg) || /started/i.test(msg)) return 'log-entry success';
    if (/✗/.test(msg) || /error/i.test(msg)) return 'log-entry error';
    return 'log-entry';
  };

  return (
    <div className="animate-slide-up stack-lg">
      <div className="card form-card">
        <div className="card-header">
          <div>
            <div className="card-title">Run a task</div>
            <div className="card-subtitle">Describe what you want done — the subagent navigates, reads, and acts in a real browser.</div>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label" htmlFor="browser-task">Task</label>
          <textarea
            id="browser-task"
            className="input"
            rows={4}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="e.g. Go to Hacker News and list the top 5 posts with their point counts"
            disabled={running}
          />
        </div>

        <div className="input-group">
          <label className="input-label" htmlFor="browser-mode">Visibility</label>
          <select
            id="browser-mode"
            className="input"
            value={hidden ? 'true' : 'false'}
            onChange={(e) => setHidden(e.target.value === 'true')}
            disabled={running}
          >
            <option value="false">Visible browser</option>
            <option value="true">Hidden (headless)</option>
          </select>
        </div>

        <button type="button" className="btn btn-primary btn-lg w-full" onClick={handleRunTask} disabled={running}>
          {running ? <><span className="spinner" /> Running…</> : 'Run task'}
        </button>
      </div>

      {progressVisible && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Execution log</div>
            <span className={`badge ${status === 'Success' ? 'badge-success' : status === 'Failed' ? 'badge-danger' : 'badge-info'}`}>
              {status}
            </span>
          </div>
          <div className="log-panel" ref={logPanelRef}>
            {logs.length === 0 ? (
              <div className="log-entry info">Agent running…</div>
            ) : (
              logs.map((log, i) => <div key={i} className={getLogClass(log)}>{log}</div>)
            )}
          </div>
        </div>
      )}

      {result && (
        <div className={`verdict-card ${result.passed ? 'passed' : 'failed'}`}>
          <div className="verdict-icon">{result.passed ? '✓' : '✕'}</div>
          <h3>{result.passed ? 'Task completed' : 'Task failed'}</h3>
          <p>{result.reason}</p>
          {result.report && (
            <div className="report-box">
              <h4>Agent report</h4>
              <p>{result.report}</p>
            </div>
          )}
          {result.runId && (
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>Run ID: {result.runId}</p>
          )}
        </div>
      )}
    </div>
  );
}
