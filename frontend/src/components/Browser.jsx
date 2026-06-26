import React, { useState, useEffect, useRef } from 'react';

export default function Browser({ ctx }) {
  const [task, setTask] = useState('');
  const [engine, setEngine] = useState('');
  const [hidden, setHidden] = useState(false);
  const [running, setRunning] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [status, setStatus] = useState('Running');
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);

  const logPanelRef = useRef(null);

  useEffect(() => {
    if (logPanelRef.current) {
      logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (ctx.socket) {
      const handleStart = (data) => {
        setLogs(prev => [...prev, `▶ Task started: ${data.task}`]);
      };
      const handleDone = () => {
        setLogs(prev => [...prev, '✓ Task completed']);
      };
      const handleError = (data) => {
        setLogs(prev => [...prev, `✗ Error: ${data.error}`]);
      };

      ctx.socket.on('browser:start', handleStart);
      ctx.socket.on('browser:done', handleDone);
      ctx.socket.on('browser:error', handleError);

      return () => {
        ctx.socket.off('browser:start', handleStart);
        ctx.socket.off('browser:done', handleDone);
        ctx.socket.off('browser:error', handleError);
      };
    }
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
      const data = await ctx.API.post('/browser/task', {
        task: trimmedTask,
        engine: engine || undefined,
        hidden
      });

      const passed = data.verdict?.passed;
      setStatus(passed ? 'Success' : 'Failed');
      setResult({
        passed,
        reason: data.verdict?.reason || '',
        runId: data.runId || null
      });
    } catch (err) {
      setLogs(prev => [...prev, `✗ Error: ${err.message}`]);
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
    <div className="animate-slide-up">
      <div className="card" style={{ maxWidth: '700px' }}>
        <div className="card-header">
          <div>
            <div className="card-title">Browser Agent</div>
            <div className="card-subtitle">
              Describe a task in plain English — the AI will execute it in the browser
            </div>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">Task Description</label>
          <textarea
            className="input"
            rows="3"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="e.g., Go to reddit.com/r/programming and list the top 10 posts with upvote counts"
            disabled={running}
          ></textarea>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="input-group">
            <label className="input-label">Browser Engine</label>
            <select
              className="input"
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              disabled={running}
            >
              <option value="">Default</option>
              <option value="playwright">Playwright</option>
              <option value="real-chrome">Real Chrome</option>
              <option value="real-brave">Real Brave</option>
              <option value="real-opera">Real Opera</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Mode</label>
            <select
              className="input"
              value={hidden ? 'true' : 'false'}
              onChange={(e) => setHidden(e.target.value === 'true')}
              disabled={running}
            >
              <option value="false">Visible</option>
              <option value="true">Hidden (headless)</option>
            </select>
          </div>
        </div>

        <button
          className="btn btn-primary btn-lg w-full"
          onClick={handleRunTask}
          disabled={running}
          style={{ width: '100%' }}
        >
          {running ? (
            <>
              <span className="spinner"></span> Running...
            </>
          ) : (
            '▶ Run Task'
          )}
        </button>
      </div>

      {progressVisible && (
        <div style={{ marginTop: '24px' }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title">Task Execution</div>
              <span
                className={`badge ${
                  status === 'Success'
                    ? 'badge-success'
                    : status === 'Failed'
                    ? 'badge-danger'
                    : 'badge-info'
                }`}
              >
                {status}
              </span>
            </div>
            <div className="log-panel" ref={logPanelRef}>
              {logs.map((log, i) => (
                <div key={i} className={getLogClass(log)}>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {result && (
        <div style={{ marginTop: '24px' }}>
          <div className={`verdict-card ${result.passed ? 'passed' : 'failed'}`}>
            <div className="verdict-icon">{result.passed ? '✅' : '❌'}</div>
            <h3>{result.passed ? 'Task Completed' : 'Task Failed'}</h3>
            <p>{result.reason}</p>
            {result.runId && (
              <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                Run: {result.runId}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
