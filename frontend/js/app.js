// ═══════════════════════════════════════════════════════════════════════════
// AI Agent — Main Application
// SPA router, API client, Socket.IO connection, page management
// ═══════════════════════════════════════════════════════════════════════════

import { renderDashboard } from './pages/dashboard.js';
import { renderChat } from './pages/chat.js';
import { renderApply } from './pages/apply.js';
import { renderBrowser } from './pages/browser.js';
import { renderHistory } from './pages/history.js';
import { renderSettings } from './pages/settings.js';

// ─── API Client ────────────────────────────────────────────────────────────
let BACKEND_URL = localStorage.getItem('BACKEND_URL') || '';

if (!BACKEND_URL) {
  try {
    const envRes = await fetch('/env.json');
    if (envRes.ok) {
      const envData = await envRes.json();
      if (envData.BACKEND_URL) {
        BACKEND_URL = envData.BACKEND_URL;
      }
    }
  } catch {
    // env.json not present or failed to load
  }
}

if (!BACKEND_URL) {
  BACKEND_URL = window.location.port && window.location.port !== '3000' ? 'http://localhost:3000' : '';
}

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

// ─── Socket.IO ─────────────────────────────────────────────────────────────
let socket = null;
try {
  socket = io(BACKEND_URL || undefined);
  socket.on('connect', () => {
    updateConnectionStatus(true);
  });
  socket.on('disconnect', () => {
    updateConnectionStatus(false);
  });
} catch {
  console.warn('Socket.IO not available');
}

function updateConnectionStatus(connected) {
  const el = document.getElementById('connectionStatus');
  if (!el) return;
  const dot = el.querySelector('.status-dot');
  const text = el.querySelector('span');
  if (connected) {
    dot.className = 'status-dot online';
    text.textContent = 'Connected';
  } else {
    dot.className = 'status-dot offline';
    text.textContent = 'Disconnected';
  }
}

// ─── Toast Notifications ───────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ─── Provider Status ───────────────────────────────────────────────────────
async function updateProviderStatus() {
  try {
    const data = await API.get('/status');
    const dot = document.getElementById('providerDot');
    const name = document.getElementById('providerName');
    if (data.provider && data.hasSession) {
      dot.className = 'status-dot online';
      name.textContent = data.providerLabel;
    } else if (data.provider) {
      dot.className = 'status-dot warning';
      name.textContent = `${data.providerLabel} (no session)`;
    } else {
      dot.className = 'status-dot offline';
      name.textContent = 'No Provider';
    }
    return data;
  } catch {
    return null;
  }
}

// ─── Page Router ───────────────────────────────────────────────────────────
const pages = {
  dashboard: { title: 'Dashboard', render: renderDashboard },
  chat: { title: 'Chat', render: renderChat },
  apply: { title: 'Apply', render: renderApply },
  browser: { title: 'Browser Agent', render: renderBrowser },
  history: { title: 'History', render: renderHistory },
  settings: { title: 'Settings', render: renderSettings }
};

let currentPage = null;

function navigateTo(page) {
  if (!pages[page]) page = 'dashboard';
  currentPage = page;

  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Update title
  document.getElementById('pageTitle').textContent = pages[page].title;
  document.title = `AI Agent — ${pages[page].title}`;

  // Render page
  const content = document.getElementById('contentArea');
  content.innerHTML = '';
  pages[page].render(content, { API, socket, showToast, navigateTo, updateProviderStatus });
}

// ─── Navigation Event Listeners ────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const page = item.dataset.page;
    window.location.hash = page;
    navigateTo(page);
    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
  });
});

// Mobile menu toggle
document.getElementById('menuToggle')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// Hash-based routing
function handleHashChange() {
  const page = window.location.hash.slice(1) || 'dashboard';
  navigateTo(page);
}

window.addEventListener('hashchange', handleHashChange);

// ─── Init ──────────────────────────────────────────────────────────────────
updateProviderStatus();
handleHashChange();
