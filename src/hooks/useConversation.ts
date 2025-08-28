import { useState, useCallback, useRef, useEffect } from 'react';

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

export const useConversation = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [currentModel, setCurrentModel] = useState({
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
  });
  const [recentModels, setRecentModels] = useState<
    Array<{
      providerId: string;
      modelId: string;
      name: string;
      provider: string;
    }>
  >([]);
  const messageRolesRef = useRef<Map<string, 'user' | 'assistant'>>(new Map());
  const currentAssistantMessage = useRef<string>('');
  const currentMessageId = useRef<string | null>(null);
  const sequenceCounter = useRef<number>(0);
  const hasToolCallsInCurrentTurn = useRef<boolean>(false);

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
        // Handle tool calls
        if (part.type === 'tool') {
          console.log('Processing tool call:', part.tool, part.state?.status);
          hasToolCallsInCurrentTurn.current = true;

          const toolCall: ToolCall = {
            id: part.id,
            messageId: part.messageID,
            name: part.tool || 'Unknown Tool',
            callId: part.callID,
            status: part.state?.status || 'pending',
            input: part.state?.input,
            output: part.state?.output,
            timestamp: Date.now(),
            sequence: sequenceCounter.current++,
          };

          setToolCalls(prev => {
            const existing = prev.find(tool => tool.id === part.id);
            if (existing) {
              return prev.map(tool =>
                tool.id === part.id ? { ...tool, ...toolCall } : tool
              );
            }
            return [...prev, toolCall];
          });
        }
        // Handle text messages
        else if (part.type === 'text' && part.text) {
          const messageId = part.messageID;
          const role = messageRolesRef.current.get(messageId);

          if (role === 'assistant') {
            const shouldCreateNewMessage =
              currentMessageId.current !== messageId ||
              (currentMessageId.current === messageId &&
                hasToolCallsInCurrentTurn.current);

            if (shouldCreateNewMessage) {
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
              hasToolCallsInCurrentTurn.current = false; // Reset flag since we're creating a new message

              setMessages(prev => [
                ...prev,
                {
                  id: `${messageId}-${sequenceCounter.current}`, // Make unique ID when creating new message for same messageId
                  role: 'assistant',
                  content: '',
                  timestamp: Date.now(),
                  sequence: sequenceCounter.current++,
                  isStreaming: true,
                },
              ]);
            }

            // Update content (OpenCode sends full text, not deltas)
            currentAssistantMessage.current = part.text;

            setMessages(prev =>
              prev.map((msg, index) => {
                // Update the last assistant message that's currently streaming
                if (
                  index === prev.length - 1 &&
                  msg.role === 'assistant' &&
                  msg.isStreaming
                ) {
                  return { ...msg, content: currentAssistantMessage.current };
                }
                return msg;
              })
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
                    sequence: sequenceCounter.current++,
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
            messageId: 'assistant', // Default messageId for step-based events
            name: event.properties.step.tool || 'Unknown Tool',
            // description removed
            status: 'running',
            timestamp: Date.now(),
            sequence: sequenceCounter.current++,
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
            prev.map((msg, index) => {
              // Mark the last streaming assistant message as completed
              if (
                index === prev.length - 1 &&
                msg.role === 'assistant' &&
                msg.isStreaming
              ) {
                return { ...msg, isStreaming: false };
              }
              return msg;
            })
          );
          currentMessageId.current = null;
          currentAssistantMessage.current = '';
          hasToolCallsInCurrentTurn.current = false;
        }
        break;
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      try {
        const response = await fetch('/api/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: content,
            providerId: currentModel.providerId,
            modelId: currentModel.modelId,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
      } catch (error) {
        console.error('Failed to send message:', error);
      }
    },
    [currentModel]
  );

  const selectModel = useCallback(
    async (
      providerId: string,
      modelId: string,
      name?: string,
      provider?: string
    ) => {
      try {
        const response = await fetch('/api/models/current', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId, modelId, name, provider }),
        });

        if (response.ok) {
          setCurrentModel({ providerId, modelId });
          // Refresh recent models
          await fetchCurrentModel();
        }
      } catch (error) {
        console.error('Failed to select model:', error);
      }
    },
    []
  );

  const fetchCurrentModel = useCallback(async () => {
    try {
      const response = await fetch('/api/models/current');
      if (response.ok) {
        const data = await response.json();
        setCurrentModel(data.currentModel);
        setRecentModels(data.recentModels);
      }
    } catch (error) {
      console.error('Failed to fetch current model:', error);
    }
  }, []);

  const switchSession = useCallback(async (sessionId: string | null) => {
    try {
      // Clear current state
      setMessages([]);
      setToolCalls([]);
      setEvents([]);
      messageRolesRef.current.clear();
      currentAssistantMessage.current = '';
      currentMessageId.current = null;
      sequenceCounter.current = 0;
      hasToolCallsInCurrentTurn.current = false;

      // Always call the API - passing null creates a new session
      const response = await fetch('/api/sessions/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setCurrentSessionId(data.sessionId);
      setIsSessionReady(true);

      console.log('Switched to session:', data.sessionId);

      // Load previous messages if switching to an existing session
      if (sessionId && sessionId !== null) {
        try {
          const historyResponse = await fetch(
            `/api/sessions/${data.sessionId}`
          );
          if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            if (historyData.messages && historyData.messages.length > 0) {
              // Convert OpenCode message format to frontend format
              const loadedMessages: Message[] = historyData.messages.map(
                (msg: any, index: number) => {
                  // Extract text content from parts
                  const textParts =
                    msg.parts?.filter((part: any) => part.type === 'text') ||
                    [];
                  const content = textParts
                    .map((part: any) => part.text)
                    .join('');

                  return {
                    id: msg.info?.id || `loaded-${index}`,
                    role: msg.info?.role || 'user',
                    content: content,
                    timestamp: msg.info?.time?.created || Date.now(),
                    sequence: index,
                    isStreaming: false,
                  };
                }
              );

              setMessages(loadedMessages);
              sequenceCounter.current = loadedMessages.length;
              console.log('Loaded', loadedMessages.length, 'previous messages');
            }
          }
        } catch (error) {
          console.error('Failed to load session history:', error);
        }
      }
    } catch (error) {
      console.error('Failed to switch session:', error);
    }
  }, []);

  const backToSessions = useCallback(() => {
    setCurrentSessionId(null);
    setIsSessionReady(false);
  }, []);

  useEffect(() => {
    let eventSource: EventSource;

    const initializeEventStream = async () => {
      if (!isSessionReady) return;

      try {
        // Start listening to events
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
        console.error('Failed to initialize event stream:', error);
      }
    };

    initializeEventStream();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [isSessionReady, processEvent]);

  // Load current model when session is ready
  useEffect(() => {
    if (isSessionReady) {
      fetchCurrentModel();
    }
  }, [isSessionReady, fetchCurrentModel]);

  return {
    messages,
    toolCalls,
    events,
    currentSessionId,
    isSessionReady,
    sendMessage,
    switchSession,
    backToSessions,
    currentModel,
    recentModels,
    selectModel,
  };
};
