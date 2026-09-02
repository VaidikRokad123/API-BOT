import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import fs from 'fs';


import statusRoutes from './routes/status.js';
import providerRoutes from './routes/providers.js';
import chatRoutes from './routes/chat.js';
import askRoutes from './routes/ask.js';
import applyRoutes from './routes/apply.js';
import browserRoutes from './routes/browser.js';
import councilRoutes from './routes/council.js';
import historyRoutes from './routes/history.js';
import llmApiRoutes from './routes/llm_api.js';
import jobFinderRoutes from './routes/job_finder.js';
import solverRoutes from './routes/solver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

import { hydrateAllSessionsFromEnv } from './src/ai.js';

// Connect to MongoDB (optional for LLM API server)
const mongoUri = process.env.MONGODB_URI;
if (mongoUri) {
  mongoose.connect(mongoUri)
    .then(() => console.log('  ✓ Connected to MongoDB'))
    .catch(err => console.warn('  ⚠️ MongoDB connection warning:', err.message));
} else {
  console.log('  ℹ️ MONGODB_URI not configured; running in API mode.');
}

// Auto-hydrate sessions from environment variables on startup
const restoredCount = hydrateAllSessionsFromEnv();
if (restoredCount > 0) {
  console.log(`  ✓ Auto-hydrated ${restoredCount} provider session(s) from environment.`);
}

const app = express();
const server = createServer(app);
const io = new SocketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

import { createProxyMiddleware } from 'http-proxy-middleware';

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());

// Virtual Port / Reverse Proxy for noVNC & Websockify over the main port
const vncInternalPort = process.env.VNC_INTERNAL_PORT || 6080;
const vncProxy = createProxyMiddleware({
  target: `http://127.0.0.1:${vncInternalPort}`,
  ws: true,
  changeOrigin: true,
  pathRewrite: {
    '^/novnc': '', // rewrite /novnc/vnc.html -> /vnc.html
  },
  on: {
    error: (err, req, res) => {
      if (res && res.writeHead && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Remote browser GUI (noVNC) is starting or not available.');
      }
    },
  },
});

app.use('/novnc', vncProxy);
app.use('/websockify', vncProxy);

// Forward WebSocket upgrades for /websockify and /novnc to the internal noVNC proxy
server.on('upgrade', (req, socket, head) => {
  if (req.url && (req.url.startsWith('/websockify') || req.url.startsWith('/novnc'))) {
    vncProxy.upgrade(req, socket, head);
  }
});

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Serve frontend static files
const frontendDistPath = path.join(ROOT, 'frontend', 'dist');
const frontendSourcePath = path.join(ROOT, 'frontend');
const frontendPath = fs.existsSync(frontendDistPath) ? frontendDistPath : frontendSourcePath;
app.use(express.static(frontendPath));


// Make io accessible to routes
app.set('io', io);

// Health Check Route
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    uptime: process.uptime(),
    timestamp: new Date(),
    database: mongoose.connection.readyState === 1 ? 'CONNECTED' : 'DISCONNECTED'
  });
});

// ─── API Routes ────────────────────────────────────────────────────────────
app.use('/', llmApiRoutes);
app.use('/api', statusRoutes);
app.use('/api', providerRoutes);
app.use('/api', chatRoutes);
app.use('/api', askRoutes);
app.use('/api', applyRoutes);
app.use('/api', browserRoutes);
app.use('/api', councilRoutes);
app.use('/api', historyRoutes);
app.use('/api', jobFinderRoutes);
app.use('/', solverRoutes);

// ─── SPA fallback ──────────────────────────────────────────────────────────
app.get('*splat', (req, res) => {
  const indexFile = fs.existsSync(path.join(frontendDistPath, 'index.html'))
    ? path.join(frontendDistPath, 'index.html')
    : path.join(frontendSourcePath, 'index.html');
  res.sendFile(indexFile);
});

// ─── Socket.IO ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`  ✓ Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`  ✗ Client disconnected: ${socket.id}`);
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║                                                      ║');
  console.log('  ║    AI Agent — Web Server                     v1.0    ║');
  console.log('  ║    Chat · Job Apply · Browser Automation             ║');
  console.log('  ║                                                      ║');
  console.log('  ╚══════════════════════════════════════════════════════╝\n');
  console.log(`  🌐 Server running at http://localhost:${PORT}`);
  console.log(`  📁 Serving frontend from: ${path.join(ROOT, 'frontend')}\n`);
});

export { io };
