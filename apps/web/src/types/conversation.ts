export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "completed" | "error";
  startTime: string;
  endTime?: string;
  providerExecuted?: boolean;
  dynamic?: boolean;
  invalid?: boolean;
  error?: unknown;
}

export interface ToolResult {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  output: unknown;
  status: "completed";
  startTime: string;
  endTime: string;
  result: string;
  providerExecuted?: boolean;
  dynamic?: boolean;
  preliminary?: boolean;
}

export interface ToolError {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  error: unknown;
  status: "error";
  startTime: string;
  endTime: string;
  result: null;
  providerExecuted?: boolean;
  dynamic?: boolean;
}

export interface StreamSource {
  sourceType?: "url" | "document";
  id?: string;
  url?: string;
  title?: string;
  mediaType?: string;
  filename?: string;
}

export interface StreamFile {
  base64: string;
  uint8Array: null;
  mediaType: string;
}

export interface StreamPart {
  type: string;
  messageId: string;
  id?: string;
  text?: string;
  delta?: string;
  toolName?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  toolError?: ToolError;
  source?: StreamSource;
  file?: StreamFile;
  finishReason?: string;
  totalUsage?: Record<string, unknown>;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  warnings?: unknown[];
  error?: string;
  providerMetadata?: Record<string, unknown>;
  providerExecuted?: boolean;
  dynamic?: boolean;
}

export interface Message {
  id: string;
  type: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  toolErrors?: ToolError[];
  sources?: StreamSource[];
  files?: StreamFile[];
  reasoning?: string;
  metadata?: {
    model?: string;
    tokens?: number;
    cost?: number;
    finishReason?: string;
    usage?: Record<string, unknown>;
    promptId?: number;
  };
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}
