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

/**
 * Simple interface to mock/swap BashSession implementations
 */
export interface BashSessionLike {
  exec(command: string, callbacks?: StreamingCallbacks): Promise<CommandResult>
  start(): Promise<void>
  stop(): Promise<void>
  writeInput(input: string): void
  readonly pid?: number
  readonly alive: boolean
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
  private isInitialized = false

  // Public properties for compatibility
  get pid(): number | undefined {
    return this.ptyProcess?.pid
  }

  get alive(): boolean {
    return this.ptyProcess !== undefined
  }

  constructor(logger: Logger, config: BashSessionConfig = {}) {
    this.logger = logger
    this.config = {
      workingDirectory: config.workingDirectory ?? process.cwd(),
      timeout: config.timeout ?? 120000,
      environment: config.environment ?? {},
    }
  }

  /**
   * Start the bash session
   */
  async start(): Promise<void> {
    if (this.ptyProcess) {
      return
    }

    this.logger.info('Starting bash session', {
      workingDirectory: this.config.workingDirectory,
    })

    try {
      this.ptyProcess = pty.spawn('bash', ['--norc', '--noprofile'], {
        name: 'xterm-color',
        cwd: this.config.workingDirectory,
        env: {
          ...process.env,
          ...this.config.environment,
          TERM: 'xterm-256color',
          // Disable bracketed paste mode
          INPUTRC: '/dev/null',
        } as Record<string, string>,
      })

      this.ptyProcess.onExit(({ exitCode, signal }) => {
        this.logger.info('Bash session exited', { exitCode, signal })

        // Reject all pending commands
        for (const cmd of this.commandQueue) {
          const error = new Error(
            `Bash session exited unexpectedly: ${exitCode || signal}`
          )
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

      // Set up data handler first
      this.ptyProcess.onData((data: string) => {
        this.handlePtyData(data)
      })

      // Configure the terminal for cleaner output
      const setupCommands = [
        // Disable command echo
        'stty -echo',
        // Set a simple prompt that's easy to detect
        'export PS1="\\n__READY__\\$ "',
        // Disable history expansion
        'set +H',
        // Create a function to run commands and capture exit codes
        `run_cmd() {
          # Enable echo temporarily to show command output
          stty echo
          # Run the command
          eval "$1"
          local exit_code=$?
          # Disable echo again
          stty -echo
          # Output exit code marker
          echo "
__EXIT_CODE__:$exit_code"
          return $exit_code
        }`,
      ]

      for (const cmd of setupCommands) {
        this.ptyProcess.write(`${cmd}\n`)
        // Wait a bit for each command to process
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // Wait for the prompt to appear
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.logger.error('Timeout waiting for initial prompt', {
            bufferLength: this.commandBuffer.length,
            bufferSample: this.commandBuffer.substring(0, 500),
          })
          reject(new Error('Timeout waiting for initial prompt'))
        }, 5000)

        const checkInterval = setInterval(() => {
          if (this.commandBuffer.includes('__READY__')) {
            clearInterval(checkInterval)
            clearTimeout(timeout)
            this.commandBuffer = '' // Clear the initial buffer
            this.isInitialized = true
            resolve()
          }
        }, 100)
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
    // Always accumulate data in the buffer
    this.commandBuffer += data

    // Stream data to the current command if one is being processed
    const currentCmd = this.commandQueue[0]
    if (currentCmd && this.isProcessingCommand) {
      // Accumulate raw output
      currentCmd.stdout += data

      // Stream clean data to callbacks
      if (!data.includes('__READY__') && !data.includes('__EXIT_CODE__')) {
        // Remove ANSI escape codes for streaming
        const cleanData = data
          .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
          .replace(/\u001b\[\?[0-9]+[hl]/g, '')
          .replace(/\r/g, '')

        if (cleanData.trim()) {
          currentCmd.callbacks.onStdout?.(cleanData)
        }
      }
    }

    // Check if we have a complete command response
    if (this.commandBuffer.includes('__READY__')) {
      if (currentCmd && this.isProcessingCommand) {
        // Extract exit code
        const exitCodeMatch = this.commandBuffer.match(/__EXIT_CODE__:(\d+)/)
        const exitCode = exitCodeMatch?.[1]
          ? Number.parseInt(exitCodeMatch[1], 10)
          : 0

        // Extract the actual output (everything before the exit code marker)
        let output = currentCmd.stdout
        const exitCodeIndex = output.indexOf('__EXIT_CODE__')
        if (exitCodeIndex !== -1) {
          output = output.substring(0, exitCodeIndex)
        }

        // Clean up the output
        const cleanOutput = output
          .replace(/__READY__\$/g, '')
          .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '') // Remove ANSI escape codes
          .replace(/\u001b\[\?[0-9]+[hl]/g, '') // Remove bracketed paste mode
          .replace(/\r/g, '') // Remove carriage returns
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

        // Remove from queue and reset state
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

    this.logger.info('Processing command from queue', {
      id: cmd.id,
      command: cmd.command,
      queueLength: this.commandQueue.length,
    })

    this.isProcessingCommand = true

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

    // Execute command using our wrapper function
    // Escape single quotes in the command
    const escapedCommand = cmd.command.replace(/'/g, "'\\''")
    this.ptyProcess.write(`run_cmd '${escapedCommand}'\n`)
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

    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
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
   * Write raw input to the PTY (for interactive use)
   */
  writeInput(input: string): void {
    if (!this.ptyProcess) {
      throw new Error('Bash session not started')
    }
    this.ptyProcess.write(input)
  }

  /**
   * Stop the bash session
   */
  async stop(): Promise<void> {
    if (!this.ptyProcess) {
      return
    }

    this.logger.info('Stopping bash session')

    // Give the process a chance to exit gracefully
    this.ptyProcess.kill('SIGTERM')

    // Wait a bit for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Force kill if still running
    if (this.ptyProcess) {
      this.logger.warn('Force killing bash session')
      this.ptyProcess.kill('SIGKILL')
      this.ptyProcess = undefined
    }
  }
}
