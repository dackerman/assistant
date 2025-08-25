#!/usr/bin/env bash

# Script to run Playwright tests in headed mode via Docker
# The browser runs inside Docker with a virtual display (Xvfb)
# You can see what happened by checking the video recordings
#
# Usage: ./test-docker-headed.sh [playwright args]
# Examples:
#   ./test-docker-headed.sh                           # Run all tests
#   ./test-docker-headed.sh tests/e2e/debug.spec.ts   # Run debug test

echo "🎭 Running Playwright tests in headed mode inside Docker..."

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

echo "🖥️  Running tests with virtual display (Xvfb)..."
echo "📹 Videos will be saved to test-results/ directory"
echo ""

# Run tests with Docker and Xvfb
docker run --rm \
    --network host \
    --user "$(id -u):$(id -g)" \
    -v "$(pwd)":/app \
    -w /app \
    -e CI=false \
    -e OPENCODE_URL="http://127.0.0.1:4096" \
    mcr.microsoft.com/playwright:v1.55.0-noble \
    sh -c "
        # Start virtual display
        Xvfb :99 -screen 0 1920x1080x24 &
        export DISPLAY=:99
        
        # Install dependencies
        npm install -g pnpm@10.14.0 &&
        pnpm install --frozen-lockfile &&
        
        # Run tests in headed mode with video recording
        echo '🚀 Starting tests in headed mode...'
        RECORD_VIDEO=true pnpm test:e2e --headed --reporter=list $PLAYWRIGHT_ARGS
    "

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed!"
else
    echo "❌ Some tests failed."
fi

# Check for videos
if [ -d "test-results" ]; then
    VIDEO_COUNT=$(find test-results -name "*.webm" 2>/dev/null | wc -l)
    if [ $VIDEO_COUNT -gt 0 ]; then
        echo "📹 Found $VIDEO_COUNT video recording(s) in test-results/"
        echo "   View them with: ls -la test-results/**/*.webm"
    fi
fi

exit $EXIT_CODE