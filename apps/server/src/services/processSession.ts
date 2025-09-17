import type { ChildProcess } from 'node:child_process'
import type { ToolCall } from '../db/schema.js'
import { Logger } from '../utils/logger.js'
import { BaseSession, type ToolResult } from './toolSession.js'

interface QueuedCommand {
  toolCall: ToolCall
  resolve: (result: ToolResult) => void
  reject: (error: Error) => void
  startTime: Date
}

export class ProcessSession extends BaseSession {
  private process?: ChildProcess
  private commandQueue: QueuedCommand[] = []
  private isExecuting = false
  private logger: Logger
  private createProcessFn: () => ChildProcess

  constructor(
    toolType: string,
    conversationId: number,
    createProcess: () => ChildProcess
  ) {
    super(toolType, conversationId)
    this.createProcessFn = createProcess
    this.logger = new Logger({
      sessionId: this.id,
      toolType: this.toolType,
      conversationId: this.conversationId,
    })
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    this.updateActivity()

    return new Promise((resolve, reject) => {
      this.commandQueue.push({
        toolCall,
        resolve,
        reject,
        startTime: new Date(),
      })

      this.logger.info('Tool call queued', {
        toolCallId: toolCall.id,
        queueLength: this.commandQueue.length,
      })

      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.isExecuting || this.commandQueue.length === 0) return

    this.isExecuting = true
    const command = this.commandQueue.shift()!

    try {
      // Ensure process is running
      if (!this.process || this.process.killed) {
        await this.createProcess()
      }

      const result = await this.executeInProcess(command.toolCall)
      command.resolve(result)

      this.logger.info('Tool call executed successfully', {
        toolCallId: command.toolCall.id,
        duration: Date.now() - command.startTime.getTime(),
      })
    } catch (error) {
      this.logger.error('Tool call execution failed', {
        toolCallId: command.toolCall.id,
        error: error instanceof Error ? error.message : String(error),
      })
      command.reject(error as Error)
    } finally {
      this.isExecuting = false
      // Process next command in queue
      setImmediate(() => this.processQueue())
    }
  }

  private async createProcess(): Promise<void> {
    this.logger.info('Creating new process')

    try {
      this.process = this.createProcessFn()

      // Set up error handling
      this.process.on('error', error => {
        this.logger.error('Process error', error)
        this.handleProcessFailure(error)
      })

      this.process.on('exit', (code, signal) => {
        this.logger.warn('Process exited', { code, signal })
        this.handleProcessFailure(
          new Error(`Process exited with code ${code}, signal ${signal}`)
        )
      })

      // Wait a moment for process to start
      await new Promise(resolve => setTimeout(resolve, 100))

      this.logger.info('Process created successfully', {
        pid: this.process.pid,
      })
    } catch (error) {
      this.logger.error('Failed to create process', error)
      throw new Error(`Failed to create process: ${error}`)
    }
  }

  private async executeInProcess(toolCall: ToolCall): Promise<ToolResult> {
    if (!this.process || this.process.killed) {
      throw new Error('Process is not available')
    }

    const request = toolCall.input as any

    // Handle restart command
    if (request.restart === true) {
      this.logger.info('Restart requested, recreating process')
      await this.restart()
      return {
        success: true,
        output: 'Session restarted successfully',
      }
    }

    const command = request.command as string
    if (!command) {
      throw new Error('No command provided')
    }

    this.logger.info('Executing command', {
      command: command.substring(0, 100) + (command.length > 100 ? '...' : ''),
    })

    return new Promise((resolve, reject) => {
      let output = ''
      let hasCompleted = false
      let timeoutHandle: NodeJS.Timeout

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }

      const complete = (result: ToolResult) => {
        if (hasCompleted) return
        hasCompleted = true
        cleanup()
        resolve(result)
      }

      const fail = (error: Error) => {
        if (hasCompleted) return
        hasCompleted = true
        cleanup()
        reject(error)
      }

      // Set up timeout (30 seconds for commands)
      timeoutHandle = setTimeout(() => {
        fail(new Error(`Command timed out after 30 seconds: ${command}`))
      }, 30000)

      // Set up output handlers
      const handleOutput = (data: Buffer) => {
        const text = data.toString()
        output += text

        // Check for completion marker
        if (text.includes('COMMAND_COMPLETE_')) {
          // Remove the completion marker from output
          const cleanOutput = output
            .replace(/COMMAND_COMPLETE_\d+\s*\n?/g, '')
            .trim()

          // Clean up listeners
          this.process?.stdout?.removeListener('data', handleOutput)
          this.process?.stderr?.removeListener('data', handleError)

          complete({
            success: true,
            output: cleanOutput,
            metadata: {
              pid: this.process?.pid,
              executionTime: Date.now(),
            },
          })
        }
      }

      const handleError = (data: Buffer) => {
        output += data.toString()
      }

      this.process?.stdout?.on('data', handleOutput)
      this.process?.stderr?.on('data', handleError)

      // Send command to process
      this.process?.stdin?.write(`${command}\necho "COMMAND_COMPLETE_$$"\n`)
    })
  }

  private handleProcessFailure(error: Error): void {
    // Reject all queued commands
    while (this.commandQueue.length > 0) {
      const command = this.commandQueue.shift()!
      command.reject(new Error(`Process failed: ${error.message}`))
    }

    this.isExecuting = false
    this.process = undefined
  }

  async restart(): Promise<void> {
    this.logger.info('Restarting session')
    this.updateActivity()

    // Kill existing process
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM')

      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL')
        }
      }, 5000)
    }

    // Wait a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 100))

    // Create new process
    await this.createProcess()

    this.logger.info('Session restarted successfully')
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up session')

    // Reject any pending commands
    while (this.commandQueue.length > 0) {
      const command = this.commandQueue.shift()!
      command.reject(new Error('Session is being cleaned up'))
    }

    // Kill process
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM')

      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL')
        }
      }, 5000)
    }

    this.process = undefined
    this.isExecuting = false

    this.logger.info('Session cleanup complete')
  }

  async isHealthy(): Promise<boolean> {
    if (!this.process || this.process.killed) {
      return false
    }

    try {
      // Try to kill with signal 0 to check if process exists
      process.kill(this.process.pid!, 0)
      return true
    } catch {
      return false
    }
  }
}
