#!/usr/bin/env bash

# Script to clear all conversations and related data from the development database
# Usage: ./scripts/clear-conversations.sh

set -e

CONTAINER_NAME="core-dev-db"
DB_NAME="core_streaming"
DB_USER="user"

echo "🧹 Clearing all conversations and related data..."

# Check if database container is running
if ! docker ps --format 'table {{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "❌ Database container '${CONTAINER_NAME}' is not running."
    echo "   Start it with: ./scripts/dev-db.sh start"
    exit 1
fi

echo "📊 Current data counts:"
docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "
SELECT
  (SELECT COUNT(*) FROM conversations) as conversations,
  (SELECT COUNT(*) FROM messages) as messages,
  (SELECT COUNT(*) FROM blocks) as blocks,
  (SELECT COUNT(*) FROM tool_calls) as tool_calls,
  (SELECT COUNT(*) FROM prompts) as prompts,
  (SELECT COUNT(*) FROM prompt_events) as prompt_events;
"

echo ""
echo "⚠️  This will DELETE ALL conversations, messages, blocks, tool calls, prompts, and prompt events."
echo "   This action cannot be undone!"
echo ""
read -p "Are you sure you want to continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Operation cancelled."
    exit 1
fi

echo ""
echo "🗑️  Clearing data in dependency order..."

# Clear in reverse dependency order to avoid foreign key constraints
echo "  → Clearing tool_calls..."
docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "DELETE FROM tool_calls;"

echo "  → Clearing blocks..."
docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "DELETE FROM blocks;"

echo "  → Clearing prompt_events..."
docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "DELETE FROM prompt_events;"

echo "  → Clearing prompts..."
docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "DELETE FROM prompts;"

echo "  → Clearing messages..."
docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "DELETE FROM messages;"

echo "  → Clearing conversations..."
docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "DELETE FROM conversations;"

echo "  → Resetting auto-increment sequences..."
docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "
SELECT setval(pg_get_serial_sequence('conversations', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('messages', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('blocks', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('tool_calls', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('prompts', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('prompt_events', 'id'), 1, false);
"

echo ""
echo "📊 Final data counts:"
docker exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "
SELECT
  (SELECT COUNT(*) FROM conversations) as conversations,
  (SELECT COUNT(*) FROM messages) as messages,
  (SELECT COUNT(*) FROM blocks) as blocks,
  (SELECT COUNT(*) FROM tool_calls) as tool_calls,
  (SELECT COUNT(*) FROM prompts) as prompts,
  (SELECT COUNT(*) FROM prompt_events) as prompt_events;
"

echo ""
echo "✅ All conversations and related data have been cleared!"
echo "   The database is now clean and ready for fresh testing."