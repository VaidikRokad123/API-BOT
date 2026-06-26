import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

// Page components
import Dashboard from './components/Dashboard';
import Chat from './components/Chat';
import Apply from './components/Apply';
import Browser from './components/Browser';
import History from './components/History';
import Settings from './components/Settings';

export default function App() {
  const [currentPage, setCurrentPage] = useState(() => {
    return window.location.hash.slice(1) || 'dashboard';
  });
  const [provider, setProvider] = useState({ name: 'No Provider', online: false, hasSession: false });
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const socketRef = useRef(null);

  // Connection URL dynamic resolution (localStorage override + Vite Env fallback)
  const BACKEND_URL = localStorage.getItem('BACKEND_URL') || import.meta.env.VITE_BACKEND_URL || '';

  // API Wrapper
  const API = {
    async get(url) {
      const res = await fetch(`${BACKEND_URL}/api${url}`);
      return res.json();
    },
    async post(url, body = {}) {
      const res = await fetch(`${BACKEND_URL}/api${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return res.json();
    }
  };

  const showToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const updateProviderStatus = async () => {
    try {
      const data = await API.get('/status');
      if (data.provider && data.hasSession) {
        setProvider({ name: data.providerLabel, online: true, hasSession: true });
      } else if (data.provider) {
        setProvider({ name: `${data.providerLabel} (no session)`, online: false, hasSession: false });
      } else {
        setProvider({ name: 'No Provider', online: false, hasSession: false });
      }
    } catch {
      setProvider({ name: 'Disconnected', online: false, hasSession: false });
    }
  };

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.slice(1) || 'dashboard';
      setCurrentPage(hash);
    };
    window.addEventListener('hashchange', handleHash);

    // Get initial status
    updateProviderStatus();

    // Socket connection setup
    try {
      const socketUrl = BACKEND_URL || window.location.origin;
      socketRef.current = io(socketUrl, {
        transports: ['websocket', 'polling']
      });
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

  const ctx = {
    API,
    socket: socketRef.current,
    showToast,
    navigateTo,
    updateProviderStatus
  };

  return (
    <>
      {/* Sidebar */}
      <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className="logo-text">AI Agent</span>
          </div>
          <span className="version-badge">v1.0</span>
        </div>

        <div className="nav-section">
          <span className="nav-label">Main</span>
          <a onClick={() => navigateTo('dashboard')} className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            <span>Dashboard</span>
          </a>
          <a onClick={() => navigateTo('chat')} className={`nav-item ${currentPage === 'chat' ? 'active' : ''}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>Chat</span>
          </a>
          <a onClick={() => navigateTo('apply')} className={`nav-item ${currentPage === 'apply' ? 'active' : ''}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>Apply</span>
          </a>
          <a onClick={() => navigateTo('browser')} className={`nav-item ${currentPage === 'browser' ? 'active' : ''}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span>Browser</span>
          </a>
        </div>

        <div className="nav-section">
          <span className="nav-label">Data</span>
          <a onClick={() => navigateTo('history')} className={`nav-item ${currentPage === 'history' ? 'active' : ''}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>History</span>
          </a>
          <a onClick={() => navigateTo('settings')} className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>Settings</span>
          </a>
        </div>

        <div className="sidebar-footer">
          <div className="status-indicator">
            <div className={`status-dot ${connected ? 'online' : 'offline'}`}></div>
            <span>{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setSidebarOpen(prev => !prev)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <h1 className="page-title" style={{ textTransform: 'capitalize' }}>
            {currentPage === 'browser' ? 'Browser Agent' : currentPage}
          </h1>
          <div className="topbar-actions">
            <div className="provider-badge">
              <div className={`status-dot ${provider.online ? 'online' : 'offline'}`}></div>
              <span>{provider.name}</span>
            </div>
          </div>
        </header>

        <div className="content-area">
          {currentPage === 'dashboard' && <Dashboard ctx={ctx} />}
          {currentPage === 'chat' && <Chat ctx={ctx} />}
          {currentPage === 'apply' && <Apply ctx={ctx} />}
          {currentPage === 'browser' && <Browser ctx={ctx} />}
          {currentPage === 'history' && <History ctx={ctx} />}
          {currentPage === 'settings' && <Settings ctx={ctx} />}
        </div>
      </main>

      {/* Toast Overlay */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>
              {t.type === 'success' && '✓'}
              {t.type === 'error' && '✗'}
              {t.type === 'info' && 'ℹ'}
              {t.type === 'warning' && '⚠'}
            </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </>
  );
}
