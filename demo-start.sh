#!/bin/bash
# AgentTrust demo launcher
# Run this before presenting. Starts orchestrator + public tunnel.
# If cloudflared gives a NEW url, update vercel.json and push.

set -e
cd "$(dirname "$0")"

echo "=== AgentTrust Demo Launcher ==="

# Kill any existing processes
pkill -f "orchestrator/index.js" 2>/dev/null && echo "stopped old orchestrator" || true
pkill -f "cloudflared" 2>/dev/null && echo "stopped old tunnel" || true
sleep 1

# Start orchestrator
echo ""
echo "[1/2] Starting orchestrator..."
node orchestrator/index.js > /tmp/orchestrator.log 2>&1 &
ORCH_PID=$!
sleep 3

# Check it started
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
  echo "  orchestrator running (pid $ORCH_PID)"
else
  echo "  ERROR: orchestrator failed to start. Check /tmp/orchestrator.log"
  exit 1
fi

# Start cloudflare tunnel
echo ""
echo "[2/2] Starting cloudflare tunnel..."
cloudflared tunnel --url http://localhost:3001 > /tmp/cf-tunnel.log 2>&1 &
CF_PID=$!

echo "  waiting for tunnel URL..."
sleep 8

TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/cf-tunnel.log | head -1)

if [ -z "$TUNNEL_URL" ]; then
  echo "  ERROR: could not get tunnel URL. Check /tmp/cf-tunnel.log"
  exit 1
fi

echo ""
echo "========================================"
echo "  TUNNEL URL: $TUNNEL_URL"
echo "========================================"
echo ""

# Check if vercel.json needs updating
CURRENT=$(grep -o '"ORCHESTRATOR_URL": "[^"]*"' vercel.json | grep -o 'https://[^"]*' || echo "")
if [ "$CURRENT" != "$TUNNEL_URL" ]; then
  echo "  Updating vercel.json with new tunnel URL..."
  sed -i "s|\"ORCHESTRATOR_URL\": \"[^\"]*\"|\"ORCHESTRATOR_URL\": \"$TUNNEL_URL\"|" vercel.json
  git add vercel.json
  git commit -m "update tunnel URL for demo"
  git push origin main
  echo "  Pushed! Vercel will rebuild in ~60 seconds."
else
  echo "  vercel.json already has correct URL, no push needed."
fi

echo ""
echo "  Orchestrator log: /tmp/orchestrator.log"
echo "  Tunnel log:       /tmp/cf-tunnel.log"
echo ""
echo "  To stop everything: pkill -f orchestrator/index.js; pkill -f cloudflared"
echo ""
echo "  Visit: https://www.agenttrust.life/live"
