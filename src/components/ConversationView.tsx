import React from 'react';

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

  const getToolStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return '#ffa500';
      case 'running':
        return '#007bff';
      case 'completed':
        return '#28a745';
      case 'error':
        return '#dc3545';
      default:
        return '#6c757d';
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
    <div key={message.id} className={`message ${message.role}`}>
      <div className="message-role">
        {message.role === 'user' ? '👤 You' : '🤖 Agent'}
      </div>
      <div className="message-content">
        {message.content}
        {message.role === 'assistant' && isLastAgentMessage && (
          <span className="streaming-cursor">▎</span>
        )}
      </div>
      <div className="message-timestamp">
        {new Date(message.timestamp).toLocaleTimeString()}
        {message.sequence !== undefined && (
          <span style={{ opacity: 0.5, marginLeft: '5px' }}>
            #{message.sequence}
          </span>
        )}
      </div>
    </div>
  );

  const renderToolCall = (toolCall: ToolCall) => (
    <div
      key={toolCall.id}
      className="tool-call-inline"
      style={{
        margin: '8px 0',
        marginLeft: '15px',
        marginRight: '65px',
        padding: '12px',
        backgroundColor: '#21262d',
        border: `1px solid ${getToolStatusColor(toolCall.status)}`,
        borderRadius: '8px',
        borderLeft: `4px solid ${getToolStatusColor(toolCall.status)}`,
      }}
    >
      <details>
        <summary
          style={{
            cursor: 'pointer',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: getToolStatusColor(toolCall.status),
          }}
        >
          <span>{getToolStatusIcon(toolCall.status)}</span>
          <span>🛠️ {getToolTitle(toolCall)}</span>
          {toolCall.sequence !== undefined && (
            <span
              style={{ fontSize: '0.7em', opacity: 0.5, marginLeft: '5px' }}
            >
              #{toolCall.sequence}
            </span>
          )}
        </summary>
        <div style={{ marginTop: '12px', fontSize: '0.9em' }}>
          {toolCall.input && (
            <div style={{ marginBottom: '8px' }}>
              <strong>Input:</strong>
              <pre
                style={{
                  backgroundColor: '#161b22',
                  border: '1px solid #30363d',
                  color: '#e6edf3',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '0.8em',
                  overflow: 'auto',
                  margin: '4px 0',
                  fontFamily:
                    'SF Mono, Monaco, Cascadia Code, Roboto Mono, Consolas, Courier New, monospace',
                }}
              >
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.output && (
            <div>
              <strong>Output:</strong>
              <pre
                style={{
                  backgroundColor: '#161b22',
                  border: '1px solid #30363d',
                  color: '#e6edf3',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '0.8em',
                  overflow: 'auto',
                  margin: '4px 0',
                  maxHeight: '200px',
                  whiteSpace: 'pre-wrap',
                  fontFamily:
                    'SF Mono, Monaco, Cascadia Code, Roboto Mono, Consolas, Courier New, monospace',
                }}
              >
                {typeof toolCall.output === 'string'
                  ? toolCall.output
                  : JSON.stringify(toolCall.output, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.callId && (
            <div
              style={{ fontSize: '0.7em', color: '#8b949e', marginTop: '8px' }}
            >
              Call ID: {toolCall.callId}
            </div>
          )}
        </div>
      </details>
    </div>
  );

  // Find the last assistant message to show cursor only there
  const lastAssistantMessage = messages
    .filter(msg => msg.role === 'assistant')
    .sort(
      (a, b) => (b.sequence || b.timestamp) - (a.sequence || a.timestamp)
    )[0];

  return (
    <div className="conversation-view">
      <div className="messages">
        {conversationItems.map(item =>
          item.type === 'message'
            ? renderMessage(
                item.data,
                item.data.id === lastAssistantMessage?.id
              )
            : renderToolCall(item.data)
        )}
      </div>

      <style>{`
        .conversation-view {
          height: 100%;
          display: flex;
          flex-direction: column;
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
          background: #0d1117;
        }
        
        .messages {
          flex: 1;
          overflow-y: auto;
          margin-bottom: 20px;
        }
        
        .message {
          margin-bottom: 20px;
          padding: 15px;
          border-radius: 8px;
          background: #161b22;
          border: 1px solid #30363d;
        }
        
        .message.user {
          background: #0f2027;
          border: 1px solid #1f6feb;
          margin-left: 50px;
        }
        
        .message.assistant {
          background: #0a2818;
          border: 1px solid #238636;
          margin-right: 50px;
        }
        
        @media (max-width: 768px) {
          .conversation-view {
            padding: 12px;
            max-width: none;
          }
          
          .messages {
            margin-bottom: 16px;
          }
          
          .message {
            margin-bottom: 16px;
            padding: 12px;
            border-radius: 6px;
          }
          
          .message.user {
            margin-left: 8px;
            margin-right: 0;
          }
          
          .message.assistant {
            margin-right: 8px;
            margin-left: 0;
          }
        }
        
        .message-role {
          font-weight: 600;
          margin-bottom: 8px;
          color: #f0f6fc;
          font-size: 14px;
        }
        
        .message-content {
          white-space: pre-wrap;
          line-height: 1.6;
          margin-bottom: 8px;
          color: #e6edf3;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
          font-size: 14px;
        }
        
        .streaming-cursor {
          animation: blink 1s infinite;
          color: #58a6ff;
          font-weight: bold;
        }
        
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        
        .message-timestamp {
          font-size: 11px;
          color: #8b949e;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        }
        
        .tool-call-inline summary:hover {
          background-color: rgba(56, 139, 253, 0.1);
          padding: 4px;
          border-radius: 4px;
        }
        
        @media (max-width: 768px) {
          .tool-call-inline {
            margin: 6px 0 !important;
            margin-left: 8px !important;
            margin-right: 8px !important;
            padding: 10px !important;
            border-radius: 6px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default ConversationView;
