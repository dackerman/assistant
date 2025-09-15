# Logging Configuration

The application uses a structured logging system that can output to both console and files.

## Configuration

Logging behavior is controlled by environment variables:

- `LOG_TO_FILE=true` - Enable file logging (default: false)
- `LOG_DIR=path` - Directory for log files (default: `./logs`)
- `LOG_LEVEL=DEBUG|INFO|WARN|ERROR` - Minimum log level (default: INFO)

## File Logging

When enabled, logs are written to daily files in JSON format:

- Pattern: `{LOG_DIR}/app-YYYY-MM-DD.log`
- Example: `./logs/app-2025-09-06.log`

## Usage

### Development with File Logging

```bash
# Enable file logging for entire application
pnpm run dev:logs

# Or set environment variables manually
LOG_TO_FILE=true LOG_DIR=./logs pnpm run dev

# Server only with file logging
cd apps/server
pnpm run dev:logs
```

### Production with File Logging

```bash
cd apps/server
pnpm run start:logs
```

## Log Format

### Console (Development)

```
2025-09-06T19:30:00.123Z INFO  Server ready [port=4001, host=0.0.0.0]
```

### File (JSON)

```json
{
  "timestamp": "2025-09-06T19:30:00.123Z",
  "level": "INFO",
  "message": "Server ready",
  "context": {
    "port": 4001,
    "host": "0.0.0.0"
  }
}
```

## Log Levels

- **DEBUG**: Detailed diagnostic information
- **INFO**: General operational messages
- **WARN**: Warning conditions
- **ERROR**: Error conditions with stack traces

## Log Rotation

Log files are automatically rotated daily. Consider implementing log cleanup for production environments:

```bash
# Example: Keep logs for 30 days
find ./logs -name "app-*.log" -mtime +30 -delete
```
