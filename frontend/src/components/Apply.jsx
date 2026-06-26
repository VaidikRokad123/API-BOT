import React, { useState, useEffect, useRef } from 'react';

export default function Apply({ ctx }) {
  const [url, setUrl] = useState('');
  const [engine, setEngine] = useState('real-chrome');
  const [aiEngine, setAiEngine] = useState('playwright');
  const [doResearch, setDoResearch] = useState(true);
  const [running, setRunning] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('Running');
  const [progressFill, setProgressFill] = useState(0);
  const [result, setResult] = useState(null);

  const logPanelRef = useRef(null);

  useEffect(() => {
    if (logPanelRef.current) {
      logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (ctx.socket && running) {
      const handleLog = (data) => {
        setLogs(prev => [...prev, data.message]);
        setProgressFill(prev => Math.min(95, prev + 2.5));
      };

      const handleDone = () => {
        setLogs(prev => [...prev, '✓ Application process complete']);
      };

      const handleError = (data) => {
        setLogs(prev => [...prev, `✗ Error: ${data.error}`]);
      };

      ctx.socket.on('apply:log', handleLog);
      ctx.socket.on('apply:done', handleDone);
      ctx.socket.on('apply:error', handleError);

      return () => {
        ctx.socket.off('apply:log', handleLog);
        ctx.socket.off('apply:done', handleDone);
        ctx.socket.off('apply:error', handleError);
      };
    }
  }, [ctx.socket, running]);

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
      const data = await ctx.API.post('/apply', { url: trimmedUrl, engine, aiEngine, doResearch });

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
    } finally {
      setRunning(false);
    }
  };

  const showResult = (type, icon, title, desc) => {
    setResult({ type, icon, title, desc });
    setStatus(type === 'passed' ? 'Success' : 'Failed');
    setProgressFill(100);
  };

  const getLogClass = (msg) => {
    if (/✓|success|saved|ready/i.test(msg)) return 'log-entry success';
    if (/✗|error|fail/i.test(msg)) return 'log-entry error';
    if (/⚠|warn|pause|captcha/i.test(msg)) return 'log-entry warning';
    return 'log-entry';
  };

  return (
    <div className="animate-slide-up">
      <div className="card" style={{ maxWidth: '700px' }}>
        <div className="card-header">
          <div>
            <div className="card-title">Job Application</div>
            <div className="card-subtitle">AI will research the company and auto-fill the application form</div>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">Job URL</label>
          <input
            type="url"
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://company.com/jobs/apply/123"
            disabled={running}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="input-group">
            <label className="input-label">Browser Engine (Hands)</label>
            <select
              className="input"
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              disabled={running}
            >
              <option value="real-chrome">Real Chrome (CDP)</option>
              <option value="real-brave">Real Brave (CDP)</option>
              <option value="real-opera">Real Opera (CDP)</option>
              <option value="playwright">Playwright</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">AI Engine (Brain)</label>
            <select
              className="input"
              value={aiEngine}
              onChange={(e) => setAiEngine(e.target.value)}
              disabled={running}
            >
              <option value="playwright">Playwright</option>
            </select>
          </div>
        </div>

        <div className="input-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={doResearch}
              onChange={(e) => setDoResearch(e.target.checked)}
              disabled={running}
            />{' '}
            Conduct company/job research before filling
          </label>
        </div>

        <button
          className="btn btn-primary btn-lg w-full"
          onClick={handleStart}
          disabled={running}
          style={{ marginTop: '8px', width: '100%' }}
        >
          {running ? <><span className="spinner"></span> Applying...</> : '🚀 Start Application'}
        </button>
      </div>

      {progressVisible && (
        <div style={{ marginTop: '24px' }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title">Application Progress</div>
              <span className={`badge ${status === 'Success' ? 'badge-success' : status === 'Failed' ? 'badge-danger' : 'badge-info'}`}>
                {status}
              </span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressFill}%` }}></div>
            </div>
            <div className="log-panel" ref={logPanelRef}>
              {logs.map((log, index) => (
                <div key={index} className={getLogClass(log)}>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {result && (
        <div style={{ marginTop: '24px' }}>
          <div className={`verdict-card ${result.type === 'passed' ? 'passed' : 'failed'}`}>
            <div className="verdict-icon">{result.icon}</div>
            <h3>{result.title}</h3>
            <p>{result.desc}</p>
          </div>
        </div>
      )}
    </div>
  );
}
