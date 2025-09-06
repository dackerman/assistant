export interface StreamEvent {
  type: "block_start" | "block_delta" | "block_end";
  blockType?: "text" | "thinking" | "tool_call" | "attachment";
  blockIndex?: number;
  delta?: string;
  metadata?: Record<string, unknown>;
  toolCallData?: {
    apiToolCallId: string;
    toolName: string;
    request: Record<string, unknown>;
  };
}

export interface ConversationContext {
  conversationId: number;
  userId: number;
  model: string;
  systemMessage?: string;
}

export interface ToolExecutionResult {
  toolCallId: number;
  state: "complete" | "error";
  response?: Record<string, unknown>;
  error?: string;
}

export interface StreamingOptions {
  onEvent?: (event: StreamEvent) => void;
  onToolCall?: (
    toolCall: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}
