import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

import Dashboard from './components/Dashboard';
import Chat from './components/Chat';
import Apply from './components/Apply';
import JobFinder from './components/JobFinder';
import ApiDashboard from './components/ApiDashboard';
import Browser from './components/Browser';
import History from './components/History';
import Settings from './components/Settings';

const NAV = [
  {
    section: 'Workspace',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
      { id: 'jobs', label: 'Job Finder', icon: 'search' },
      { id: 'chat', label: 'Chat', icon: 'chat' },
      { id: 'apply', label: 'Apply Form', icon: 'apply' },
      { id: 'browser', label: 'Browser Agent', icon: 'globe' }
    ]
  },
  {
    section: 'Developer & System',
    items: [
      { id: 'api', label: 'Local LLM API', icon: 'code' },
      { id: 'history', label: 'History', icon: 'clock' },
      { id: 'settings', label: 'Settings', icon: 'settings' }
    ]
  }
];

const PAGE_META = {
  dashboard: { title: 'Dashboard', subtitle: 'Overview of your automation runs and quick actions' },
  jobs: { title: 'Job Finder', subtitle: 'Search web jobs using Firecrawl & match with your resume' },
  chat: { title: 'Chat', subtitle: 'Multi-turn conversation with your active AI provider' },
  apply: { title: 'Job Apply', subtitle: 'AI researches the role and fills application forms' },
  browser: { title: 'Browser Agent', subtitle: 'Natural-language tasks executed in a real browser' },
  api: { title: 'Local LLM API', subtitle: 'OpenAI-compatible endpoints & developer playground' },
  history: { title: 'History', subtitle: 'Application outcomes and failure analytics' },
  settings: { title: 'Settings', subtitle: 'Providers, engines, sessions, and connection' }
};

function NavIcon({ name }) {
  const props = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'grid':
      return <svg {...props}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case 'search':
      return <svg {...props}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M11 8a3 3 0 0 0-3 3"/></svg>;
    case 'code':
      return <svg {...props}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
    case 'chat':
      return <svg {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
    case 'apply':
      return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
    case 'globe':
      return <svg {...props}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
    case 'clock':
      return <svg {...props}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case 'settings':
      return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
    default:
      return null;
  }
}

const TOAST_ICON = { success: '✓', error: '✕', info: 'i', warning: '!' };

export default function App() {
  const [currentPage, setCurrentPage] = useState(() => window.location.hash.slice(1) || 'dashboard');
  const [provider, setProvider] = useState({ name: 'No Provider', online: false, hasSession: false });
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const socketRef = useRef(null);

  const BACKEND_URL = localStorage.getItem('BACKEND_URL') || import.meta.env.VITE_BACKEND_URL || '';

  const API = {
    backendUrl: BACKEND_URL,
    async get(url) {
      const res = await fetch(`${BACKEND_URL}/api${url}`, {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      const data = await res.json().catch(() => ({ error: 'Invalid server response' }));
      if (!res.ok && data.error) {
        const msg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : data.error;
        throw new Error(msg);
      }
      return data;
    },
    async post(url, body = {}) {
      const res = await fetch(`${BACKEND_URL}/api${url}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({ error: 'Invalid server response' }));
      if (!res.ok && data.error) {
        const msg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : data.error;
        throw new Error(msg);
      }
      return data;
    },
    async rawGet(endpoint) {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      return res.json().catch(() => ({ error: 'Invalid server response' }));
    },
    async rawPost(endpoint, body = {}, customHeaders = {}) {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: customHeaders.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...customHeaders
        },
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
      });
      return res.json().catch(() => ({ error: 'Invalid server response' }));
    }
  };

  const showToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    let text = message;
    if (typeof text === 'object' && text !== null) {
      text = text.message || text.error || JSON.stringify(text);
    }
    setToasts(prev => [...prev, { id, message: String(text || 'Unknown error'), type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  const updateProviderStatus = async () => {
    try {
      const data = await API.get('/status');
      if (data.provider && data.hasSession) {
        setProvider({ name: data.providerLabel, online: true, hasSession: true });
      } else if (data.provider) {
        setProvider({ name: `${data.providerLabel} · no session`, online: false, hasSession: false });
      } else {
        setProvider({ name: 'No Provider', online: false, hasSession: false });
      }
    } catch {
      setProvider({ name: 'Disconnected', online: false, hasSession: false });
    }
  };

  useEffect(() => {
    const handleHash = () => setCurrentPage(window.location.hash.slice(1) || 'dashboard');
    window.addEventListener('hashchange', handleHash);
    updateProviderStatus();

    try {
      const socketUrl = BACKEND_URL || window.location.origin;
      socketRef.current = io(socketUrl, { transports: ['websocket', 'polling'] });
      socketRef.current.on('connect', () => setConnected(true));
      socketRef.current.on('disconnect', () => setConnected(false));
    } catch (e) {
      console.warn('Socket connection error:', e);
    }

    return () => {
      window.removeEventListener('hashchange', handleHash);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const navigateTo = (page) => {
    window.location.hash = page;
    setCurrentPage(page);
    setSidebarOpen(false);
  };

  const meta = PAGE_META[currentPage] || PAGE_META.dashboard;
  const ctx = { API, socket: socketRef.current, showToast, navigateTo, updateProviderStatus };

  return (
    <div className="app-shell">
      <div className="app-backdrop" aria-hidden="true" />

      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                <circle cx="12" cy="12" r="4"/>
              </svg>
            </div>
            <div className="logo-text-wrap">
              <span className="logo-text">Autopilot</span>
              <span className="logo-tagline">AI automation suite</span>
            </div>
          </div>
        </div>

        {NAV.map(group => (
          <div key={group.section} className="nav-section">
            <span className="nav-label">{group.section}</span>
            {group.items.map(item => (
              <a
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => navigateTo(item.id)}
                onKeyDown={(e) => e.key === 'Enter' && navigateTo(item.id)}
                className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
              >
                <NavIcon name={item.icon} />
                <span>{item.label}</span>
              </a>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          <div className="status-indicator">
            <div className={`status-dot ${connected ? 'online' : 'offline'}`} />
            <span>{connected ? 'Backend connected' : 'Backend offline'}</span>
          </div>
        </div>
      </nav>

      <main className="main-content">
        <header className="topbar">
          <button
            type="button"
            className="menu-toggle"
            onClick={() => setSidebarOpen(prev => !prev)}
            aria-label="Toggle menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>

          <div className="topbar-title-group">
            <h1 className="page-title">{meta.title}</h1>
            <p className="page-subtitle">{meta.subtitle}</p>
          </div>

          <div className="topbar-actions">
            <div className="provider-badge">
              <div className={`status-dot ${provider.online ? 'online' : 'offline'}`} />
              <span>{provider.name}</span>
            </div>
          </div>
        </header>

        <div className="content-area">
          {currentPage === 'dashboard' && <Dashboard ctx={ctx} />}
          {currentPage === 'jobs' && <JobFinder ctx={ctx} />}
          {currentPage === 'chat' && <Chat ctx={ctx} />}
          {currentPage === 'apply' && <Apply ctx={ctx} />}
          {currentPage === 'browser' && <Browser ctx={ctx} />}
          {currentPage === 'api' && <ApiDashboard ctx={ctx} />}
          {currentPage === 'history' && <History ctx={ctx} />}
          {currentPage === 'settings' && <Settings ctx={ctx} />}
        </div>
      </main>

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span className="toast-icon">{TOAST_ICON[t.type] || 'i'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
