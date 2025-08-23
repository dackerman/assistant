import React, { useState } from 'react';

interface MessageInputProps {
  onSendMessage: (text: string) => void;
  disabled?: boolean;
}

const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  disabled = false,
}) => {
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="message-input-form"
      style={{
        padding: '1rem',
        backgroundColor: '#161b22',
        borderTop: '1px solid #30363d',
        display: 'flex',
        gap: '1rem',
      }}
    >
      <input
        type="text"
        value={message}
        onChange={e => setMessage((e.target as HTMLInputElement).value)}
        placeholder={disabled ? 'Connecting...' : 'Type your message...'}
        disabled={disabled}
        className="message-input-field"
        style={{
          flex: 1,
          padding: '0.75rem',
          backgroundColor: '#0d1117',
          color: '#e6edf3',
          border: '1px solid #30363d',
          borderRadius: '6px',
          fontSize: '14px',
          fontFamily:
            'SF Mono, Monaco, Cascadia Code, Roboto Mono, Consolas, Courier New, monospace',
        }}
      />
      <button
        type="submit"
        disabled={disabled || !message.trim()}
        className="message-send-button"
        style={{
          padding: '0.75rem 1.5rem',
          backgroundColor: disabled || !message.trim() ? '#484f58' : '#238636',
          color: '#ffffff',
          border: 'none',
          borderRadius: '6px',
          cursor: disabled || !message.trim() ? 'not-allowed' : 'pointer',
          fontSize: '14px',
          fontWeight: '500',
          fontFamily:
            'SF Mono, Monaco, Cascadia Code, Roboto Mono, Consolas, Courier New, monospace',
          transition: 'background-color 0.2s',
        }}
      >
        Send
      </button>

      <style>{`
        @media (max-width: 768px) {
          .message-input-form {
            padding: 12px 16px !important;
            gap: 12px !important;
            flex-direction: row;
          }
          
          .message-input-field {
            padding: 12px !important;
            font-size: 16px !important; /* Prevents zoom on iOS */
            border-radius: 8px !important;
          }
          
          .message-send-button {
            padding: 12px 20px !important;
            font-size: 14px !important;
            border-radius: 8px !important;
            min-width: 60px;
            white-space: nowrap;
          }
        }
        
        @media (max-width: 480px) {
          .message-input-form {
            padding: 10px 12px !important;
            gap: 8px !important;
          }
          
          .message-send-button {
            padding: 12px 16px !important;
            font-size: 13px !important;
          }
        }
      `}</style>
    </form>
  );
};

export default MessageInput;
