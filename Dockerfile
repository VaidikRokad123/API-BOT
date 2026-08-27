# Use official Playwright Docker image with pre-installed browsers (Ubuntu + Node.js + Chromium/Firefox)
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# Set working directory inside container
WORKDIR /app

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

# Environment variable defaults
ENV NODE_ENV=production
ENV HEADLESS=true
ENV PORT=3000

# Expose backend port
EXPOSE 3000

# Start Express server
CMD ["npm", "start"]
