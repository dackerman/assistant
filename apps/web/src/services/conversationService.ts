import type { Conversation, Message } from "@/types/conversation";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4001/api";

export class ConversationService {
  /**
   * Create a new conversation
   */
  async createConversation(title?: string): Promise<{ id: number }> {
    const response = await fetch(`${API_BASE}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    if (!response.ok) {
      throw new Error("Failed to create conversation");
    }

    return response.json();
  }

  /**
   * Get conversation with all messages and blocks
   */
  async getConversation(conversationId: number): Promise<{
    conversation: Conversation;
    messages: Message[];
  }> {
    const response = await fetch(`${API_BASE}/conversations/${conversationId}`);

    if (!response.ok) {
      throw new Error("Failed to get conversation");
    }

    return response.json();
  }

  /**
   * Get active streaming state
   */
  async getActiveStream(conversationId: number): Promise<{
    activeStream: any | null;
  }> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/stream`,
    );

    if (!response.ok) {
      throw new Error("Failed to get active stream");
    }

    return response.json();
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(
    conversationId: number,
    content: string,
    model?: string,
  ): Promise<{ userMessageId: number; promptId: number }> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, model }),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to send message");
    }

    return response.json();
  }

  /**
   * List all conversations
   */
  async listConversations(): Promise<{ conversations: Conversation[] }> {
    const response = await fetch(`${API_BASE}/conversations`);

    if (!response.ok) {
      throw new Error("Failed to list conversations");
    }

    return response.json();
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId: number): Promise<void> {
    const response = await fetch(`${API_BASE}/conversations/${conversationId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete conversation");
    }
  }
}

export const conversationService = new ConversationService();
