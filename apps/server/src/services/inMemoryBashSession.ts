import type { Logger } from '../utils/logger'
import type {
  BashSessionConfig,
  BashSessionLike,
  CommandResult,
  StreamingCallbacks,
} from './bashSession'

type CommandHandler = (
  command: string
) => CommandResult | Promise<CommandResult>

/**
 * Lightweight in-memory implementation of BashSession used for tests.
 * Commands return configurable responses without spawning a PTY.
 */
export class InMemoryBashSession implements BashSessionLike {
  private aliveFlag = false
  private readonly pidValue: number
  private readonly responses = new Map<string, CommandResult | CommandHandler>()

  constructor(
    private readonly logger: Logger,
    private readonly config: BashSessionConfig = {}
  ) {
    this.pidValue = Math.floor(Math.random() * 10000) + 1000
  }

  start(): Promise<void> {
    this.logger.debug?.('Starting in-memory bash session', {
      workingDirectory: this.config.workingDirectory,
    })
    this.aliveFlag = true
    return Promise.resolve()
  }

  stop(): Promise<void> {
    this.logger.debug?.('Stopping in-memory bash session')
    this.aliveFlag = false
    return Promise.resolve()
  }

  async exec(
    command: string,
    callbacks: StreamingCallbacks = {}
  ): Promise<CommandResult> {
    if (!this.aliveFlag) {
      throw new Error('Bash session not started')
    }

    const trimmedCommand = command.trim()
    const handler = this.responses.get(trimmedCommand)

    let result: CommandResult

    if (handler) {
      result =
        typeof handler === 'function'
          ? await handler(trimmedCommand)
          : { ...handler }
    } else {
      // Default behaviour: command succeeds with empty output
      result = {
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
      }
    }

    if (result.stdout) {
      callbacks.onStdout?.(result.stdout)
    }
    if (result.stderr) {
      callbacks.onStderr?.(result.stderr)
    }
    if (!result.success && result.error) {
      callbacks.onError?.(new Error(result.error))
    }
    callbacks.onExit?.(result.exitCode, null)

    return result
  }

  writeInput(input: string): void {
    this.logger.debug?.('In-memory session received input', { input })
  }

  setCommandResponse(
    command: string,
    response: CommandResult | CommandHandler
  ): void {
    this.responses.set(command.trim(), response)
  }

  get alive(): boolean {
    return this.aliveFlag
  }

  get pid(): number | undefined {
    return this.aliveFlag ? this.pidValue : undefined
  }
}
