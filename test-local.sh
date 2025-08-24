#!/usr/bin/env bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🎭 Running Playwright tests locally with real OpenCode...${NC}"

# Clean up any existing test data
echo -e "${GREEN}Cleaning test environment...${NC}"
rm -rf .test-opencode

# Check if OpenCode is available
if ! command -v opencode &> /dev/null; then
    echo -e "${RED}❌ OpenCode CLI not found. Please install it first.${NC}"
    exit 1
fi

# Check if ports are available
if lsof -Pi :4096 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${RED}❌ Port 4096 is already in use. Please stop the existing OpenCode instance.${NC}"
    exit 1
fi

if lsof -Pi :7653 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}⚠️  Port 7653 is in use. Killing existing process...${NC}"
    kill $(lsof -Pi :7653 -sTCP:LISTEN -t)
    sleep 2
fi

if lsof -Pi :7654 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}⚠️  Port 7654 is in use. Killing existing process...${NC}"
    kill $(lsof -Pi :7654 -sTCP:LISTEN -t)
    sleep 2
fi

# Run tests (Playwright will start OpenCode and dev server automatically)
echo -e "${GREEN}Starting services and running tests...${NC}"
pnpm test:e2e

EXIT_CODE=$?

# Clean up
echo -e "${GREEN}Cleaning up test data...${NC}"
rm -rf .test-opencode

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
else
    echo -e "${RED}❌ Some tests failed. Check playwright-report/index.html for details${NC}"
fi

exit $EXIT_CODE