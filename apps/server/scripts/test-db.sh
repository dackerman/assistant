#!/usr/bin/env bash

set -e

CONTAINER_NAME="core-test-db"
DB_NAME="test_db"
DB_USER="test_user"
DB_PASS="test_pass"
DB_PORT="15432"

start_db() {
    echo "🐳 Starting test database container..."
    
    # Check if container already exists
    if docker ps -a --format 'table {{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "📦 Container already exists. Starting existing container..."
        docker start ${CONTAINER_NAME}
    else
        echo "📦 Creating new test database container..."
        docker run --name ${CONTAINER_NAME} \
            -e POSTGRES_DB=${DB_NAME} \
            -e POSTGRES_USER=${DB_USER} \
            -e POSTGRES_PASSWORD=${DB_PASS} \
            -p ${DB_PORT}:5432 \
            -d postgres:16-alpine
    fi
    
    echo "⏳ Waiting for database to be ready..."
    sleep 3
    
    # Wait for database to be ready
    until docker exec ${CONTAINER_NAME} pg_isready -U ${DB_USER} -d ${DB_NAME}; do
        echo "⏳ Waiting for PostgreSQL..."
        sleep 1
    done
    
    echo "✅ Test database is ready at localhost:${DB_PORT}"
}

stop_db() {
    echo "🛑 Stopping test database container..."
    docker stop ${CONTAINER_NAME} 2>/dev/null || true
}

remove_db() {
    echo "🗑️  Removing test database container..."
    docker stop ${CONTAINER_NAME} 2>/dev/null || true
    docker rm ${CONTAINER_NAME} 2>/dev/null || true
}

status_db() {
    if docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -q "^${CONTAINER_NAME}"; then
        echo "✅ Test database is running"
        docker ps --filter name=${CONTAINER_NAME} --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    else
        echo "❌ Test database is not running"
    fi
}

case "${1:-start}" in
    start)
        start_db
        ;;
    stop)
        stop_db
        ;;
    remove|clean)
        remove_db
        ;;
    status)
        status_db
        ;;
    restart)
        stop_db
        start_db
        ;;
    *)
        echo "Usage: $0 {start|stop|remove|status|restart}"
        echo "  start   - Start the test database container"
        echo "  stop    - Stop the test database container"
        echo "  remove  - Remove the test database container"
        echo "  status  - Show container status"
        echo "  restart - Restart the test database container"
        exit 1
        ;;
esac