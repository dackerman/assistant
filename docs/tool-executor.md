# Tool Executor Design

## Overview

The Tool Executor is a lightweight, robust system for executing tools during AI conversations. It leverages the existing database and streaming infrastructure to provide reliable tool execution with recovery capabilities, without requiring external queue systems like Redis or BullMQ.

## Architecture Principles

### 1. Lightweight & Simple

- **No external dependencies**: Uses existing PostgreSQL database for persistence
- **In-process execution**: Direct async execution without worker processes
- **Minimal overhead**: ~1KB code footprint vs ~20MB for BullMQ

### 2. Robust Recovery

- **Process interruption handling**: Graceful recovery from server restarts
- **Orphan cleanup**: Automatically handles abandoned executions
- **Heartbeat monitoring**: Detects and cleans up stale processes
- **PID tracking**: Can kill runaway processes

### 3. System Access by Design

- **Direct bash execution**: Full system access is a feature, not a security concern
- **Real-time output**: Stream tool output via WebSocket
- **Resource monitoring**: Track CPU, memory, execution time

## Database Schema

### Extended tool_calls Table

```sql
-- Existing columns
id SERIAL PRIMARY KEY,
prompt_id INTEGER NOT NULL,
block_id INTEGER NOT NULL,
api_tool_call_id TEXT,
tool_name TEXT NOT NULL,
state tool_state_enum NOT NULL,
request JSONB NOT NULL,
response JSONB,
error TEXT,
created_at TIMESTAMP DEFAULT NOW(),
updated_at TIMESTAMP DEFAULT NOW(),

-- New recovery columns
pid INTEGER,                    -- Process ID for kill operations
started_at TIMESTAMP,           -- When execution began
timeout_at TIMESTAMP,           -- When to consider tool stale (started_at + timeout)
retry_count INTEGER DEFAULT 0,  -- Number of retry attempts
last_heartbeat TIMESTAMP,       -- Last liveness update
output_stream TEXT,             -- Real-time output buffer
max_retries INTEGER DEFAULT 3,  -- Maximum retry attempts
timeout_seconds INTEGER DEFAULT 300  -- Tool execution timeout
```

### State Transitions

```
created -> running -> complete
                  -> error -> (retry) -> running
                          -> failed (max retries exceeded)

-- Recovery states
running -> stale (no heartbeat) -> failed
running -> orphaned (server restart) -> failed
```

## Core Components

### 1. ToolExecutorService

Main service class handling tool execution lifecycle:

```typescript
class ToolExecutorService {
  // Core execution
  async executeTool(toolCall: ToolCall): Promise<ToolResult>
  async cancelTool(toolCallId: number): Promise<void>

  // Recovery & monitoring
  async recoverOrphanedTools(): Promise<void>
  async cleanupStaleTools(): Promise<void>
  async killRunningProcess(toolCallId: number): Promise<void>

  // State management
  private updateHeartbeat(toolCallId: number): Promise<void>
  private markToolComplete(toolCallId: number, result: any): Promise<void>
  private markToolFailed(toolCallId: number, error: string): Promise<void>
}
```

### 2. Process Management

```typescript
interface ActiveTool {
  id: number
  process: ChildProcess
  startedAt: Date
  timeoutHandle: NodeJS.Timeout
  heartbeatHandle: NodeJS.Timeout
  outputBuffer: string[]
}

class ProcessManager {
  private activeTools = new Map<number, ActiveTool>()
  private maxConcurrency = 5
  private semaphore = new Semaphore(this.maxConcurrency)
}
```

### 3. Recovery Strategies

#### Startup Recovery

```typescript
async recoverOrphanedTools() {
  const orphaned = await db.select()
    .from(toolCalls)
    .where(inArray(toolCalls.state, ['created', 'running']));

  for (const tool of orphaned) {
    if (tool.pid && await this.isProcessRunning(tool.pid)) {
      process.kill(tool.pid, 'SIGTERM');
    }

    if (tool.retryCount < tool.maxRetries) {
      await this.retryTool(tool.id);
    } else {
      await this.markToolFailed(tool.id, 'Server restart - execution interrupted');
    }
  }
}
```

#### Heartbeat Monitoring

```typescript
private startHeartbeatMonitoring() {
  setInterval(async () => {
    const staleThreshold = new Date(Date.now() - 60_000); // 1 minute

    const stale = await db.select()
      .from(toolCalls)
      .where(
        and(
          eq(toolCalls.state, 'running'),
          lt(toolCalls.lastHeartbeat, staleThreshold)
        )
      );

    for (const tool of stale) {
      await this.handleStaleToolExecution(tool);
    }
  }, 30_000); // Check every 30 seconds
}
```

