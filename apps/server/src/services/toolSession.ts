import type { ToolCall } from '../db/schema.js'

export interface ToolResult {
  success: boolean
  output?: string
  error?: string
  metadata?: Record<string, any>
}

export interface ToolSession {
  readonly id: string
  readonly toolType: string
  readonly conversationId: number
  readonly lastActivity: Date

  // Execute a tool call in this session
  execute(toolCall: ToolCall): Promise<ToolResult>

  // Restart/reset the session state
  restart(): Promise<void>

  // Cleanup resources
  cleanup(): Promise<void>

  // Health check
  isHealthy(): Promise<boolean>
}

export interface ToolConfig {
  name: string
  requiresSession: boolean
  sessionType: 'process' | 'memory' | 'http' | 'custom'
  sessionTimeout?: number
  restartable?: boolean
  createSession: (conversationId: number) => ToolSession
}

export abstract class BaseSession implements ToolSession {
  public readonly id: string
  public readonly toolType: string
  public readonly conversationId: number
  public lastActivity: Date

  constructor(toolType: string, conversationId: number) {
    this.toolType = toolType
    this.conversationId = conversationId
    this.id = `${conversationId}:${toolType}`
    this.lastActivity = new Date()
  }

  protected updateActivity(): void {
    this.lastActivity = new Date()
  }

  abstract execute(toolCall: ToolCall): Promise<ToolResult>
  abstract restart(): Promise<void>
  abstract cleanup(): Promise<void>
  abstract isHealthy(): Promise<boolean>
}
