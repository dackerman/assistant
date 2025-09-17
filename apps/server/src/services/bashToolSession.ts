import type { ToolCall } from '../db/schema.js'
import type { Logger } from '../utils/logger.js'
import { BashSession } from './bashSession'
import type { ToolResult, ToolSession } from './toolSession.js'

export class BashToolSession implements ToolSession {
  public readonly id: string = 'bash'
  public readonly toolType: string = 'bash'
  public readonly conversationId: number = 0
  public lastActivity: Date = new Date()

  private bashSession?: BashSession
  private logger: Logger

  constructor(private readonly parentLogger: Logger) {
    this.logger = parentLogger.child({
      service: 'BashToolSession',
    })
  }

  async start(): Promise<void> {
    if (!this.bashSession) {
      this.bashSession = new BashSession(this.logger)
      await this.bashSession.start()
    }
  }

  async stop(): Promise<void> {
    if (this.bashSession) {
      await this.bashSession.stop()
      this.bashSession = undefined
    }
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    if (!this.bashSession) {
      throw new Error('Bash session not started')
    }

    const request = toolCall.input as any
    if (
      !request ||
      typeof request !== 'object' ||
      !('command' in request) ||
      typeof request.command !== 'string'
    ) {
      throw new Error(`Invalid request object: ${JSON.stringify(request)}`)
    }

    const result = await this.bashSession.exec(request.command)

    return {
      success: result.success,
      output: result.stdout.trim(),
      error: !result.success ? result.stderr.trim() : undefined,
    }
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async cleanup(): Promise<void> {
    await this.stop()
  }

  async isHealthy(): Promise<boolean> {
    return this.bashSession?.alive ?? false
  }
}
