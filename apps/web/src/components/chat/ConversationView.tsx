import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { Conversation, Message, StreamPart } from "@/types/conversation";
import { MoreHorizontal, Send, Wifi, WifiOff } from "lucide-react";
import { useCallback, useState } from "react";
import { MessageBubble } from "./MessageBubble";

interface ConversationViewProps {
  conversation?: Conversation;
}

export function ConversationView({ conversation }: ConversationViewProps) {
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<Message[]>(
    conversation?.messages || [],
  );
  const [selectedModel, setSelectedModel] = useState(
    "claude-sonnet-4-20250514",
  );

  const handleStreamPart = useCallback((part: StreamPart) => {
    if (!part.messageId) return;

    setMessages((prev) => {
      // Find or create the message
      const existingIndex = prev.findIndex((m) => m.id === part.messageId);
      let currentMessage: Message;

      if (existingIndex >= 0) {
        currentMessage = { ...prev[existingIndex] };
      } else {
        // Create new assistant message
        currentMessage = {
          id: part.messageId,
          type: "assistant" as const,
          content: "",
          timestamp: new Date().toISOString(),
        };
      }

      // Handle different stream part types
      switch (part.type) {
        case "stream_text":
        case "text-delta":
          if (part.text) {
            currentMessage.content += part.text;
          }
          break;

        case "reasoning_delta":
        case "reasoning-delta":
          if (part.text) {
            currentMessage.reasoning =
              (currentMessage.reasoning || "") + part.text;
          }
          break;

        case "tool_call":
        case "tool-call":
          if (part.toolCall) {
            currentMessage.toolCalls = currentMessage.toolCalls
              ? [...currentMessage.toolCalls, part.toolCall]
              : [part.toolCall];
          }
          break;

        case "tool_result":
        case "tool-result":
          if (part.toolResult) {
            currentMessage.toolResults = currentMessage.toolResults
              ? [...currentMessage.toolResults, part.toolResult]
              : [part.toolResult];
          }
          break;

        case "tool_error":
        case "tool-error":
          if (part.toolError) {
            currentMessage.toolErrors = currentMessage.toolErrors
              ? [...currentMessage.toolErrors, part.toolError]
              : [part.toolError];
          }
          break;

        case "source":
          if (part.source) {
            currentMessage.sources = currentMessage.sources
              ? [...currentMessage.sources, part.source]
              : [part.source];
          }
          break;

        case "file":
          if (part.file) {
            currentMessage.files = currentMessage.files
              ? [...currentMessage.files, part.file]
              : [part.file];
          }
          break;

        case "finish":
          if (part.finishReason || part.totalUsage) {
            currentMessage.metadata = {
              ...currentMessage.metadata,
              finishReason: part.finishReason,
              usage: part.totalUsage,
            };
          }
          break;

        // Log other part types for debugging
        default:
          console.log("Unhandled stream part:", part);
          break;
      }

      // Update the messages array
      if (existingIndex >= 0) {
        const newMessages = [...prev];
        newMessages[existingIndex] = currentMessage;
        return newMessages;
      } else {
        return [...prev, currentMessage];
      }
    });
  }, []);

  const handleStreamEnd = useCallback((messageId: string) => {
    console.log("Stream ended for message:", messageId);
  }, []);

  const handleError = useCallback((error: string) => {
    console.error("WebSocket error:", error);
  }, []);

  const { sendMessage, isConnected, isStreaming } = useWebSocket(
    handleStreamPart,
    handleStreamEnd,
    handleError,
  );

  const handleSend = () => {
    if (inputValue.trim() && isConnected && !isStreaming) {
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        type: "user",
        content: inputValue,
        timestamp: new Date().toISOString(),
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      sendMessage(updatedMessages, selectedModel);
      setInputValue("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const title = conversation?.title || "New Conversation";

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="border-b px-3 sm:px-4 py-2 sm:py-3 bg-card">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-sm sm:text-base truncate">
                {title}
              </h1>
              {isConnected ? (
                <Wifi className="w-3 h-3 text-green-500" />
              ) : (
                <WifiOff className="w-3 h-3 text-red-500" />
              )}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {messages.length} messages •{" "}
              {isStreaming ? "AI is typing..." : "Ready"}
            </p>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-xs bg-transparent border-none focus:outline-none text-muted-foreground"
            >
              <option value="gpt-5-chat-latest">GPT-5 Chat Latest</option>
              <option value="gpt-5-2025-08-07">GPT-5 (2025-08-07)</option>
              <option value="gpt-5-nano-2025-08-07">GPT-5 Nano</option>
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-opus-4-1-20250805">Claude Opus 4.1</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="grok-code-fast-1">Grok Code Fast</option>
              <option value="grok-4-latest">Grok 4 Latest</option>
            </select>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9">
            <MoreHorizontal className="w-3 h-3 sm:w-4 sm:h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 sm:px-4 py-2 sm:py-4">
        <div className="max-w-4xl mx-auto space-y-2 sm:space-y-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
      </div>

      <Separator />

      <div className="p-2 sm:p-4 bg-card">
        <div className="max-w-4xl mx-auto flex gap-2">
          <Input
            placeholder="Type your message..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            className="flex-1 text-sm"
            disabled={!isConnected || isStreaming}
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || !isConnected || isStreaming}
            size="sm"
            className="px-3"
          >
            <Send className="w-3 h-3 sm:w-4 sm:h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
