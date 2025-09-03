import { useEffect, useRef, useState } from "react";
import type { Message } from "@/types/conversation";

interface WebSocketMessage {
  type: "stream_start" | "stream_text" | "stream_end" | "error" | "tool_call";
  messageId?: string;
  text?: string;
  error?: string;
  toolCall?: any;
}

interface UseWebSocketReturn {
  sendMessage: (messages: Message[], model?: string) => void;
  isConnected: boolean;
  isStreaming: boolean;
}

export function useWebSocket(
  onMessageUpdate: (messageId: string, text: string) => void,
  onStreamEnd: (messageId: string) => void,
  onError: (error: string) => void,
  onToolCall?: (messageId: string, toolCall: any) => void,
): UseWebSocketReturn {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const currentTextRef = useRef<string>("");

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
      };

      ws.current.onmessage = (event) => {
        const data: WebSocketMessage = JSON.parse(event.data);

        switch (data.type) {
          case "stream_start":
            if (data.messageId) {
              setIsStreaming(true);
              currentTextRef.current = "";
            }
            break;

          case "stream_text":
            if (data.messageId && data.text) {
              currentTextRef.current += data.text;
              onMessageUpdate(data.messageId, currentTextRef.current);
            }
            break;

          case "stream_end":
            if (data.messageId) {
              setIsStreaming(false);
              onStreamEnd(data.messageId);
            }
            break;

          case "tool_call":
            if (data.messageId && data.toolCall && onToolCall) {
              onToolCall(data.messageId, data.toolCall);
            }
            break;

          case "error":
            setIsStreaming(false);
            onError(data.error || "Unknown error");
            break;
        }
      };

      ws.current.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        setIsStreaming(false);
        setTimeout(connect, 3000);
      };

      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error);
        onError("Connection error");
      };
    };

    connect();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [onMessageUpdate, onStreamEnd, onError]);

  const sendMessage = (messages: Message[], model?: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      const assistantMessageId = `assistant-${Date.now()}`;
      ws.current.send(
        JSON.stringify({
          type: "chat",
          messages: messages.map((msg) => ({
            role: msg.type === "user" ? "user" : "assistant",
            content: msg.content,
          })),
          messageId: assistantMessageId,
          model,
        }),
      );
      return assistantMessageId;
    }
    return null;
  };

  return {
    sendMessage,
    isConnected,
    isStreaming,
  };
}
