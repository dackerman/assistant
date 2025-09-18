import '@testing-library/jest-dom'
import { vi } from 'vitest'
import { mockConversationService } from './mockConversationService'

// Mock the conversation service module
vi.mock('@/services/conversationService', async importOriginal => {
  const original = (await importOriginal()) as any
  return {
    ...original,
    conversationService: mockConversationService,
    ConversationService: vi
      .fn()
      .mockImplementation(() => mockConversationService),
  }
})
