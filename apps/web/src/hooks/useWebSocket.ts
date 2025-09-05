import { useEffect, useRef, useState, useCallback } from "react";

interface UseWebSocketReturn {
  sendMessage: (
    conversationId: number,
    content: string,
    model?: string,
  ) => void;
  subscribe: (conversationId: number) => void;
  isConnected: boolean;
  isStreaming: boolean;
}

interface WebSocketMessage {
  type: string;
  promptId?: number;
  delta?: string;
  error?: string;
  conversationId?: number;
  currentState?: string;
  content?: string;
}

export function useWebSocket(
  onTextDelta: (promptId: number, delta: string) => void,
  onStreamComplete: (promptId: number) => void,
  onStreamError: (promptId: number, error: string) => void,
  onSnapshotReceived?: (
    promptId: number,
    content: string,
    state: string,
  ) => void,
): UseWebSocketReturn {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const lastConversationId = useRef<number | null>(null);

  // Use refs to access latest callbacks without making them dependencies
  const onTextDeltaRef = useRef(onTextDelta);
  const onStreamCompleteRef = useRef(onStreamComplete);
  const onStreamErrorRef = useRef(onStreamError);
  const onSnapshotReceivedRef = useRef(onSnapshotReceived);

  // Update refs when callbacks change
  onTextDeltaRef.current = onTextDelta;
  onStreamCompleteRef.current = onStreamComplete;
  onStreamErrorRef.current = onStreamError;
  onSnapshotReceivedRef.current = onSnapshotReceived;

  useEffect(() => {
    const connect = () => {
      const wsHost =
        window.location.hostname === "localhost"
          ? "localhost"
          : window.location.hostname;
      ws.current = new WebSocket(`ws://${wsHost}:4001`);

      ws.current.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        // Resubscribe if we had an active conversation
        if (lastConversationId.current != null) {
          ws.current?.send(
            JSON.stringify({
              type: "subscribe",
              conversationId: lastConversationId.current,
            }),
          );
        }
      };

      ws.current.onmessage = (event) => {
        const data: WebSocketMessage = JSON.parse(event.data);

        switch (data.type) {
          case "text_delta":
            if (data.promptId && data.delta) {
              setIsStreaming(true);
              onTextDeltaRef.current(data.promptId, data.delta);
            }
            break;

          case "stream_complete":
            if (data.promptId) {
              setIsStreaming(false);
              onStreamCompleteRef.current(data.promptId);
            }
            break;

          case "stream_error":
            if (data.promptId) {
              setIsStreaming(false);
              onStreamErrorRef.current(
                data.promptId,
                data.error || "Unknown error",
              );
            }
            break;

          case "snapshot":
            if (data.promptId && data.content && data.currentState) {
              console.log("Received snapshot for prompt:", data.promptId);
              onSnapshotReceivedRef.current?.(
                data.promptId,
                data.content,
                data.currentState,
              );
              // Continue streaming if not in final state
              if (
                data.currentState !== "completed" &&
                data.currentState !== "error"
              ) {
                setIsStreaming(true);
              }
            }
            break;

          case "subscribed":
            console.log("Subscribed to conversation:", data.conversationId);
            break;

          default:
            console.log("Unknown message type:", data.type);
            break;
        }
      };

      ws.current.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        setIsStreaming(false);
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };

      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    };

    connect();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, []); // Remove callback dependencies to prevent reconnection loops

  const sendMessage = useCallback(
    (conversationId: number, content: string, model?: string) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(
          JSON.stringify({
            type: "send_message",
            conversationId,
            content,
            model,
          }),
        );
      }
    },
    [],
  );

  const subscribe = useCallback((conversationId: number) => {
    lastConversationId.current = conversationId;
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(
        JSON.stringify({
          type: "subscribe",
          conversationId,
        }),
      );
    }
  }, []);

  return {
    sendMessage,
    subscribe,
    isConnected,
    isStreaming,
  };
}
