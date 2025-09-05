import { Button } from "@/components/ui/button";
import { conversationService } from "@/services/conversationService";
import type { Conversation } from "@/types/conversation";
import { MessageCircle, Plus, X, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

interface ConversationSidebarProps {
  currentConversationId?: number;
  onConversationSelect: (conversationId: number) => void;
  onNewConversation: () => void;
  onClose?: () => void;
  isOpen: boolean;
  refreshTrigger?: number; // Add this to trigger refresh when new conversations are created
  onConversationDelete?: (conversationId: number) => void; // Add delete callback
}

export function ConversationSidebar({
  currentConversationId,
  onConversationSelect,
  onNewConversation,
  onClose,
  isOpen,
  refreshTrigger,
  onConversationDelete,
}: ConversationSidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load conversations
  useEffect(() => {
    if (isOpen) {
      loadConversations();
    }
  }, [isOpen, refreshTrigger]);

  const loadConversations = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await conversationService.listConversations();

      // Transform backend format to frontend format
      const formattedConversations: Conversation[] = result.conversations.map(
        (conv: any) => ({
          id: conv.id.toString(),
          title: conv.title || "New Conversation",
          messages: [], // We don't need full messages for the sidebar
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        }),
      );

      setConversations(formattedConversations);
    } catch (err) {
      console.error("Failed to load conversations:", err);
      setError("Failed to load conversations");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConversationClick = (conversationId: string) => {
    console.log("Sidebar: Conversation clicked:", conversationId);
    onConversationSelect(Number(conversationId));
  };

  const handleDeleteClick = async (conversationId: string, e: React.MouseEvent) => {
    // Stop propagation to prevent conversation selection
    e.stopPropagation();
    
    const confirmed = window.confirm("Are you sure you want to delete this conversation? This action cannot be undone.");
    if (!confirmed) return;

    try {
      await conversationService.deleteConversation(Number(conversationId));
      
      // Remove from local state
      setConversations(prev => prev.filter(conv => conv.id !== conversationId));
      
      // Notify parent component about deletion
      onConversationDelete?.(Number(conversationId));
    } catch (error) {
      console.error("Failed to delete conversation:", error);
      alert("Failed to delete conversation. Please try again.");
    }
  };

  const truncateTitle = (title: string, maxLength = 30) => {
    return title.length > maxLength
      ? title.substring(0, maxLength) + "..."
      : title;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="flex h-full w-80 flex-col bg-background border-r">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">Conversations</h2>
        <div className="flex items-center gap-2">
          <Button
            onClick={onNewConversation}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
          >
            <Plus className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button
              onClick={onClose}
              variant="ghost"
              size="icon"
              className="h-8 w-8 sm:hidden"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 text-center text-muted-foreground">
            Loading conversations...
          </div>
        )}

        {error && (
          <div className="p-4 text-center text-red-500 text-sm">
            {error}
            <Button
              onClick={loadConversations}
              variant="ghost"
              size="sm"
              className="mt-2 h-8"
            >
              Retry
            </Button>
          </div>
        )}

        {!isLoading && !error && conversations.length === 0 && (
          <div className="p-4 text-center text-muted-foreground">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No conversations yet</p>
            <Button
              onClick={onNewConversation}
              variant="outline"
              size="sm"
              className="mt-3"
            >
              Start your first conversation
            </Button>
          </div>
        )}

        {!isLoading && !error && conversations.length > 0 && (
          <div className="p-2">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                onClick={() => handleConversationClick(conversation.id)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg p-3 text-sm transition-colors hover:bg-accent group ${
                  currentConversationId?.toString() === conversation.id
                    ? "bg-accent"
                    : ""
                }`}
              >
                <MessageCircle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 overflow-hidden">
                  <div className="font-medium truncate">
                    {truncateTitle(conversation.title)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(conversation.updatedAt)}
                  </div>
                </div>
                <Button
                  onClick={(e) => handleDeleteClick(conversation.id, e)}
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100 hover:text-red-600 flex-shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
