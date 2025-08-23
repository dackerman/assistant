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
        backgroundColor: '#2d2d30',
        borderTop: '1px solid #3e3e42',
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
          backgroundColor: '#1e1e1e',
          color: '#ffffff',
          border: '1px solid #3e3e42',
          borderRadius: '4px',
          fontSize: '1rem',
        }}
      />
      <button
        type="submit"
        disabled={disabled || !message.trim()}
        style={{
          padding: '0.75rem 1.5rem',
          backgroundColor: disabled || !message.trim() ? '#555' : '#007acc',
          color: '#ffffff',
          border: 'none',
          borderRadius: '4px',
          cursor: disabled || !message.trim() ? 'not-allowed' : 'pointer',
          fontSize: '1rem',
        }}
      >
        Send
      </button>
    </form>
  );
};

export default MessageInput;
