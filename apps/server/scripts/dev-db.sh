#!/usr/bin/env bash

set -e

CONTAINER_NAME="core-dev-db"
DB_NAME="core_streaming"
DB_USER="user"
DB_PASS="password"
DB_PORT="55432"

start_db() {
    echo "🐳 Starting development database container..."
    
    # Check if container already exists
    if docker ps -a --format 'table {{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "📦 Container already exists. Starting existing container..."
        docker start ${CONTAINER_NAME}
    else
        echo "📦 Creating new development database container..."
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
    
    echo "✅ Development database is ready at localhost:${DB_PORT}"
}

stop_db() {
    echo "🛑 Stopping development database container..."
    docker stop ${CONTAINER_NAME} 2>/dev/null || true
}

remove_db() {
    echo "🗑️  Removing development database container..."
    docker stop ${CONTAINER_NAME} 2>/dev/null || true
    docker rm ${CONTAINER_NAME} 2>/dev/null || true
}

status_db() {
    if docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -q "^${CONTAINER_NAME}"; then
        echo "✅ Development database is running"
        docker ps --filter name=${CONTAINER_NAME} --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    else
        echo "❌ Development database is not running"
    fi
}

migrate_db() {
    echo "🔄 Running database migrations..."
    cd "$(dirname "$0")/.."
    DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}" bun run db:migrate
    echo "✅ Migrations complete"
}

seed_db() {
    echo "🌱 Seeding database with default data..."
    docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "
        INSERT INTO users (id, email) VALUES (1, 'dev@example.com') 
        ON CONFLICT (id) DO NOTHING;
    " >/dev/null
    echo "✅ Database seeded"
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
    migrate)
        migrate_db
        ;;
    seed)
        seed_db
        ;;
    setup)
        start_db
        migrate_db
        seed_db
        ;;
    *)
        echo "Usage: $0 {start|stop|remove|status|restart|migrate|seed|setup}"
        echo "  start   - Start the development database container"
        echo "  stop    - Stop the development database container"
        echo "  remove  - Remove the development database container"
        echo "  status  - Show container status"
        echo "  restart - Restart the development database container"
        echo "  migrate - Run database migrations"
        echo "  seed    - Seed database with default data"
        echo "  setup   - Start database, run migrations, and seed data"
        exit 1
        ;;
esac