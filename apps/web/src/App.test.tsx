import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationService } from '@/services/conversationService'
import App from './App'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('renders conversation view', () => {
    vi.spyOn(conversationService, 'listConversations').mockResolvedValue({
      conversations: [],
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )
    expect(screen.getByText('New Conversation')).toBeInTheDocument()
    expect(screen.getByText('0 messages • Ready')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Type your message...')
    ).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument()
  })
})
