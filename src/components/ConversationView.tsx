import React from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface ToolCall {
  id: string;
  name: string;
  description?: string;
  status: 'running' | 'completed' | 'error';
  timestamp: number;
}

interface ConversationViewProps {
  messages: Message[];
  toolCalls: ToolCall[];
}

const ConversationView: React.FC<ConversationViewProps> = ({ messages, toolCalls }) => {
  return (
    <div className="conversation-view">
      <div className="messages">
        {messages.map((message) => (
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
            </div>
          </div>
        ))}
      </div>
      
      {toolCalls.length > 0 && (
        <div className="tool-calls">
          <h3>Tool Activity</h3>
          {toolCalls.map((toolCall) => (
            <div key={toolCall.id} className={`tool-call ${toolCall.status}`}>
              <div className="tool-call-header">
                <span className="tool-name">{toolCall.name}</span>
                <span className={`tool-status ${toolCall.status}`}>
                  {toolCall.status === 'running' && '⏳'}
                  {toolCall.status === 'completed' && '✅'}
                  {toolCall.status === 'error' && '❌'}
                  {toolCall.status}
                </span>
              </div>
              {toolCall.description && (
                <div className="tool-description">{toolCall.description}</div>
              )}
            </div>
          ))}
        </div>
      )}
      
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
        
        .tool-calls {
          border-top: 1px solid #ddd;
          padding-top: 15px;
        }
        
        .tool-calls h3 {
          margin: 0 0 10px 0;
          color: #666;
          font-size: 16px;
        }
        
        .tool-call {
          margin-bottom: 10px;
          padding: 10px;
          border-radius: 4px;
          background: #fff3cd;
        }
        
        .tool-call.completed {
          background: #d4edda;
        }
        
        .tool-call.error {
          background: #f8d7da;
        }
        
        .tool-call-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .tool-name {
          font-weight: bold;
        }
        
        .tool-status {
          font-size: 12px;
          padding: 2px 8px;
          border-radius: 12px;
        }
        
        .tool-status.running {
          background: #fff3cd;
          color: #856404;
        }
        
        .tool-status.completed {
          background: #d4edda;
          color: #155724;
        }
        
        .tool-status.error {
          background: #f8d7da;
          color: #721c24;
        }
        
        .tool-description {
          margin-top: 5px;
          font-size: 12px;
          color: #666;
        }
      `}</style>
    </div>
  );
};

export default ConversationView;