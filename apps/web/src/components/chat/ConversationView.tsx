import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DEFAULT_MODEL,
  MODEL_DISPLAY_NAMES,
  SUPPORTED_MODELS,
  type SupportedModel,
} from "@/constants/models";
import { useWebSocket } from "@/hooks/useWebSocket";
import { conversationService } from "@/services/conversationService";
import type { Message } from "@/types/conversation";
import { MoreHorizontal, Send, Wifi, WifiOff } from "lucide-react";
import { useCallback, useState, useEffect } from "react";
import { MessageBubble } from "./MessageBubble";

interface ConversationViewProps {
  conversationId?: number;
  onConversationCreate?: (conversationId: number) => void;
}

export function ConversationView({
  conversationId,
  onConversationCreate,
}: ConversationViewProps) {
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedModel, setSelectedModel] =
    useState<SupportedModel>(DEFAULT_MODEL);
  const [currentConversationId, setCurrentConversationId] = useState<
    number | null
  >(conversationId || null);
  const [conversationTitle, setConversationTitle] =
    useState("New Conversation");

  // WebSocket handlers
  const handleTextDelta = useCallback((promptId: number, delta: string) => {
    setMessages((prev) => {
      const existingIndex = prev.findIndex(
        (m) => m.metadata?.promptId === promptId && m.type === "assistant",
      );

      if (existingIndex >= 0) {
        // Update existing message
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          content: updated[existingIndex].content + delta,
        };
        return updated;
      } else {
        // Create new assistant message
        return [
          ...prev,
          {
            id: `assistant-${promptId}`,
            type: "assistant" as const,
            content: delta,
            timestamp: new Date().toISOString(),
            metadata: { promptId },
          },
        ];
      }
    });
  }, []);

  const handleStreamComplete = useCallback((promptId: number) => {
    console.log("Stream completed for prompt:", promptId);
    // TODO: Refresh conversation to get final state
  }, []);

  const handleStreamError = useCallback((promptId: number, error: string) => {
    console.error("Stream error for prompt:", promptId, error);
  }, []);

  const handleSnapshot = useCallback(
    (promptId: number, content: string, state: string) => {
      console.log("Received snapshot for prompt:", promptId, "state:", state);
      setMessages((prev) => {
        const existingIndex = prev.findIndex(
          (m) => m.metadata?.promptId === promptId && m.type === "assistant",
        );

        if (existingIndex >= 0) {
          // Update existing message with snapshot content
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            content: content,
          };
          return updated;
        } else {
          // Create new assistant message from snapshot
          return [
            ...prev,
            {
              id: `assistant-${promptId}`,
              type: "assistant" as const,
              content: content,
              timestamp: new Date().toISOString(),
              metadata: { promptId },
            },
          ];
        }
      });
    },
    [],
  );

  const { sendMessage, subscribe, isConnected, isStreaming } = useWebSocket(
    handleTextDelta,
    handleStreamComplete,
    handleStreamError,
    handleSnapshot,
  );

  // Load conversation on mount
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
      subscribe(currentConversationId);
    }
  }, [currentConversationId, subscribe]);

  const loadConversation = async (id: number) => {
    try {
      console.log("Loading conversation:", id);
      const result = await conversationService.getConversation(id);
      setMessages(formatMessagesFromAPI(result.messages));
      setConversationTitle(result.conversation.title || "Conversation");

      // Check for active streaming - but don't call this immediately
      // Only check if we're not already streaming
      if (!isStreaming) {
        const activeStream = await conversationService.getActiveStream(id);
        if (activeStream.activeStream) {
          console.log("Active stream detected:", activeStream.activeStream);
          // TODO: Handle reconnection to active stream properly
        }
      }
    } catch (error) {
      console.error("Failed to load conversation:", error);
    }
  };

  const formatMessagesFromAPI = (apiMessages: any[]): Message[] => {
    return apiMessages.map((msg) => ({
      id: msg.id.toString(),
      type: msg.role,
      content:
        msg.blocks
          ?.filter((b: any) => b.type === "text")
          .map((b: any) => b.content)
          .join("") || "",
      timestamp: msg.createdAt,
      toolCalls: [], // TODO: Process tool calls from blocks
      metadata: { promptId: msg.promptId },
    }));
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isStreaming) return;

    try {
      let conversationIdToUse = currentConversationId;

      // Create conversation if none exists
      if (!conversationIdToUse) {
        const newConv = await conversationService.createConversation();
        conversationIdToUse = newConv.id;
        setCurrentConversationId(conversationIdToUse);
        // No need to call subscribe here - useEffect will handle it
        onConversationCreate?.(conversationIdToUse);
      }

      // Add user message to UI
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        type: "user",
        content: inputValue,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Send message via WebSocket
      sendMessage(conversationIdToUse, inputValue, selectedModel);
      setInputValue("");
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="border-b px-3 sm:px-4 py-2 sm:py-3 bg-card">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1 ml-10 sm:ml-0">
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-sm sm:text-base truncate">
                {conversationTitle}
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
              onChange={(e) =>
                setSelectedModel(e.target.value as SupportedModel)
              }
              className="text-xs bg-transparent border-none focus:outline-none text-muted-foreground"
            >
              {Object.values(SUPPORTED_MODELS).map((model) => (
                <option key={model} value={model}>
                  {MODEL_DISPLAY_NAMES[model]}
                </option>
              ))}
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
