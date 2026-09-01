# Use official Playwright Docker image with pre-installed Chromium & system dependencies
FROM mcr.microsoft.com/playwright:v1.61.1-noble

# Set working directory inside container
WORKDIR /app

# Install Xvfb virtual display, window manager, and optional noVNC for remote browser viewing
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
    procps \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Skip redundant Puppeteer browser downloads during npm install
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Copy package files for dependency installation and caching
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install root, backend, and frontend dependencies
RUN npm run install:all

# Copy remaining source code
COPY . .

# Build the React frontend production bundle
RUN npm run build:frontend

# Create session and data directories
RUN mkdir -p /app/backend/session /app/backend/data /app/backend/subagent_runs

# Make entrypoint script executable
RUN chmod +x /app/docker-entrypoint.sh

# Set environment variables
ENV NODE_ENV=production
ENV IS_DOCKER=true
ENV DISPLAY=:99
ENV HEADLESS=false
ENV PORT=3000
ENV VNC_PORT=6080

# Declare persistent volumes for session cookies and user profiles
VOLUME ["/app/backend/session", "/app/backend/data"]

# Expose backend API/UI port and optional noVNC port
EXPOSE 3000 6080

# Set entrypoint to initialize Xvfb virtual display
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Start server directly
CMD ["node", "backend/server.js"]
