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
  const messageRolesRef = useRef<Map<string, 'user' | 'assistant'>>(new Map());
  const currentAssistantMessage = useRef<string>('');
  const currentMessageId = useRef<string | null>(null);

  const processEvent = useCallback((event: any) => {
    setEvents(prev => [...prev, event]);

    switch (event.type) {
      case 'message.updated':
        // Track message roles
        const messageInfo = event.properties?.info;
        if (messageInfo?.id && messageInfo?.role) {
          messageRolesRef.current.set(messageInfo.id, messageInfo.role);
          console.log('Stored message role:', messageInfo.id, messageInfo.role);
        }
        break;

      case 'message.part.updated':
        const part = event.properties?.part;
        if (part && part.type === 'text' && part.text && part.messageID) {
          const messageId = part.messageID;
          const role = messageRolesRef.current.get(messageId);

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
            // Handle user messages - check if message already exists
            setMessages(prev => {
              const existingMessage = prev.find(msg => msg.id === messageId);
              if (!existingMessage) {
                return [
                  ...prev,
                  {
                    id: messageId,
                    role: 'user',
                    content: part.text,
                    timestamp: Date.now(),
                  },
                ];
              }
              return prev;
            });
          }
        }
        break;

      case 'step.started':
        if (event.properties?.step?.type === 'tool_use') {
          const toolCall: ToolCall = {
            id: event.properties.step.id || `tool-${Date.now()}`,
            name: event.properties.step.tool || 'Unknown Tool',
            description: event.properties.step.description,
            status: 'running',
            timestamp: Date.now(),
          };
          setToolCalls(prev => [...prev, toolCall]);
        }
        break;

      case 'step.completed':
        setToolCalls(prev =>
          prev.map(tool =>
            tool.id === event.properties?.step?.id
              ? { ...tool, status: 'completed' }
              : tool
          )
        );
        break;

      case 'step.error':
        setToolCalls(prev =>
          prev.map(tool =>
            tool.id === event.properties?.step?.id
              ? { ...tool, status: 'error' }
              : tool
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
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    // Clear tool calls for new conversation turn
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
    let eventSource: EventSource;

    const initializeSession = async () => {
      try {
        // First create a session
        const sessionRes = await fetch('/api/session', { method: 'POST' });
        const sessionData = await sessionRes.json();
        console.log('Session created:', sessionData.sessionId);

        // Now start listening to events
        eventSource = new EventSource('/events');

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

        eventSource.onopen = () => {
          console.log('EventSource connected');
        };
      } catch (error) {
        console.error('Failed to initialize session:', error);
      }
    };

    initializeSession();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  return {
    messages,
    toolCalls,
    events,
    sendMessage,
  };
};
