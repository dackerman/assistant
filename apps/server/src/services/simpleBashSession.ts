import { spawn } from 'child_process'
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
 * SimpleBashSession maintains session state (cwd, env vars) between commands
 * without using PTY. This provides clean output but doesn't support interactive
 * programs. Similar to Python's subprocess.run with shell=True.
 */
export class SimpleBashSession {
  private readonly logger: Logger
  private readonly config: Required<BashSessionConfig>

  // Session state that persists between commands
  private sessionEnv: Record<string, string>
  private sessionCwd: string
  private sessionExports: Record<string, string> = {}
  private sessionAliases: Map<string, string> = new Map()

  // For compatibility with existing code
  readonly alive = true
  readonly pid = process.pid

  constructor(logger: Logger, config: BashSessionConfig = {}) {
    this.logger = logger
    this.config = {
      workingDirectory: config.workingDirectory ?? process.cwd(),
      timeout: config.timeout ?? 30000,
      environment: config.environment ?? {},
    }

    // Initialize session state
    this.sessionCwd = this.config.workingDirectory
    // Filter out undefined values from process.env
    const cleanEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        cleanEnv[key] = value
      }
    }
    this.sessionEnv = {
      ...cleanEnv,
      ...this.config.environment,
    }
  }

  async start(): Promise<void> {
    this.logger.info('Simple bash session initialized', {
      workingDirectory: this.sessionCwd,
    })
  }

  async stop(): Promise<void> {
    this.logger.info('Simple bash session stopped')
  }

  /**
   * Execute a command with session state preservation
   */
  async exec(
    command: string,
    callbacks: StreamingCallbacks = {}
  ): Promise<CommandResult> {
    this.logger.info('Executing command', { command, cwd: this.sessionCwd })

    // Handle special commands that modify session state
    const stateChanged = await this.handleStateCommands(command)
    if (stateChanged) {
      return stateChanged
    }

    // Build the actual command with session state
    const wrappedCommand = this.wrapCommand(command)

    return new Promise(resolve => {
      let stdout = ''
      let stderr = ''
      let processExited = false
      let timeoutHandle: NodeJS.Timeout | undefined

      // Spawn the command
      const proc = spawn('bash', ['-c', wrappedCommand], {
        cwd: this.sessionCwd,
        env: this.sessionEnv,
        // Don't use shell: true since we're already using bash -c
      })

      // Set up timeout
      timeoutHandle = setTimeout(() => {
        if (!processExited) {
          proc.kill('SIGKILL')
          const error = new Error(
            `Command timed out after ${this.config.timeout}ms`
          )
          callbacks.onError?.(error)
          resolve({
            success: false,
            exitCode: null,
            stdout,
            stderr,
            error: error.message,
          })
        }
      }, this.config.timeout)

      // Handle stdout
      proc.stdout.on('data', data => {
        const chunk = data.toString()
        stdout += chunk
        callbacks.onStdout?.(chunk)
      })

      // Handle stderr
      proc.stderr.on('data', data => {
        const chunk = data.toString()
        stderr += chunk
        callbacks.onStderr?.(chunk)
      })

      // Handle exit
      proc.on('exit', (code, signal) => {
        processExited = true
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }

        callbacks.onExit?.(code, signal)

        // Capture any environment variable changes if we can
        this.captureStateChanges(stdout)

        resolve({
          success: code === 0,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: code !== 0 ? `Process exited with code ${code}` : undefined,
        })
      })

      // Handle errors
      proc.on('error', error => {
        processExited = true
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }

        callbacks.onError?.(error)
        resolve({
          success: false,
          exitCode: null,
          stdout,
          stderr,
          error: error.message,
        })
      })
    })
  }

  /**
   * Handle commands that change session state
   */
  private async handleStateCommands(
    command: string
  ): Promise<CommandResult | null> {
    const trimmed = command.trim()

    // Handle cd command
    if (trimmed.startsWith('cd ')) {
      const dir = trimmed.substring(3).trim()
      const targetDir = this.resolvePath(dir)

      // Verify the directory exists
      const { exitCode } = await this.execRaw(`test -d "${targetDir}"`)
      if (exitCode === 0) {
        this.sessionCwd = targetDir
        return {
          success: true,
          exitCode: 0,
          stdout: '',
          stderr: '',
        }
      } else {
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: `cd: ${dir}: No such file or directory`,
          error: 'Directory not found',
        }
      }
    }

    // Handle export command
    if (trimmed.startsWith('export ')) {
      const exportCmd = trimmed.substring(7).trim()
      const match = exportCmd.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (match) {
        const [, name, value] = match
        if (name && value) {
          // Remove quotes if present
          const cleanValue = value.replace(/^["']|["']$/g, '')
          this.sessionExports[name] = cleanValue
          this.sessionEnv[name] = cleanValue
          return {
            success: true,
            exitCode: 0,
            stdout: '',
            stderr: '',
          }
        }
      }
    }

    // Handle alias command
    if (trimmed.startsWith('alias ')) {
      const aliasCmd = trimmed.substring(6).trim()
      const match = aliasCmd.match(/^([^=]+)=(.*)$/)
      if (match) {
        const [, name, value] = match
        if (name && value) {
          this.sessionAliases.set(name, value.replace(/^["']|["']$/g, ''))
          return {
            success: true,
            exitCode: 0,
            stdout: '',
            stderr: '',
          }
        }
      }
    }

    return null
  }

  /**
   * Wrap command with session state (exports, aliases, etc.)
   */
  private wrapCommand(command: string): string {
    let wrapped = ''

    // Apply exports
    for (const [key, value] of Object.entries(this.sessionExports)) {
      wrapped += `export ${key}="${value}"; `
    }

    // Apply aliases (note: aliases don't work in non-interactive bash by default)
    // We'd need to expand them manually or use bash -i which has other issues

    // Add the actual command
    wrapped += command

    return wrapped
  }

  /**
   * Execute a raw command without state handling (internal use)
   */
  private execRaw(command: string): Promise<{ exitCode: number | null }> {
    return new Promise(resolve => {
      const proc = spawn('bash', ['-c', command], {
        cwd: this.sessionCwd,
        env: this.sessionEnv,
      })

      proc.on('exit', code => {
        resolve({ exitCode: code })
      })

      proc.on('error', () => {
        resolve({ exitCode: -1 })
      })
    })
  }

  /**
   * Resolve a path relative to current directory
   */
  private resolvePath(path: string): string {
    if (path.startsWith('/')) {
      return path
    }
    if (path === '~' || path.startsWith('~/')) {
      const home = this.sessionEnv.HOME || process.env.HOME || '/'
      return path === '~' ? home : path.replace('~', home)
    }
    if (path === '-') {
      // TODO: Track OLDPWD
      return this.sessionCwd
    }

    // Handle relative paths
    const parts = this.sessionCwd.split('/').filter(Boolean)
    const pathParts = path.split('/')

    for (const part of pathParts) {
      if (part === '..') {
        parts.pop()
      } else if (part !== '.' && part !== '') {
        parts.push(part)
      }
    }

    return '/' + parts.join('/')
  }

  /**
   * Try to capture state changes from command output
   * (This is a best-effort approach)
   */
  private captureStateChanges(_output: string): void {
    // Look for common patterns that indicate state changes
    // This is limited but can catch some cases
    // Check if pwd was called and update cwd
    // const pwdMatch = output.match(/^(\/[^\n]*)/m)
    // if (pwdMatch && output.split('\n').length === 1) {
    //   // Single line output that looks like a path, might be pwd
    //   // We could verify this is a real path, but that's expensive
    // }
  }

  writeInput(_input: string): void {
    throw new Error(
      'writeInput not supported in SimpleBashSession - use exec() instead'
    )
  }
}
