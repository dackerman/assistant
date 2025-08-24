#!/usr/bin/env bash

# Script to run Playwright tests with live browser viewing via noVNC
# Watch the tests run in real-time at http://localhost:6080/vnc.html
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
    docker stop playwright-vnc 2>/dev/null
    docker rm playwright-vnc 2>/dev/null
    rm -f docker-compose.vnc.yml 2>/dev/null
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

# Build the VNC image if needed
echo "🔨 Building VNC Docker image..."
docker build -f Dockerfile.vnc -t playwright-vnc:latest . || {
    echo "❌ Failed to build Docker image"
    exit 1
}

# Stop any existing container
docker stop playwright-vnc 2>/dev/null
docker rm playwright-vnc 2>/dev/null

echo "🖥️  Starting VNC container..."

# Start the VNC container
docker run -d \
    --name playwright-vnc \
    -p 6080:6080 \
    -p 5900:5900 \
    -v "$(pwd)":/app \
    --add-host=host.docker.internal:host-gateway \
    playwright-vnc:latest

# Wait for VNC to be ready
echo -n "Waiting for VNC server to start"
COUNTER=0
while ! curl -s http://localhost:6080 > /dev/null 2>&1; do
    sleep 1
    COUNTER=$((COUNTER + 1))
    if [ $COUNTER -gt 30 ]; then
        echo " ❌ VNC server failed to start"
        echo "Check logs with: docker logs playwright-vnc"
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
echo "   http://localhost:6080/vnc.html"
echo "   (Click 'Connect' - no password required)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⏳ Starting tests in 10 seconds..."
echo "   (Open the browser link above NOW to watch!)"
sleep 10

# Run tests in the container
echo ""
echo "🚀 Running tests (watch them in your browser!)..."
docker exec playwright-vnc bash -c "
    cd /app &&
    
    # Install dependencies if needed
    if [ ! -d node_modules ]; then
        echo 'Installing dependencies...'
        pnpm install --frozen-lockfile
    fi
    
    # Update backend to connect to host OpenCode
    sed -i 's|http://127.0.0.1:4096|http://host.docker.internal:4096|g' src/index.ts
    
    # Run tests in headed mode (CI=true prevents starting OpenCode)
    export DISPLAY=:1
    export CI=true
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
echo "   - Run more tests: docker exec playwright-vnc bash -c 'DISPLAY=:1 pnpm test:e2e --headed <args>'"
echo "   - Open terminal: docker exec -it playwright-vnc bash"
echo "   - Stop it: docker stop playwright-vnc"
echo ""

exit $EXIT_CODE