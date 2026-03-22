#!/bin/bash

# Configuration
REMOTE_DIR="~/kanban-code-20260318-2339"
BACKEND_PORT=5172
FRONTEND_PORT=5173

# Prompt for SSH command if not provided as argument
if [ -z "$1" ]; then
    echo "Enter your SSH command (e.g., ssh ubuntu@172.30.25.100 -i ~/Documents/ssh-key-2025-04-05.key):"
    read -r SSH_FULL_CMD
else
    SSH_FULL_CMD="$@"
fi

# Extract SSH details (supports -i key and user@host)
SSH_KEY=$(echo "$SSH_FULL_CMD" | grep -oE "\-i\s+\S+" | awk '{print $2}')
REMOTE_HOST=$(echo "$SSH_FULL_CMD" | grep -oE "[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+")

if [ -z "$REMOTE_HOST" ]; then
    echo "Error: Could not extract remote host (user@ip) from the command provided."
    exit 1
fi

SSH_OPTS=""
if [ ! -z "$SSH_KEY" ]; then
    # Resolve home tilde if present in key path
    SSH_KEY_RESOLVED="${SSH_KEY/#\~/$HOME}"
    SSH_OPTS="-i $SSH_KEY_RESOLVED"
fi

echo "🚀 Starting deployment to $REMOTE_HOST..."

# 1. Sync files via rsync
echo "📦 Step 1: Syncing files..."
rsync -avz --progress -e "ssh $SSH_OPTS" \
    --exclude "node_modules" \
    --exclude ".git" \
    --exclude ".next" \
    --exclude "dist" \
    --exclude ".DS_Store" \
    . "$REMOTE_HOST:$REMOTE_DIR"

# 2. Remote Build and PM2 Setup
echo "🏗️  Step 2: Building and restarting PM2 on remote..."
ssh $SSH_OPTS "$REMOTE_HOST" << EOF
    # Navigate to project
    cd $REMOTE_DIR/web

    # Ensure PM2 is installed globally
    command -v pm2 >/dev/null 2>&1 || { echo "Installing PM2..."; sudo npm install -g pm2; }

    # Kill processes on target ports to avoid EADDRINUSE
    echo "Cleaning up ports $BACKEND_PORT, $FRONTEND_PORT, and 3000..."
    sudo fuser -k $BACKEND_PORT/tcp 2>/dev/null || true
    sudo fuser -k $FRONTEND_PORT/tcp 2>/dev/null || true
    sudo fuser -k 3000/tcp 2>/dev/null || true

    # Install and Build
    echo "Installing dependencies and building packages..."
    cd shared && npm install && npm run build
    cd ../server && npm install && npm run build
    cd ../client && npm install --legacy-peer-deps && npm run build

    # PM2 Restart
    echo "Updating PM2 processes..."
    pm2 delete kanban-backend kanban-frontend 2>/dev/null || true
    
    # Start Backend
    cd ../server
    PORT=$BACKEND_PORT HOST=0.0.0.0 pm2 start "npx tsx src/index.ts" --name kanban-backend
    
    # Start Frontend
    cd ../client
    KANBAN_SERVER_PORT=$BACKEND_PORT pm2 start "npx vite preview --port $FRONTEND_PORT --host 0.0.0.0" --name kanban-frontend
    
    pm2 save
    pm2 status
EOF

IP_ONLY=$(echo "$REMOTE_HOST" | cut -d'@' -f2)
echo "✅ Deployment Complete!"
echo "Frontend: http://$IP_ONLY:$FRONTEND_PORT"
echo "Backend:  http://$IP_ONLY:$BACKEND_PORT"
