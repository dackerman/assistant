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
  // Create chronological sequence of messages and tool calls
  const conversationItems: ConversationItem[] = [
    ...messages.map(msg => ({ type: 'message' as const, data: msg })),
    ...toolCalls.map(tool => ({ type: 'tool' as const, data: tool })),
  ].sort((a, b) => {
    // Sort by sequence if available, otherwise by timestamp
    const aSeq = a.data.sequence ?? a.data.timestamp;
    const bSeq = b.data.sequence ?? b.data.timestamp;
    return aSeq - bSeq;
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

  const renderMessage = (message: Message) => (
    <div key={message.id} className={`message ${message.role}`}>
      <div className="message-role">
        {message.role === 'user' ? '👤 You' : '🤖 Claude'}
      </div>
      <div className="message-content">
        {message.content}
        {message.isStreaming && <span className="streaming-cursor">▎</span>}
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
        backgroundColor: '#f8f9fa',
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
          <span style={{ fontSize: '0.8em', opacity: 0.7 }}>
            ({toolCall.status})
          </span>
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
                  backgroundColor: '#e9ecef',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '0.8em',
                  overflow: 'auto',
                  margin: '4px 0',
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
                  backgroundColor: '#e9ecef',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '0.8em',
                  overflow: 'auto',
                  margin: '4px 0',
                  maxHeight: '200px',
                  whiteSpace: 'pre-wrap',
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
              style={{ fontSize: '0.7em', color: '#6c757d', marginTop: '8px' }}
            >
              Call ID: {toolCall.callId}
            </div>
          )}
        </div>
      </details>
    </div>
  );

  return (
    <div className="conversation-view">
      <div className="messages">
        {conversationItems.map(item =>
          item.type === 'message'
            ? renderMessage(item.data)
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
          background: #f8f9fa;
        }
        
        .message.user {
          background: #e3f2fd;
          margin-left: 50px;
        }
        
        .message.assistant {
          background: #f1f8e9;
          margin-right: 50px;
        }
        
        .message-role {
          font-weight: bold;
          margin-bottom: 8px;
          color: #666;
        }
        
        .message-content {
          white-space: pre-wrap;
          line-height: 1.5;
          margin-bottom: 8px;
        }
        
        .streaming-cursor {
          animation: blink 1s infinite;
          color: #007bff;
        }
        
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        
        .message-timestamp {
          font-size: 12px;
          color: #999;
        }
        
        .tool-call-inline summary:hover {
          background-color: rgba(0, 0, 0, 0.05);
          padding: 4px;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};

export default ConversationView;
