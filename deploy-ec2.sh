#!/bin/bash
set -e

echo "========================================================"
echo "  Deploying AI Automation Agent & Local LLM API on AWS  "
echo "========================================================"

# 1. Update system packages
echo "==> [1/5] Updating system packages..."
sudo apt update -y && sudo apt upgrade -y

# 2. Install Docker, Docker Compose, Git and essential utilities
echo "==> [2/5] Installing Docker, Docker Compose, Git..."
sudo apt install -y docker.io docker-compose-v2 git curl ufw

# Add current user to docker group
sudo usermod -aG docker $USER || true

# 3. Create 4GB Swap memory to prevent any OOM issues
echo "==> [3/5] Setting up 4GB Swap memory..."
if [ ! -f /swapfile ]; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo "  ✓ 4GB Swap memory configured."
else
  echo "  ✓ Swap file already exists."
fi

# 4. Open firewall ports (if UFW active)
echo "==> [4/5] Checking firewall ports..."
sudo ufw allow 22/tcp || true
sudo ufw allow 3000/tcp || true
sudo ufw allow 6080/tcp || true

# 5. Build and launch Docker Compose services
echo "==> [5/5] Building and launching Docker container..."
sudo docker compose up -d --build

echo ""
echo "========================================================"
echo "  ✓ Deployment Complete! Services are now live:         "
echo "========================================================"
echo "  • Web App Dashboard : http://localhost:3000"
echo "  • OpenAI LLM API    : http://localhost:3000/v1/chat/completions"
echo "  • Remote noVNC GUI  : http://localhost:6080/vnc.html"
echo "========================================================"
