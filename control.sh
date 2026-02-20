#!/bin/bash

# ShieldNet Control Script
# Easy commands to start/stop agents

case "$1" in
  start)
    echo "🚀 Starting ShieldNet..."
    echo ""
    
    # Check if already running
    if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "⚠️  Orchestrator already running on port 3001"
    else
      echo "📡 Starting orchestrator..."
      npm run orchestrator > orchestrator.log 2>&1 &
      ORCH_PID=$!
      sleep 2
      if ps -p $ORCH_PID > /dev/null; then
        echo "✓ Orchestrator started (PID: $ORCH_PID)"
      else
        echo "✗ Failed to start orchestrator"
      fi
    fi
    
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "⚠️  Frontend already running on port 3000"
    else
      echo "🌐 Starting frontend..."
      cd app && npm run dev > ../frontend.log 2>&1 &
      cd ..
      sleep 2
      echo "✓ Frontend started"
    fi
    
    echo ""
    echo "========================================="
    echo "✅ ShieldNet is running!"
    echo "========================================="
    echo ""
    echo "📊 Dashboard:  http://localhost:3000/dashboard"
    echo "⚡ Live Feed:  http://localhost:3000/live"
    echo "🔑 Password:   ethdenver2026"
    echo ""
    echo "To stop: ./control.sh stop"
    ;;
    
  stop)
    echo "🛑 Stopping ShieldNet..."
    echo ""
    
    # Stop orchestrator
    if lsof -ti:3001 >/dev/null 2>&1; then
      echo "Stopping orchestrator..."
      lsof -ti:3001 | xargs kill -9 2>/dev/null
      echo "✓ Orchestrator stopped"
    else
      echo "○ Orchestrator not running"
    fi
    
    # Stop frontend
    if lsof -ti:3000 >/dev/null 2>&1; then
      echo "Stopping frontend..."
      lsof -ti:3000 | xargs kill -9 2>/dev/null
      echo "✓ Frontend stopped"
    else
      echo "○ Frontend not running"
    fi
    
    echo ""
    echo "✅ ShieldNet stopped"
    ;;
    
  restart)
    echo "🔄 Restarting ShieldNet..."
    $0 stop
    sleep 2
    $0 start
    ;;
    
  status)
    echo "📊 ShieldNet Status"
    echo "===================="
    echo ""
    
    if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then
      ORCH_PID=$(lsof -ti:3001)
      echo "✓ Orchestrator: RUNNING (PID: $ORCH_PID)"
    else
      echo "✗ Orchestrator: STOPPED"
    fi
    
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
      FRONT_PID=$(lsof -ti:3000)
      echo "✓ Frontend:     RUNNING (PID: $FRONT_PID)"
    else
      echo "✗ Frontend:     STOPPED"
    fi
    
    echo ""
    if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1 && lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "🌐 Live at: http://localhost:3000/live"
    fi
    ;;
    
  logs)
    echo "📋 ShieldNet Logs"
    echo "===================="
    echo ""
    echo "Orchestrator logs (last 30 lines):"
    echo "-----------------------------------"
    tail -30 orchestrator.log
    echo ""
    echo ""
    echo "To follow live: tail -f orchestrator.log"
    ;;
    
  *)
    echo "ShieldNet Control"
    echo "================="
    echo ""
    echo "Usage: ./control.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start     Start orchestrator + frontend"
    echo "  stop      Stop everything"
    echo "  restart   Restart everything"
    echo "  status    Check what's running"
    echo "  logs      View orchestrator logs"
    echo ""
    echo "Examples:"
    echo "  ./control.sh start    # Start agents"
    echo "  ./control.sh stop     # Stop agents"
    echo "  ./control.sh status   # Check status"
    echo "  ./control.sh logs     # View logs"
    ;;
esac
