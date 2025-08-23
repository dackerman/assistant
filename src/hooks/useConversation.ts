import { useState, useCallback, useRef, useEffect } from 'react';

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

export const useConversation = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [messageRoles, setMessageRoles] = useState<
    Map<string, 'user' | 'assistant'>
  >(new Map());
  const currentAssistantMessage = useRef<string>('');
  const currentMessageId = useRef<string | null>(null);

  const processEvent = useCallback(
    (event: any) => {
      setEvents(prev => [...prev, event]);

      switch (event.type) {
        case 'message.updated':
          // Track message roles
          const messageInfo = event.properties?.info;
          if (messageInfo?.id && messageInfo?.role) {
            setMessageRoles(
              prev => new Map(prev.set(messageInfo.id, messageInfo.role))
            );
          }
          break;

        case 'message.part.updated':
          const part = event.properties?.part;
          if (part && part.type === 'text' && part.text && part.messageID) {
            const messageId = part.messageID;
            const role = messageRoles.get(messageId);

            if (role === 'assistant') {
              if (currentMessageId.current !== messageId) {
                // Finish previous message
                if (currentMessageId.current) {
                  setMessages(prev =>
                    prev.map(msg =>
                      msg.id === currentMessageId.current
                        ? { ...msg, isStreaming: false }
                        : msg
                    )
                  );
                }

                // Start new assistant message
                currentMessageId.current = messageId;
                currentAssistantMessage.current = '';

                setMessages(prev => [
                  ...prev,
                  {
                    id: messageId,
                    role: 'assistant',
                    content: '',
                    timestamp: Date.now(),
                    isStreaming: true,
                  },
                ]);
              }

              // Update content (OpenCode sends full text, not deltas)
              currentAssistantMessage.current = part.text;

              setMessages(prev =>
                prev.map(msg =>
                  msg.id === messageId
                    ? { ...msg, content: currentAssistantMessage.current }
                    : msg
                )
              );
            } else if (role === 'user') {
              // Handle user messages
              const existingMessage = messages.find(
                msg => msg.id === messageId
              );
              if (!existingMessage) {
                setMessages(prev => [
                  ...prev,
                  {
                    id: messageId,
                    role: 'user',
                    content: part.text,
                    timestamp: Date.now(),
                  },
                ]);
              }
            }
          }
          break;

        case 'step.started':
          if (event.step_type === 'tool_use') {
            const toolCall: ToolCall = {
              id: event.step_id || `tool-${Date.now()}`,
              name: event.tool_name || 'Unknown Tool',
              description: event.description,
              status: 'running',
              timestamp: Date.now(),
            };
            setToolCalls(prev => [...prev, toolCall]);
          }
          break;

        case 'step.completed':
          setToolCalls(prev =>
            prev.map(tool =>
              tool.id === event.step_id
                ? { ...tool, status: 'completed' }
                : tool
            )
          );
          break;

        case 'step.error':
          setToolCalls(prev =>
            prev.map(tool =>
              tool.id === event.step_id ? { ...tool, status: 'error' } : tool
            )
          );
          break;

        case 'message.completed':
          if (currentMessageId.current) {
            setMessages(prev =>
              prev.map(msg =>
                msg.id === currentMessageId.current
                  ? { ...msg, isStreaming: false }
                  : msg
              )
            );
            currentMessageId.current = null;
            currentAssistantMessage.current = '';
          }
          break;
      }
    },
    [messageRoles, messages]
  );

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setToolCalls([]);

    try {
      const response = await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }, []);

  useEffect(() => {
    // First create a session
    fetch('/api/session', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        console.log('Session created:', data.sessionId);

        // Now start listening to events
        const eventSource = new EventSource('/events');

        eventSource.onmessage = event => {
          try {
            const data = JSON.parse(event.data);
            processEvent(data);
          } catch (error) {
            console.error('Failed to parse event:', error);
          }
        };

        eventSource.onerror = error => {
          console.error('EventSource failed:', error);
        };

        return () => {
          eventSource.close();
        };
      })
      .catch(error => {
        console.error('Failed to create session:', error);
      });
  }, [processEvent]);

  return {
    messages,
    toolCalls,
    events,
    sendMessage,
  };
};