#### Graceful Shutdown

```typescript
async shutdown() {
  this.logger.info('Shutting down tool executor');

  // Cancel all active tools
  for (const [toolId, activeTool] of this.activeTools) {
    clearTimeout(activeTool.timeoutHandle);
    clearInterval(activeTool.heartbeatHandle);

    if (activeTool.process.pid) {
      process.kill(activeTool.process.pid, 'SIGTERM');
    }

    await this.markToolFailed(toolId, 'Server shutdown');
  }

  // Wait for cleanup
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// Process signal handlers
process.on('SIGTERM', () => toolExecutor.shutdown());
process.on('SIGINT', () => toolExecutor.shutdown());
```

## Integration with Streaming

### StateMachine Extension

```typescript
// In StreamingStateMachine
private async handleBlockEnd(tx: any, event: StreamEvent) {
  // ... existing code ...

  if (event.blockType === "tool_call" && event.toolCallData) {
    // Create tool call record
    const [toolCall] = await tx.insert(toolCalls).values({...}).returning();

    // Trigger async execution (don't await)
    this.toolExecutor.executeTool(toolCall).catch(error => {
      this.logger.error('Tool execution failed', error);
    });
  }
}
```

### WebSocket Broadcasting

```typescript
// New message types
type ToolMessage =
  | { type: 'tool_started'; promptId: number; toolCallId: number; toolName: string }
  | { type: 'tool_output'; promptId: number; toolCallId: number; output: string }
  | { type: 'tool_complete'; promptId: number; toolCallId: number; result: any }
  | { type: 'tool_error'; promptId: number; toolCallId: number; error: string }

// Stream tool output in real-time
private streamToolOutput(toolCallId: number, output: string) {
  const toolCall = await this.getToolCall(toolCallId);
  broadcast(toolCall.conversationId, {
    type: 'tool_output',
    promptId: toolCall.promptId,
    toolCallId,
    output
  });
}
```

## Error Handling & Retries

### Retry Strategy

```typescript
async retryTool(toolCallId: number): Promise<void> {
  const toolCall = await this.getToolCall(toolCallId);

  if (toolCall.retryCount >= toolCall.maxRetries) {
    await this.markToolFailed(toolCallId, 'Max retries exceeded');
    return;
  }

  // Exponential backoff
  const delay = Math.min(1000 * Math.pow(2, toolCall.retryCount), 30000);

  setTimeout(async () => {
    await db.update(toolCalls)
      .set({
        state: 'created',
        retryCount: toolCall.retryCount + 1,
        error: null
      })
      .where(eq(toolCalls.id, toolCallId));

    await this.executeTool(toolCall);
  }, delay);
}
```

### Error Categories

```typescript
enum ToolErrorType {
  TIMEOUT = 'timeout',
  PERMISSION_DENIED = 'permission_denied',
  COMMAND_NOT_FOUND = 'command_not_found',
  RESOURCE_EXHAUSTED = 'resource_exhausted',
  PROCESS_KILLED = 'process_killed',
  SYSTEM_ERROR = 'system_error',
}

interface ToolError {
  type: ToolErrorType
  message: string
  exitCode?: number
  signal?: string
  retryable: boolean
}
```

## Testing Strategy

### 1. Clock Stubbing for Timeouts

```typescript
// Using Sinon for clock control
describe('Tool Executor Timeouts', () => {
  let clock: sinon.SinonFakeTimers

  beforeEach(() => {
    clock = sinon.useFakeTimers()
  })

  afterEach(() => {
    clock.restore()
  })

  it('should timeout long-running tools', async () => {
    const execution = toolExecutor.executeTool({
      id: 1,
      toolName: 'bash',
      request: { command: 'sleep 1000' },
      timeoutSeconds: 5,
    })

    // Fast-forward past timeout
    clock.tick(6000)

    await expect(execution).to.be.rejectedWith('Tool execution timeout')

    // Verify database state
    const toolCall = await getToolCall(1)
    expect(toolCall.state).to.equal('error')
    expect(toolCall.error).to.include('timeout')
  })
})
```

### 2. Process Mocking

