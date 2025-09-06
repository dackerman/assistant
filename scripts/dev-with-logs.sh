#!/usr/bin/env bash

# Development server with file logging enabled
export LOG_TO_FILE=true
export LOG_DIR="./logs"
export LOG_LEVEL=INFO

echo "Starting development server with file logging enabled..."
echo "Logs will be written to: $LOG_DIR/app-$(date +%Y-%m-%d).log"

pnpm run dev