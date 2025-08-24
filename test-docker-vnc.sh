#!/usr/bin/env bash

# Script to run Playwright tests with live browser viewing via noVNC
# Watch the tests run in real-time at http://localhost:6080
#
# Usage: ./test-docker-vnc.sh [playwright args]
# Examples:
#   ./test-docker-vnc.sh                           # Run all tests
#   ./test-docker-vnc.sh tests/e2e/debug.spec.ts   # Watch specific test

echo "🎭 Running Playwright tests with live VNC viewer..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if OpenCode is running on port 4096
OPENCODE_PID=""
if ! curl -s http://127.0.0.1:4096/health > /dev/null 2>&1; then
    echo "📦 Starting OpenCode test server on port 4096..."
    
    # Start OpenCode in background
    (cd "$(dirname "$0")" && pnpm run test:opencode > /dev/null 2>&1) &
    OPENCODE_PID=$!
    
    # Wait for OpenCode to be ready (max 30 seconds)
    COUNTER=0
    while ! curl -s http://127.0.0.1:4096/health > /dev/null 2>&1; do
        sleep 1
        COUNTER=$((COUNTER + 1))
        if [ $COUNTER -gt 30 ]; then
            echo "❌ OpenCode failed to start within 30 seconds"
            [ ! -z "$OPENCODE_PID" ] && kill $OPENCODE_PID 2>/dev/null
            exit 1
        fi
        echo -n "."
    done
    echo " ✅ OpenCode ready!"
else
    echo "✅ Using existing OpenCode server on port 4096"
fi

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."
    docker compose -f docker-compose.vnc.yml down 2>/dev/null
    if [ ! -z "$OPENCODE_PID" ]; then
        echo "🛑 Stopping OpenCode test server..."
        kill $OPENCODE_PID 2>/dev/null
        wait $OPENCODE_PID 2>/dev/null
    fi
}

# Set up cleanup trap
trap cleanup EXIT INT TERM

# Pass all arguments to the playwright test command
PLAYWRIGHT_ARGS="$@"

# Create a docker-compose file for VNC setup
cat > docker-compose.vnc.yml << 'EOF'
version: '3.8'

services:
  vnc:
    image: dorowu/ubuntu-desktop-lxde-vnc:focal
    ports:
      - "6080:80"     # noVNC web interface
      - "5900:5900"   # VNC port
    environment:
      - VNC_PASSWORD=secret
      - USER=root
      - PASSWORD=secret
      - RESOLUTION=1920x1080
    volumes:
      - /dev/shm:/dev/shm
      - .:/app
    working_dir: /app
    network_mode: host
EOF

echo "🖥️  Starting VNC desktop environment..."

# Start VNC container
docker compose -f docker-compose.vnc.yml up -d vnc

# Wait for VNC to be ready
echo -n "Waiting for VNC server to start"
COUNTER=0
while ! curl -s http://localhost:6080 > /dev/null 2>&1; do
    sleep 1
    COUNTER=$((COUNTER + 1))
    if [ $COUNTER -gt 60 ]; then
        echo " ❌ VNC server failed to start"
        exit 1
    fi
    echo -n "."
done
echo " ✅"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎬 VNC desktop ready! Watch the tests live:"
echo ""
echo "   📺 Open in your browser:"
echo "   http://localhost:6080"
echo "   Password: secret"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⏳ Starting tests in 10 seconds..."
echo "   (Open the browser link above NOW to watch!)"
sleep 10

# Install Node.js and pnpm in the VNC container, then run tests
echo ""
echo "🚀 Running tests (watch them in your browser!)..."
docker compose -f docker-compose.vnc.yml exec vnc bash -c "
    # Install Node.js
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &&
    apt-get install -y nodejs &&
    
    # Install pnpm
    npm install -g pnpm@10.14.0 &&
    
    # Install Playwright browsers
    cd /app &&
    pnpm install --frozen-lockfile &&
    pnpm exec playwright install chromium &&
    pnpm exec playwright install-deps chromium &&
    
    # Run tests in headed mode
    export DISPLAY=:1 &&
    pnpm test:e2e --headed --reporter=list $PLAYWRIGHT_ARGS
"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ All tests passed!"
else
    echo ""
    echo "❌ Some tests failed. Check test-results/ for details"
fi

echo ""
echo "💡 VNC desktop is still running. You can:"
echo "   - View it at: http://localhost:6080"
echo "   - Stop it with: docker compose -f docker-compose.vnc.yml down"
echo ""

# Clean up the temporary docker-compose file
rm -f docker-compose.vnc.yml

exit $EXIT_CODE