#!/usr/bin/env bash

# Unified script to run Playwright tests in Docker
# - Automatically starts OpenCode test server if not running
# - Supports video recording via RECORD_VIDEO env var
# - Passes through all Playwright CLI arguments
#
# Usage: ./test-docker.sh [playwright args]
# Examples:
#   ./test-docker.sh                              # Run all tests
#   ./test-docker.sh tests/e2e/session.spec.ts    # Run specific test file
#   ./test-docker.sh -g "should send"             # Run tests matching pattern
#   RECORD_VIDEO=true ./test-docker.sh            # Run with video recording

echo "🎭 Running Playwright tests in Docker..."

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

# Show video recording status
if [ "$RECORD_VIDEO" = "true" ]; then
    echo "📹 Video recording enabled"
fi

# Run tests with Docker
echo "🚀 Starting tests..."
docker run --rm \
    --network host \
    --user "$(id -u):$(id -g)" \
    -v "$(pwd)":/app \
    -w /app \
    -e CI=true \
    -e RECORD_VIDEO="$RECORD_VIDEO" \
    -e OPENCODE_URL="http://127.0.0.1:4096" \
    mcr.microsoft.com/playwright:v1.55.0-noble \
    sh -c "npm install -g pnpm@10.14.0 && pnpm install --frozen-lockfile && pnpm test:e2e --reporter=list $PLAYWRIGHT_ARGS"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed!"
else
    echo "❌ Some tests failed. Check test-results/ for details"
fi

exit $EXIT_CODE