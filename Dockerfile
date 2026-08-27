# Use official Playwright Docker image with pre-installed browsers & dependencies
FROM mcr.microsoft.com/playwright:v1.50.0-noble

# Set working directory inside container
WORKDIR /app

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

# Build the React frontend
RUN npm run build:frontend

# Create session and data directories
RUN mkdir -p backend/session backend/data

# Set default environment variables
ENV NODE_ENV=production
ENV HEADLESS=true
ENV PORT=3000

# Expose backend port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
