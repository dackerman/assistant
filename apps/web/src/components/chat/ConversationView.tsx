import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { Conversation, Message } from "@/types/conversation";
import { MessageBubble } from "./MessageBubble";
import { Send, MoreHorizontal, Wifi, WifiOff } from "lucide-react";
import { useState, useCallback } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";

interface ConversationViewProps {
  conversation?: Conversation;
}

export function ConversationView({ conversation }: ConversationViewProps) {
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<Message[]>(
    conversation?.messages || [],
  );

  const handleMessageUpdate = useCallback((messageId: string, text: string) => {
    setMessages((prev) => {
      const existing = prev.find((m) => m.id === messageId);
      if (existing) {
        return prev.map((m) =>
          m.id === messageId ? { ...m, content: text } : m,
        );
      } else {
        return [
          ...prev,
          {
            id: messageId,
            type: "assistant" as const,
            content: text,
            timestamp: new Date().toISOString(),
          },
        ];
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
    handleMessageUpdate,
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
      sendMessage(updatedMessages);
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
