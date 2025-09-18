import type {
  ActiveStream,
  ApiConversation,
  ApiMessage,
  IConversationService,
} from '../services/conversationService'

export class MockConversationService implements IConversationService {
  /**
   * Create a new conversation
   */
  async createConversation(_title?: string): Promise<{ id: number }> {
    return { id: 1 }
  }

  /**
   * Get conversation with all messages and blocks
   */
  async getConversation(conversationId: number): Promise<{
    conversation: ApiConversation
    messages: ApiMessage[]
  }> {
    const mockConversation: ApiConversation = {
      id: conversationId,
      title: 'Mock Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    return {
      conversation: mockConversation,
      messages: [] as ApiMessage[],
    }
  }

  /**
   * Get active stream for conversation
   */
  async getActiveStream(_conversationId: number): Promise<{
    activeStream: ActiveStream | null
  }> {
    return {
      activeStream: null,
    }
  }

  /**
   * Send message to conversation
   */
  async sendMessage(
    _conversationId: number,
    _content: string,
    _model?: string
  ): Promise<{ userMessageId: number; promptId: number }> {
    return {
      userMessageId: 1,
      promptId: 1,
    }
  }

  /**
   * List all conversations
   */
  async listConversations(): Promise<{ conversations: ApiConversation[] }> {
    return { conversations: [] }
  }

  /**
   * Update conversation title
   */
  async updateTitle(_conversationId: number, _title: string): Promise<void> {
    // Mock implementation - no-op
  }

  /**
   * Delete conversation
   */
  async deleteConversation(_conversationId: number): Promise<void> {
    // Mock implementation - no-op
  }
}

export const mockConversationService = new MockConversationService()
