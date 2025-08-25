import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (message.trim() && !disabled) {
        onSendMessage(message.trim());
        setMessage('');
      }
    }
  };

  return (
    <div className="border-t border-border bg-card/50 backdrop-blur-sm">
      <div className="container mx-auto p-4">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <Textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled
                ? 'Connecting...'
                : 'Type your message... (Enter to send, Ctrl+Enter for newline)'
            }
            disabled={disabled}
            rows={3}
            className="min-h-[80px] resize-none shadow-sm bg-background/50"
          />
          <div className="flex flex-col justify-end">
            <Button
              type="submit"
              disabled={disabled || !message.trim()}
              className="h-fit px-6 shadow-lg shadow-primary/20"
            >
              <span className="hidden sm:inline">Send</span>
              <span className="sm:hidden">⚡</span>
            </Button>
          </div>
        </form>

        {/* Terminal-style hint */}
        <div className="mt-2 text-xs text-muted-foreground font-mono opacity-60">
          {'>'} Ready for input...
        </div>
      </div>
    </div>
  );
};

export default MessageInput;