```typescript
describe('Process Management', () => {
  let mockSpawn: sinon.SinonStub
  let mockProcess: MockChildProcess

  beforeEach(() => {
    mockProcess = new MockChildProcess()
    mockSpawn = sinon.stub(childProcess, 'spawn').returns(mockProcess)
  })

  it('should track process PID in database', async () => {
    mockProcess.pid = 12345

    const execution = toolExecutor.executeTool(sampleTool)

    // Verify PID stored
    const toolCall = await getToolCall(1)
    expect(toolCall.pid).to.equal(12345)
    expect(toolCall.state).to.equal('running')
  })

  it('should kill process on cancellation', async () => {
    mockProcess.pid = 12345
    const killSpy = sinon.spy(process, 'kill')

    await toolExecutor.cancelTool(1)

    expect(killSpy).to.have.been.calledWith(12345, 'SIGTERM')
  })
})
```

### 3. Database State Verification

```typescript
describe('Recovery Operations', () => {
  it('should recover orphaned tools on startup', async () => {
    // Setup orphaned tools in database
    await insertToolCalls([
      { id: 1, state: 'running', pid: 999, startedAt: new Date() },
      { id: 2, state: 'created', retryCount: 0 },
    ])

    // Mock process.kill
    const killSpy = sinon.stub(process, 'kill')

    await toolExecutor.recoverOrphanedTools()

    // Verify database cleanup
    const tools = await getAllToolCalls()
    expect(tools[0].state).to.equal('failed')
    expect(tools[0].error).to.include('Server restart')
    expect(tools[1].state).to.equal('created') // Should be retried

    expect(killSpy).to.have.been.calledWith(999, 'SIGTERM')
  })
})
```

### 4. Concurrency Testing

```typescript
describe('Concurrent Execution', () => {
  it('should respect max concurrency limits', async () => {
    const maxConcurrency = 2
    toolExecutor.setMaxConcurrency(maxConcurrency)

    // Start 5 tools simultaneously
    const executions = Array.from({ length: 5 }, (_, i) =>
      toolExecutor.executeTool({ id: i + 1, ...baseTool })
    )

    // Only first 2 should be running
    await clock.tickAsync(100)

    const runningTools = await getToolCallsByState('running')
    expect(runningTools).to.have.length(maxConcurrency)

    // Complete first tool
    mockProcesses[0].emit('exit', 0)
    await clock.tickAsync(100)

    // Third tool should now start
    const stillRunning = await getToolCallsByState('running')
    expect(stillRunning).to.have.length(maxConcurrency)
  })
})
```

### 5. WebSocket Integration Tests

```typescript
describe('WebSocket Broadcasting', () => {
  it('should broadcast tool progress updates', async () => {
    const mockWs = new MockWebSocket()
    subscribeToConversation(1, mockWs)

    const execution = toolExecutor.executeTool({
      id: 1,
      promptId: 10,
      toolName: 'bash',
      request: { command: 'echo "hello"' },
    })

    // Simulate tool output
    mockProcess.stdout.emit('data', 'hello\n')
    await clock.tickAsync(100)

    // Verify WebSocket messages
    expect(mockWs.sentMessages).to.deep.include({
      type: 'tool_output',
      promptId: 10,
      toolCallId: 1,
      output: 'hello\n',
    })

    // Complete tool
    mockProcess.emit('exit', 0)
    await execution

    expect(mockWs.sentMessages).to.deep.include({
      type: 'tool_complete',
      promptId: 10,
      toolCallId: 1,
      result: { stdout: 'hello\n', exitCode: 0 },
    })
  })
})
```

## Performance Considerations

### 1. Memory Management

- **Output buffering**: Limit tool output buffer size (default: 1MB)
- **Process cleanup**: Ensure all processes are properly terminated
- **Database connections**: Reuse connections, avoid connection leaks

### 2. Resource Limits

```typescript
const TOOL_LIMITS = {
  MAX_EXECUTION_TIME: 5 * 60 * 1000, // 5 minutes
  MAX_OUTPUT_SIZE: 1024 * 1024, // 1MB
  MAX_CONCURRENT_TOOLS: 5, // Per server
  MAX_MEMORY_USAGE: 100 * 1024 * 1024, // 100MB per tool
}
```

### 3. Monitoring & Metrics

```typescript
interface ToolMetrics {
  totalExecutions: number
  successfulExecutions: number
  failedExecutions: number
  averageExecutionTime: number
  activeTools: number
  queuedTools: number
}

// Expose metrics endpoint
app.get('/api/metrics/tools', c => {
  return c.json(toolExecutor.getMetrics())
})
```

This design provides a robust, lightweight tool execution system that leverages existing infrastructure while providing comprehensive recovery capabilities and thorough test coverage.
