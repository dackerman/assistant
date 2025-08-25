import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sequence?: number;
  isStreaming?: boolean;
}

interface ToolCall {
  id: string;
  messageId: string;
  name: string;
  callId?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  input?: any;
  output?: any;
  timestamp: number;
  sequence?: number;
}

interface ConversationViewProps {
  messages: Message[];
  toolCalls: ToolCall[];
}

type ConversationItem =
  | { type: 'message'; data: Message }
  | { type: 'tool'; data: ToolCall };

const ConversationView: React.FC<ConversationViewProps> = ({
  messages,
  toolCalls,
}) => {
  // Create reverse chronological sequence of messages and tool calls (newest first)
  const conversationItems: ConversationItem[] = [
    ...messages.map(msg => ({ type: 'message' as const, data: msg })),
    ...toolCalls.map(tool => ({ type: 'tool' as const, data: tool })),
  ].sort((a, b) => {
    // Sort by sequence if available, otherwise by timestamp (reversed for newest first)
    const aSeq = a.data.sequence ?? a.data.timestamp;
    const bSeq = b.data.sequence ?? b.data.timestamp;
    return bSeq - aSeq;
  });

  const getToolStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'running':
        return '🔄';
      case 'completed':
        return '✅';
      case 'error':
        return '❌';
      default:
        return '❓';
    }
  };

  const getToolTitle = (toolCall: ToolCall) => {
    const { name, input } = toolCall;

    switch (name) {
      case 'bash':
        return input?.command ? `bash: ${input.command}` : 'bash';
      case 'read':
        return input?.filePath
          ? `read: ${input.filePath.split('/').pop()}`
          : 'read';
      case 'write':
        return input?.filePath
          ? `write: ${input.filePath.split('/').pop()}`
          : 'write';
      case 'edit':
        return input?.filePath
          ? `edit: ${input.filePath.split('/').pop()}`
          : 'edit';
      case 'glob':
        return input?.pattern ? `glob: ${input.pattern}` : 'glob';
      case 'grep':
        return input?.pattern ? `grep: ${input.pattern}` : 'grep';
      case 'list':
        return input?.path
          ? `list: ${input.path.split('/').pop() || '/'}`
          : 'list';
      case 'todowrite':
        return 'todo: update tasks';
      case 'todoread':
        return 'todo: read tasks';
      case 'webfetch':
        return input?.url ? `web: ${new URL(input.url).hostname}` : 'webfetch';
      default:
        return name;
    }
  };

  const renderMessage = (message: Message, isLastAgentMessage: boolean) => (
    <Card
      key={message.id}
      className={`mb-4 ${
        message.role === 'user' ? 'ml-8 bg-muted/30' : 'mr-8 bg-card/80'
      } shadow-sm`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <span className="text-primary">
              {message.role === 'user' ? '>' : '$'}
            </span>
            {message.role === 'user' ? 'USER' : 'AGENT'}
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            {new Date(message.timestamp).toLocaleTimeString()}
            {message.sequence !== undefined && (
              <Badge variant="outline" className="text-xs px-1 py-0">
                #{message.sequence}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="whitespace-pre-wrap font-mono text-sm text-foreground">
          {message.content}
          {message.role === 'assistant' && isLastAgentMessage && (
            <span className="ml-1 text-primary blinking-cursor font-bold">
              ▎
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const renderToolCall = (toolCall: ToolCall) => {
    const statusColors = {
      pending: 'border-yellow-500/50 bg-yellow-500/5',
      running: 'border-blue-500/50 bg-blue-500/5',
      completed: 'border-green-500/50 bg-green-500/5',
      error: 'border-red-500/50 bg-red-500/5',
    };

    const statusVariants = {
      pending: 'outline' as const,
      running: 'secondary' as const,
      completed: 'default' as const,
      error: 'destructive' as const,
    };

    return (
      <Card
        key={toolCall.id}
        className={`mx-4 my-2 ${statusColors[toolCall.status]} border-l-4 shadow-sm`}
      >
        <CardHeader className="pb-2">
          <details className="cursor-pointer">
            <summary className="flex items-center gap-2 font-mono text-sm hover:opacity-80">
              <Badge
                variant={statusVariants[toolCall.status]}
                className="text-xs"
              >
                {getToolStatusIcon(toolCall.status)}{' '}
                {toolCall.status.toUpperCase()}
              </Badge>
              <span className="text-primary">🔧</span>
              <span className="font-semibold">{getToolTitle(toolCall)}</span>
              {toolCall.sequence !== undefined && (
                <Badge variant="outline" className="text-xs px-1 py-0 ml-auto">
                  #{toolCall.sequence}
                </Badge>
              )}
            </summary>

            <CardContent className="pt-3 text-xs space-y-3">
              {toolCall.input && (
                <div>
                  <div className="text-muted-foreground font-semibold mb-1">
                    INPUT:
                  </div>
                  <pre className="bg-background/50 border border-border p-2 rounded text-foreground overflow-auto max-h-32 font-mono text-xs">
                    {JSON.stringify(toolCall.input, null, 2)}
                  </pre>
                </div>
              )}

              {toolCall.output && (
                <div>
                  <div className="text-muted-foreground font-semibold mb-1">
                    OUTPUT:
                  </div>
                  <pre className="bg-background/50 border border-border p-2 rounded text-foreground overflow-auto max-h-48 font-mono text-xs whitespace-pre-wrap">
                    {typeof toolCall.output === 'string'
                      ? toolCall.output
                      : JSON.stringify(toolCall.output, null, 2)}
                  </pre>
                </div>
              )}

              {toolCall.callId && (
                <div className="text-muted-foreground font-mono text-xs">
                  Call ID: {toolCall.callId}
                </div>
              )}
            </CardContent>
          </details>
        </CardHeader>
      </Card>
    );
  };

  // Find the last assistant message to show cursor only there
  const lastAssistantMessage = messages
    .filter(msg => msg.role === 'assistant')
    .sort(
      (a, b) => (b.sequence || b.timestamp) - (a.sequence || a.timestamp)
    )[0];

  return (
    <div className="h-full flex flex-col bg-background">
      <ScrollArea className="flex-1 p-4">
        <div className="max-w-4xl mx-auto space-y-1">
          {conversationItems.map(item =>
            item.type === 'message'
              ? renderMessage(
                  item.data,
                  item.data.id === lastAssistantMessage?.id
                )
              : renderToolCall(item.data)
          )}
          {conversationItems.length === 0 && (
            <div className="text-center py-12 text-muted-foreground font-mono">
              <div className="text-2xl mb-2">⚡</div>
              <div className="text-sm">Ready to assist...</div>
              <div className="text-xs mt-1 opacity-60">
                {'>'} Start typing to begin
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ConversationView;
