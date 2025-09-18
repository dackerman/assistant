#!/usr/bin/env bash

# Script to run E2E tests in Docker container

set -e

echo "🚀 Starting Docker-based E2E tests..."

# Clean up any existing test containers
echo "🧹 Cleaning up existing test containers..."
docker compose -f docker-compose.test.yml down --volumes --remove-orphans 2>/dev/null || true

# Build the test image
echo "🔨 Building test image..."
docker compose -f docker-compose.test.yml build e2e-tests

# Start the database
echo "🗄️ Starting test database..."
docker compose -f docker-compose.test.yml up -d postgres-test

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
for i in {1..30}; do
  if docker compose -f docker-compose.test.yml exec postgres-test pg_isready -U core_test >/dev/null 2>&1; then
    echo "✅ Database is ready!"
    break
  fi
  echo "⏳ Database not ready yet... (attempt $i/30)"
  sleep 2
done

# Run database migrations
echo "🔄 Running database migrations..."
docker compose -f docker-compose.test.yml run --rm e2e-tests pnpm run --filter=server db:migrate

# Run the E2E tests
echo "🧪 Running E2E tests..."
docker compose -f docker-compose.test.yml run --rm e2e-tests pnpm exec playwright test --config=playwright.docker.config.ts

# Store the exit code
TEST_EXIT_CODE=$?

# Clean up
echo "🧹 Cleaning up..."
docker compose -f docker-compose.test.yml down --volumes

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "✅ All E2E tests passed!"
else
    echo "❌ E2E tests failed with exit code $TEST_EXIT_CODE"
fi

exit $TEST_EXIT_CODE