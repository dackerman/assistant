#!/usr/bin/env bash

# Script to clean up rogue server processes on ports 4000 and 4001
# Usage: ./scripts/cleanup-ports.sh

set -e

echo "🧹 Cleaning up rogue server processes on ports 4000 and 4001..."

# Function to find PIDs listening on a port using multiple methods
find_port_pids() {
    local port=$1
    local pids=""
    
    # Try lsof first (most reliable)
    if command -v lsof &> /dev/null; then
        pids=$(lsof -ti :$port 2>/dev/null || true)
    # Fallback to ss (modern netstat replacement)
    elif command -v ss &> /dev/null; then
        pids=$(ss -tlnp | grep ":$port " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)
    # Fallback to netstat
    elif command -v netstat &> /dev/null; then
        pids=$(netstat -tlnp 2>/dev/null | grep ":$port " | awk '{print $7}' | cut -d/ -f1 | grep -E '^[0-9]+$' | sort -u || true)
    # Last resort: try fuser
    elif command -v fuser &> /dev/null; then
        pids=$(fuser $port/tcp 2>/dev/null | tr -d ' ' || true)
    fi
    
    echo "$pids"
}

# Function to kill processes on a specific port
kill_port() {
    local port=$1
    echo "📍 Checking port $port..."
    
    # Find PIDs listening on the port
    local pids=$(find_port_pids $port)
    
    if [ -z "$pids" ]; then
        echo "✅ No processes found on port $port"
        return
    fi
    
    echo "🔍 Found processes on port $port:"
    # Show process details before killing
    for pid in $pids; do
        if ps -p "$pid" -o pid,ppid,cmd --no-headers 2>/dev/null; then
            :
        else
            echo "  PID $pid (process info unavailable)"
        fi
    done
    
    echo "💀 Killing processes on port $port..."
    for pid in $pids; do
        if kill -TERM "$pid" 2>/dev/null; then
            echo "  ✓ Sent TERM signal to PID $pid"
        else
            echo "  ⚠️  Failed to send TERM signal to PID $pid (may already be dead)"
        fi
    done
    
    # Wait a moment for graceful shutdown
    sleep 2
    
    # Check if any processes are still running and force kill if needed
    local remaining_pids=$(find_port_pids $port)
    if [ -n "$remaining_pids" ]; then
        echo "🔨 Force killing stubborn processes on port $port..."
        for pid in $remaining_pids; do
            if kill -KILL "$pid" 2>/dev/null; then
                echo "  ✓ Force killed PID $pid"
            else
                echo "  ⚠️  Failed to force kill PID $pid"
            fi
        done
    fi
    
    # Final check
    local final_pids=$(find_port_pids $port)
    if [ -z "$final_pids" ]; then
        echo "✅ Port $port is now clear"
    else
        echo "❌ Some processes may still be running on port $port"
        if command -v lsof &> /dev/null; then
            lsof -i :$port 2>/dev/null || true
        elif command -v ss &> /dev/null; then
            ss -tlnp | grep ":$port " || true
        fi
    fi
    echo ""
}

# Check if we have any port detection tools
if ! command -v lsof &> /dev/null && ! command -v ss &> /dev/null && ! command -v netstat &> /dev/null && ! command -v fuser &> /dev/null; then
    echo "❌ No port detection tools found. Please install one of:"
    echo "   lsof: most reliable (Ubuntu/Debian: sudo apt install lsof)"
    echo "   ss: modern alternative (usually pre-installed)"
    echo "   netstat: classic tool (Ubuntu/Debian: sudo apt install net-tools)"
    echo "   fuser: basic alternative (Ubuntu/Debian: sudo apt install psmisc)"
    exit 1
fi

# Kill processes on both ports
kill_port 4000
kill_port 4001

echo "🎉 Port cleanup completed!"

# Show what's still running on common dev ports
echo "📊 Current status of common development ports:"
for port in 3000 4000 4001 5173 8080; do
    processes=$(find_port_pids $port)
    if [ -n "$processes" ]; then
        echo "  Port $port: OCCUPIED (PIDs: $processes)"
    else
        echo "  Port $port: free"
    fi
done