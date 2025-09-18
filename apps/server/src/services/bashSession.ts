import * as pty from 'node-pty'
import type { Logger } from '../utils/logger.js'

export interface BashSessionConfig {
  workingDirectory?: string
  timeout?: number
  environment?: Record<string, string>
}

export interface CommandResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  error?: string
}

export interface StreamingCallbacks {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  onExit?: (exitCode: number | null, signal: string | null) => void
  onError?: (error: Error) => void
}

export interface BashSessionLike {
  start(): Promise<void>
  exec(command: string, callbacks?: StreamingCallbacks): Promise<CommandResult>
  stop(): Promise<void>
  readonly alive: boolean
  readonly pid: number | undefined
  writeInput(input: string): void
}

export type BashSessionFactory = (
  logger: Logger,
  config: BashSessionConfig
) => BashSessionLike | Promise<BashSessionLike>

/**
 * BashSession maintains a persistent bash process for executing commands.
 * It provides both streaming and buffered execution modes without any database interactions.
 */
export class BashSession implements BashSessionLike {
  private ptyProcess?: pty.IPty
  private readonly config: Required<BashSessionConfig>
  private readonly logger: Logger
  private commandBuffer = ''
  private commandQueue: Array<{
    id: string
    command: string
    resolver: (result: CommandResult) => void
    rejecter: (error: Error) => void
    stdout: string
    stderr: string
    callbacks: StreamingCallbacks
    timeoutHandle?: NodeJS.Timeout
  }> = []
  private isProcessingCommand = false

  constructor(logger: Logger, config: BashSessionConfig = {}) {
    this.config = {
      workingDirectory: config.workingDirectory || process.cwd(),
      timeout: config.timeout || 300000, // 5 minutes default
      environment: {
        ...(process.env as Record<string, string>),
        ...config.environment,
      },
    }
    this.logger = logger.child({ service: 'BashSession' })
  }

  /**
   * Start the persistent bash session
   */
  async start(): Promise<void> {
    if (this.ptyProcess) {
      return
    }

    this.logger.info('Starting bash session', {
      workingDirectory: this.config.workingDirectory,
    })

    try {
      this.ptyProcess = pty.spawn('bash', [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: this.config.workingDirectory,
        env: this.config.environment,
      })

      // Handle process exit
      this.ptyProcess.onExit(({ exitCode, signal }) => {
        this.logger.info('Bash session exited', { exitCode, signal })

        // Reject all pending commands
        const error = new Error('Bash session exited unexpectedly')
        for (const cmd of this.commandQueue) {
          if (cmd.timeoutHandle) {
            clearTimeout(cmd.timeoutHandle)
          }
          cmd.callbacks.onError?.(error)
          cmd.rejecter(error)
        }
        this.commandQueue = []
        this.isProcessingCommand = false
        this.ptyProcess = undefined
      })

      // Set up a custom prompt to make command completion detection reliable
      // Use a unique prompt that won't appear in normal output
      const promptMarker = '__PTY_PROMPT__'
      this.ptyProcess.write(`export PS1="${promptMarker}$ "\n`)

      // Wait for the prompt to appear
      await new Promise<void>(resolve => {
        const listener = (data: string) => {
          if (data.includes(promptMarker)) {
            this.ptyProcess?.onData(() => {}) // Remove temporary listener
            resolve()
          }
        }
        this.ptyProcess?.onData(listener)
      })

      // Set up permanent data handler
      this.ptyProcess.onData((data: string) => {
        this.handlePtyData(data)
      })

      this.logger.info('Bash session started successfully')
    } catch (error) {
      this.logger.error('Failed to start bash session', { error })
      this.ptyProcess = undefined
      throw error
    }
  }

