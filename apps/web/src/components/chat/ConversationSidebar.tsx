import {
  Check,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
  X,
  X as XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConversationTitle } from '@/components/ui/ConversationTitle'
import {
  type ApiConversation,
  conversationService,
} from '@/services/conversationService'
import type { Conversation } from '@/types/conversation'

interface ConversationSidebarProps {
  currentConversationId?: number
  onConversationSelect: (conversationId: number) => void
  onNewConversation: () => void
  onClose?: () => void
  isOpen: boolean
  onConversationDelete?: (conversationId: number) => void // Add delete callback
}

export function ConversationSidebar({
  currentConversationId,
  onConversationSelect,
  onNewConversation,
  onClose,
  isOpen,
  onConversationDelete,
}: ConversationSidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [titleAnimationTriggers, setTitleAnimationTriggers] = useState<
    Map<string, number>
  >(new Map())
  const [editingConversationId, setEditingConversationId] = useState<
    string | null
  >(null)
  const [editingTitle, setEditingTitle] = useState('')

  const loadConversations = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const result = await conversationService.listConversations()

      // Transform backend format to frontend format
      const formattedConversations: Conversation[] = result.conversations.map(
        (conv: ApiConversation) => ({
          id: conv.id.toString(),
          title: conv.title || 'Untitled Conversation',
          messages: [], // We don't need full messages for the sidebar
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        })
      )

      setConversations(prev => {
        const prevTitleMap = new Map(prev.map(c => [c.id, c.title]))

        setTitleAnimationTriggers(prevTriggers => {
          const formattedIds = new Set(
            formattedConversations.map(conversation => conversation.id)
          )
          let hasChanges = false
          const updatedTriggers = new Map(prevTriggers)

          formattedConversations.forEach(conv => {
            const prevTitle = prevTitleMap.get(conv.id)
            // Trigger animation if title moved away from the placeholder or changed
            if (
              prevTitle &&
              (prevTitle === 'Untitled Conversation' ||
                prevTitle !== conv.title) &&
              conv.title !== 'Untitled Conversation'
            ) {
              const nextCount = (prevTriggers.get(conv.id) || 0) + 1
              if (nextCount !== prevTriggers.get(conv.id)) {
                updatedTriggers.set(conv.id, nextCount)
                hasChanges = true
              }
            }
          })

          prevTriggers.forEach((_, key) => {
            if (!formattedIds.has(key)) {
              updatedTriggers.delete(key)
              hasChanges = true
            }
          })

          return hasChanges ? updatedTriggers : prevTriggers
        })

        return formattedConversations
      })
    } catch (err) {
      console.error('Failed to load conversations:', err)
      setError('Failed to load conversations')
    } finally {
      setIsLoading(false)
    }
  }, [conversationService])

  // Load conversations
  useEffect(() => {
    if (isOpen) {
      loadConversations()
    }
  }, [isOpen, loadConversations])

  const handleConversationClick = (conversationId: string) => {
    console.log('Sidebar: Conversation clicked:', conversationId)
    onConversationSelect(Number(conversationId))
  }

  const handleDeleteClick = async (
    conversationId: string,
    e: React.MouseEvent
  ) => {
    // Stop propagation to prevent conversation selection
    e.stopPropagation()

    const confirmed = window.confirm(
      'Are you sure you want to delete this conversation? This action cannot be undone.'
    )
    if (!confirmed) return

    try {
      await conversationService.deleteConversation(Number(conversationId))

      // Remove from local state
      setConversations(prev => prev.filter(conv => conv.id !== conversationId))

      // Notify parent component about deletion
      onConversationDelete?.(Number(conversationId))
    } catch (error) {
      console.error('Failed to delete conversation:', error)
      alert('Failed to delete conversation. Please try again.')
    }
  }

  const handleEditClick = (
    conversationId: string,
    currentTitle: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation() // Prevent triggering conversation selection
    setEditingConversationId(conversationId)
    setEditingTitle(currentTitle)
  }

  const handleEditSave = async (
    conversationId: string,
    e: React.MouseEvent | React.KeyboardEvent
  ) => {
    e.stopPropagation()

    if (editingTitle.trim() === '') {
      return // Don't allow empty titles
    }

    try {
      // Update the conversation title via API
      await conversationService.updateTitle(
        Number.parseInt(conversationId, 10),
        editingTitle.trim()
      )

      // Update local state
      setConversations(prev =>
        prev.map(c =>
          c.id === conversationId ? { ...c, title: editingTitle.trim() } : c
        )
      )

      // Exit editing mode
      setEditingConversationId(null)
      setEditingTitle('')
    } catch (error) {
      console.error('Failed to update conversation title:', error)
      alert('Failed to update title. Please try again.')
    }
  }

  const handleEditCancel = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    setEditingConversationId(null)
    setEditingTitle('')
  }

  const handleTitleKeyDown = (
    e: React.KeyboardEvent,
    conversationId: string
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleEditSave(conversationId, e)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleEditCancel(e)
    }
  }

  const truncateTitle = (title: string, maxLength = 30) => {
    return title.length > maxLength
      ? title.substring(0, maxLength) + '...'
      : title
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    } else if (diffDays === 1) {
      return 'Yesterday'
    } else if (diffDays < 7) {
      return `${diffDays} days ago`
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  }

  if (!isOpen) {
    return null
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
            {conversations.map(conversation => (
              <div
                key={conversation.id}
                onClick={() => handleConversationClick(conversation.id)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg p-3 text-sm transition-colors hover:bg-accent group ${
                  currentConversationId?.toString() === conversation.id
                    ? 'bg-accent'
                    : ''
                }`}
              >
                <MessageCircle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 overflow-hidden">
                  {editingConversationId === conversation.id ? (
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={e => setEditingTitle(e.target.value)}
                      onKeyDown={e => handleTitleKeyDown(e, conversation.id)}
                      className="font-medium text-sm w-full bg-transparent border-b border-accent focus:outline-none focus:border-primary"
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <ConversationTitle
                      title={truncateTitle(conversation.title)}
                      className="font-medium truncate"
                      animationTrigger={
                        titleAnimationTriggers.get(conversation.id) || 0
                      }
                      shouldAnimate={false} // Manual edits shouldn't trigger sparkles
                    />
                  )}
                  <div className="text-xs text-muted-foreground">
                    {formatDate(conversation.updatedAt)}
                  </div>
                </div>

                {/* Edit buttons */}
                {editingConversationId === conversation.id ? (
                  <div className="flex flex-shrink-0">
                    <Button
                      onClick={e => handleEditSave(conversation.id, e)}
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 hover:bg-green-100 hover:text-green-600"
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      onClick={handleEditCancel}
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-shrink-0">
                    <Button
                      onClick={e =>
                        handleEditClick(conversation.id, conversation.title, e)
                      }
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-100 hover:text-blue-600"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      onClick={e => handleDeleteClick(conversation.id, e)}
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100 hover:text-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
