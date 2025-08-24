#!/usr/bin/env bash

# Simple script to run Playwright tests in Docker
# Assumes OpenCode is already running on port 4096

echo "🎭 Running Playwright tests in Docker..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Run tests with Docker
docker run --rm \
    --network host \
    -v "$(pwd)":/app \
    -w /app \
    -e CI=true \
    mcr.microsoft.com/playwright:v1.55.0-noble \
    sh -c "npm install -g pnpm@10.14.0 && pnpm install --frozen-lockfile && pnpm test:e2e --reporter=list"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed!"
else
    echo "❌ Some tests failed. Check test-results/ for details"
fi

exit $EXIT_CODE