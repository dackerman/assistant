import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ConversationTitle } from "@/components/ui/ConversationTitle";
import {
  DEFAULT_MODEL,
  MODEL_DISPLAY_NAMES,
  SUPPORTED_MODELS,
  type SupportedModel,
} from "@/constants/models";
import { useWebSocket } from "@/hooks/useWebSocket";
import { conversationService } from "@/services/conversationService";
import type { Message } from "@/types/conversation";
import { MoreHorizontal, Send, Wifi, WifiOff, Check, X as XIcon } from "lucide-react";
import { useCallback, useState, useEffect } from "react";
import { MessageBubble } from "./MessageBubble";

interface ConversationViewProps {
  conversationId?: number;
  onConversationCreate?: (conversationId: number) => void;
  onTitleUpdate?: () => void;
}

export function ConversationView({
  conversationId,
  onConversationCreate,
  onTitleUpdate,
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
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [shouldAnimateTitle, setShouldAnimateTitle] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");

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
      console.log("Received snapshot for prompt:", promptId, "state:", state, {
        contentLength: content?.length || 0,
        isStreaming: state === "IN_PROGRESS" || state === "WAITING_FOR_TOOLS"
      });
      
      setMessages((prev) => {
        const existingIndex = prev.findIndex(
          (m) => m.metadata?.promptId === promptId && m.type === "assistant",
        );

        const snapshotMessage = {
          id: `assistant-${promptId}`,
          type: "assistant" as const,
          content: content || "",
          timestamp: new Date().toISOString(),
          metadata: { 
            promptId,
            streamState: state,
          },
        };

        if (existingIndex >= 0) {
          // Update existing message with snapshot content
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            ...snapshotMessage,
            // Preserve original timestamp if it exists
            timestamp: updated[existingIndex].timestamp || snapshotMessage.timestamp,
          };
          return updated;
        } else {
          // Create new assistant message from snapshot
          return [...prev, snapshotMessage];
        }
      });
    },
    [],
  );

  const handleTitleGenerated = useCallback((title: string) => {
    console.log("Title generated:", title);
    setShouldAnimateTitle(true); // Mark that this title change should animate
    setConversationTitle(title);
    // Notify parent component to refresh sidebar
    onTitleUpdate?.();
    // Reset animation flag after the component has had a chance to use it
    setTimeout(() => setShouldAnimateTitle(false), 100);
  }, [onTitleUpdate]);

  const { sendMessage, subscribe, isConnected, isStreaming } = useWebSocket(
    handleTextDelta,
    handleStreamComplete,
    handleStreamError,
    handleSnapshot,
    handleTitleGenerated,
  );

  // Sync internal state with conversation ID prop
  useEffect(() => {
    console.log("ConversationView prop conversationId changed:", conversationId);
    setCurrentConversationId(conversationId || null);
  }, [conversationId]);

  // Load conversation on mount or when ID changes
  useEffect(() => {
    console.log("ConversationView currentConversationId changed:", currentConversationId);
    if (currentConversationId) {
      // Clear any existing error when switching conversations
      setConversationError(null);
      loadConversation(currentConversationId);
      subscribe(currentConversationId);
    } else {
      // Clear messages and error when no conversation selected
      setMessages([]);
      setConversationError(null);
      setConversationTitle("New Conversation");
    }
  }, [currentConversationId, subscribe]);

  const loadConversation = async (id: number) => {
    try {
      setIsLoadingConversation(true);
      setConversationError(null);
      
      console.log("Loading conversation:", id);
      const result = await conversationService.getConversation(id);
      
      if (!result) {
        throw new Error("Conversation not found");
      }
      
      console.log("Backend messages raw data:", result.messages);
      const formattedMessages = formatMessagesFromAPI(result.messages);
      console.log("Formatted messages for UI:", formattedMessages);
      setMessages(formattedMessages);
      setConversationTitle(result.conversation.title || "Conversation");

      // Check for active streaming and restore streaming state
      if (!isStreaming) {
        const activeStreamResult = await conversationService.getActiveStream(id);
        if (activeStreamResult.activeStream) {
          console.log("Active stream detected:", activeStreamResult.activeStream);
          await restoreActiveStream(activeStreamResult.activeStream);
        }
      }
    } catch (error) {
      console.error("Failed to load conversation:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to load conversation";
      setConversationError(errorMessage);
      // Don't clear messages on error - keep existing state
    } finally {
      setIsLoadingConversation(false);
    }
  };

  const retryLoadConversation = () => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  };

  const formatMessagesFromAPI = (apiMessages: any[]): Message[] => {
    return apiMessages.map((msg) => {
      // Combine text blocks for content
      const textContent = msg.blocks
        ?.filter((b: any) => b.type === "text")
        .map((b: any) => b.content || "")
        .join("") || "";

      // Process tool calls from blocks
      const toolCalls: any[] = [];
      const toolResults: any[] = [];
      
      msg.blocks?.forEach((block: any) => {
        if (block.type === "tool_call" && block.toolCall) {
          const toolCall = {
            id: block.toolCall.apiToolCallId || block.id.toString(),
            name: block.toolCall.toolName,
            parameters: block.toolCall.request || {},
            result: block.toolCall.response,
            status: mapToolCallState(block.toolCall.state),
            startTime: block.createdAt,
            endTime: block.toolCall.completedAt,
          };
          
          if (toolCall.status === "completed" && toolCall.result) {
            toolResults.push({
              ...toolCall,
              output: toolCall.result,
            });
          } else {
            toolCalls.push(toolCall);
          }
        }
      });

      return {
        id: msg.id.toString(),
        type: msg.role,
        content: textContent,
        timestamp: msg.createdAt,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        metadata: { 
          promptId: msg.promptId,
          model: msg.model,
        },
      };
    });
  };

  const mapToolCallState = (dbState: string) => {
    switch (dbState) {
      case "created": return "pending";
      case "running": return "running";
      case "completed": return "completed";
      case "failed": 
      case "canceled": return "error";
      default: return "pending";
    }
  };

  const restoreActiveStream = async (activeStream: any) => {
    const { prompt, blocks } = activeStream;
    
    console.log("Restoring active stream:", { 
      promptId: prompt.id, 
      state: prompt.state, 
      blockCount: blocks.length 
    });

    // Build current content from streaming blocks
    const streamingContent = blocks
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.content || "")
      .join("");

    if (streamingContent) {
      // Add or update the assistant message with current streaming content
      const assistantMessage: Message = {
        id: `assistant-${prompt.id}`,
        type: "assistant",
        content: streamingContent,
        timestamp: prompt.createdAt,
        metadata: { 
          promptId: prompt.id,
          model: prompt.model,
        },
      };

      setMessages((prev) => {
        // Check if we already have this assistant message
        const existingIndex = prev.findIndex(
          (m) => m.metadata?.promptId === prompt.id && m.type === "assistant"
        );

        if (existingIndex >= 0) {
          // Update existing message
          const updated = [...prev];
          updated[existingIndex] = assistantMessage;
          return updated;
        } else {
          // Add new assistant message
          return [...prev, assistantMessage];
        }
      });
    }

    // Set streaming state based on prompt state
    if (prompt.state === "IN_PROGRESS") {
      // WebSocket should handle continued streaming
      console.log("Stream is actively IN_PROGRESS - WebSocket will handle updates");
    } else if (prompt.state === "WAITING_FOR_TOOLS") {
      console.log("Stream is waiting for tools - monitoring for completion");
      // Could add UI indicator for tool execution status
    } else {
      console.log(`Stream in ${prompt.state} state - may need manual intervention`);
    }
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

  const handleTitleEditStart = () => {
    setIsEditingTitle(true);
    setEditingTitle(conversationTitle);
  };

  const handleTitleEditSave = async () => {
    if (!currentConversationId || editingTitle.trim() === "") {
      return;
    }

    try {
      await conversationService.updateTitle(currentConversationId, editingTitle.trim());
      setConversationTitle(editingTitle.trim());
      setIsEditingTitle(false);
      setEditingTitle("");
      // Notify parent to refresh sidebar
      onTitleUpdate?.();
    } catch (error) {
      console.error("Failed to update conversation title:", error);
      alert("Failed to update title. Please try again.");
    }
  };

  const handleTitleEditCancel = () => {
    setIsEditingTitle(false);
    setEditingTitle("");
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleEditSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleTitleEditCancel();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="border-b px-3 sm:px-4 py-2 sm:py-3 bg-card">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1 ml-10 sm:ml-0">
            <div className="flex items-center gap-2">
              {isEditingTitle ? (
                <div className="flex items-center gap-1 flex-1">
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    className="font-semibold text-sm sm:text-base bg-transparent border-b border-accent focus:outline-none focus:border-primary min-w-0 flex-1"
                    autoFocus
                  />
                  <Button
                    onClick={handleTitleEditSave}
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 hover:bg-green-100 hover:text-green-600"
                  >
                    <Check className="w-3 h-3" />
                  </Button>
                  <Button
                    onClick={handleTitleEditCancel}
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <XIcon className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <div 
                  onClick={currentConversationId && conversationTitle !== "New Conversation" ? handleTitleEditStart : undefined}
                  className={`${
                    currentConversationId && conversationTitle !== "New Conversation" 
                      ? "cursor-pointer hover:bg-accent/50 rounded px-1 py-0.5 -mx-1 -my-0.5 transition-colors" 
                      : ""
                  }`}
                >
                  <ConversationTitle 
                    title={conversationTitle}
                    className="font-semibold text-sm sm:text-base truncate"
                    shouldAnimate={shouldAnimateTitle}
                  />
                </div>
              )}
              {!isEditingTitle && (
                <>
                  {isConnected ? (
                    <Wifi className="w-3 h-3 text-green-500" />
                  ) : (
                    <WifiOff className="w-3 h-3 text-red-500" />
                  )}
                </>
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
          {/* Loading state */}
          {isLoadingConversation && (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading conversation...</div>
            </div>
          )}

          {/* Error state */}
          {conversationError && !isLoadingConversation && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="text-red-500 mb-2">{conversationError}</div>
              <Button 
                onClick={retryLoadConversation}
                variant="outline" 
                size="sm"
              >
                Retry
              </Button>
            </div>
          )}

          {/* Messages */}
          {!isLoadingConversation && !conversationError && messages.map((message) => (
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
