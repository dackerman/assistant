export interface StreamEvent {
  type: "block_start" | "block_delta" | "block_end";
  blockType?: "text" | "thinking" | "tool_call" | "attachment";
  blockIndex?: number;
  delta?: string;
  metadata?: any;
  toolCallData?: {
    apiToolCallId: string;
    toolName: string;
    request: any;
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
  response?: any;
  error?: string;
}

export interface StreamingOptions {
  onEvent?: (event: StreamEvent) => void;
  onToolCall?: (toolCall: any) => Promise<any>;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}
