#!/bin/bash
set -e

export DISPLAY=${DISPLAY:-:99}
export SCREEN_WIDTH=${SCREEN_WIDTH:-1280}
export SCREEN_HEIGHT=${SCREEN_HEIGHT:-900}
export SCREEN_DEPTH=${SCREEN_DEPTH:-24}

echo "========================================================"
echo "  AI Automation Agent — Docker Container Initializing   "
echo "========================================================"

# 1. Start Xvfb Virtual Framebuffer Display
echo "==> Starting Xvfb on display ${DISPLAY} (${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH})..."
Xvfb ${DISPLAY} -screen 0 ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH} -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Wait for Xvfb socket to appear
for i in $(seq 1 15); do
  if [ -e /tmp/.X11-unix/X${DISPLAY#:} ]; then
    echo "  ✓ Xvfb virtual display ready."
    break
  fi
  sleep 0.2
done

# 2. Start lightweight window manager (fluxbox) if available
if command -v fluxbox >/dev/null 2>&1; then
  fluxbox >/dev/null 2>&1 &
fi

# 3. Start noVNC Web Remote GUI if ENABLE_VNC is set
if [ "${ENABLE_VNC}" = "true" ] || [ "${ENABLE_VNC}" = "1" ]; then
  VNC_PORT=${VNC_PORT:-6080}
  echo "==> Starting x11vnc and noVNC on port ${VNC_PORT}..."
  x11vnc -display ${DISPLAY} -forever -shared -nopw -rfbport 5900 -quiet &
  sleep 1
  if [ -d "/usr/share/novnc" ]; then
    websockify --web /usr/share/novnc ${VNC_PORT} localhost:5900 >/dev/null 2>&1 &
    echo "  ✓ noVNC web viewer active: http://0.0.0.0:${VNC_PORT}/vnc.html"
  elif command -v novnc >/dev/null 2>&1; then
    novnc --listen ${VNC_PORT} --vnc localhost:5900 >/dev/null 2>&1 &
    echo "  ✓ noVNC active: http://0.0.0.0:${VNC_PORT}/vnc.html"
  fi
fi

# 4. Ensure runtime persistence directories exist
mkdir -p /app/backend/session /app/backend/data /app/backend/subagent_runs

# 5. Execute main process
echo "==> Launching server..."
exec "$@"
