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
    </form>
  );
};

export default MessageInput;
