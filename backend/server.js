import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import statusRoutes from './routes/status.js';
import providerRoutes from './routes/providers.js';
import chatRoutes from './routes/chat.js';
import askRoutes from './routes/ask.js';
import applyRoutes from './routes/apply.js';
import browserRoutes from './routes/browser.js';
import councilRoutes from './routes/council.js';
import historyRoutes from './routes/history.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const app = express();
const server = createServer(app);
const io = new SocketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(ROOT, 'frontend')));

// Make io accessible to routes
app.set('io', io);

// ─── API Routes ────────────────────────────────────────────────────────────
app.use('/api', statusRoutes);
app.use('/api', providerRoutes);
app.use('/api', chatRoutes);
app.use('/api', askRoutes);
app.use('/api', applyRoutes);
app.use('/api', browserRoutes);
app.use('/api', councilRoutes);
app.use('/api', historyRoutes);

// ─── SPA fallback ──────────────────────────────────────────────────────────
app.get('*splat', (req, res) => {
  res.sendFile(path.join(ROOT, 'frontend', 'index.html'));
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
server.listen(PORT, () => {
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
