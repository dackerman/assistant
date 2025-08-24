#!/usr/bin/env bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🎭 Running Playwright tests with real OpenCode...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Clean up any existing test OpenCode data
echo -e "${GREEN}Cleaning test environment...${NC}"
rm -rf .test-opencode

# Start services with docker compose
echo -e "${GREEN}Starting OpenCode and running tests...${NC}"
docker compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from playwright

# Check exit code
EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
else
    echo -e "${RED}❌ Some tests failed. Check playwright-report/index.html for details${NC}"
fi

# Clean up
echo -e "${GREEN}Cleaning up...${NC}"
docker compose -f docker-compose.test.yml down

exit $EXIT_CODE