  /**
   * Handle data from the PTY process
   */
  private handlePtyData(data: string): void {
    // Stream data to the current command if one is being processed
    const currentCmd = this.commandQueue[0]
    if (currentCmd && this.isProcessingCommand) {
      // Filter out prompt markers and exit codes for streaming
      const cleanData = data
        .replace(/__PTY_PROMPT__\$/g, '')
        .replace(/EXIT_CODE:\d+\n?/g, '')

      if (cleanData && !data.includes('__PTY_PROMPT__')) {
        currentCmd.callbacks.onStdout?.(cleanData)
        currentCmd.stdout += data
      }
    }

    this.commandBuffer += data

    // Check if we have a complete command response (prompt appeared)
    if (this.commandBuffer.includes('__PTY_PROMPT__')) {
      if (currentCmd && this.isProcessingCommand) {
        // Extract exit code from the last command
        const exitCodeMatch = currentCmd.stdout.match(/EXIT_CODE:(\d+)/)
        const exitCode = exitCodeMatch?.[1]
          ? Number.parseInt(exitCodeMatch[1], 10)
          : 0

        // Clean up the output
        const cleanOutput = currentCmd.stdout
          .replace(/__PTY_PROMPT__\$/g, '')
          .replace(/EXIT_CODE:\d+\n?/g, '')
          .trim()

        // Clear timeout
        if (currentCmd.timeoutHandle) {
          clearTimeout(currentCmd.timeoutHandle)
        }

        // Call exit callback
        currentCmd.callbacks.onExit?.(exitCode, null)

        // Resolve the command
        currentCmd.resolver({
          success: exitCode === 0,
          exitCode,
          stdout: cleanOutput,
          stderr: '', // PTY combines stdout/stderr
          error:
            exitCode !== 0 ? `Command exited with code ${exitCode}` : undefined,
        })

        // Remove from queue and process next
        this.commandQueue.shift()
        this.isProcessingCommand = false
        this.commandBuffer = ''

        // Process next command if any
        this.processNextCommand()
      }
    }
  }

  /**
   * Process the next command in the queue
   */
  private processNextCommand(): void {
    const cmd = this.commandQueue[0]
    if (this.isProcessingCommand || !cmd || !this.ptyProcess) {
      return
    }

    this.isProcessingCommand = true

    this.logger.info('Processing command from queue', {
      id: cmd.id,
      command: cmd.command,
      queueLength: this.commandQueue.length,
    })

    // Set up timeout
    cmd.timeoutHandle = setTimeout(() => {
      const error = new Error(
        `Command timed out after ${this.config.timeout}ms`
      )
      cmd.callbacks.onError?.(error)
      cmd.rejecter(error)

      // Remove from queue and process next
      this.commandQueue.shift()
      this.isProcessingCommand = false
      this.commandBuffer = ''
      this.processNextCommand()
    }, this.config.timeout)

    // Execute command with exit code capture
    this.ptyProcess.write(`${cmd.command}; echo "EXIT_CODE:$?"\n`)
  }

  /**
   * Execute a command with streaming callbacks
   */
  async exec(
    command: string,
    callbacks: StreamingCallbacks = {}
  ): Promise<CommandResult> {
    if (!this.ptyProcess) {
      throw new Error('Bash session not started')
    }

    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    this.logger.info('Queuing command', {
      commandId,
      command,
      queueLength: this.commandQueue.length,
    })

    return new Promise((resolve, reject) => {
      // Add to queue
      this.commandQueue.push({
        id: commandId,
        command,
        resolver: resolve,
        rejecter: reject,
        stdout: '',
        stderr: '',
        callbacks,
      })

      // Start processing if not already
      this.processNextCommand()
    })
  }

  /**
   * Check if the session is alive
   */
  get alive(): boolean {
    return this.ptyProcess !== undefined
  }

  /**
   * Get process PID
   */
  get pid(): number | undefined {
    return this.ptyProcess?.pid
  }

  /**
   * Stop the bash session
   */
  async stop(): Promise<void> {
    if (!this.ptyProcess) {
      return
    }

    this.logger.info('Stopping bash session')

    return new Promise(resolve => {
      if (!this.ptyProcess) {
        resolve()
        return
      }

      const cleanup = () => {
        // Reject all pending commands
        const error = new Error('Bash session stopped')
        for (const cmd of this.commandQueue) {
          if (cmd.timeoutHandle) {
            clearTimeout(cmd.timeoutHandle)
          }
          cmd.callbacks.onError?.(error)
          cmd.rejecter(error)
        }

        // Clean up all state
        this.commandQueue = []
        this.isProcessingCommand = false
        this.commandBuffer = ''

        // Destroy the PTY process
        try {
          this.ptyProcess?.kill()
        } catch {
          // Ignore errors during kill
        }

        this.ptyProcess = undefined
        resolve()
      }

      // Set timeout for forceful termination
      const forceKillTimeout = setTimeout(() => {
        this.logger.warn('Force killing bash session')
        cleanup()
      }, 1000)

      // Set up exit handler
      this.ptyProcess.onExit(() => {
        clearTimeout(forceKillTimeout)
        cleanup()
      })

      // Try graceful termination first
      try {
        this.ptyProcess.write('exit\n')
      } catch {
        // If write fails, just kill it
        cleanup()
      }
    })
  }

  /**
   * Send raw input to the bash process
   * Use with caution - prefer exec for command execution
   */
  writeInput(input: string): void {
    if (!this.ptyProcess) {
      throw new Error('Bash session not started')
    }
    this.ptyProcess.write(input)
  }
}
