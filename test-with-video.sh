#!/usr/bin/env bash

echo "🎬 Running Playwright tests with video recording..."

# Create directory for videos
mkdir -p test-videos

# Run tests with video recording enabled
docker run --rm \
    --network host \
    -v "$(pwd)":/app \
    -w /app \
    -e CI=true \
    -e RECORD_VIDEO=true \
    mcr.microsoft.com/playwright:v1.55.0-noble \
    sh -c "npm install -g pnpm@10.14.0 && pnpm install --frozen-lockfile && pnpm test:e2e --reporter=list"

# Copy videos to accessible location
if [ -d "test-results" ]; then
    echo "📹 Copying test videos..."
    find test-results -name "*.webm" -exec cp {} test-videos/ \; 2>/dev/null
    echo "Videos saved in test-videos/ directory"
    echo "You can play them with: vlc test-videos/*.webm"
fi

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed! Check test-videos/ for recordings"
else
    echo "❌ Some tests failed. Check test-videos/ for recordings"
fi

exit $EXIT_CODE