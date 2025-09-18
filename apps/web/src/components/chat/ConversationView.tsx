import {
  Check,
  MoreHorizontal,
  Send,
  Wifi,
  WifiOff,
  X as XIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConversationTitle } from '@/components/ui/ConversationTitle'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  DEFAULT_MODEL,
  MODEL_DISPLAY_NAMES,
  SUPPORTED_MODELS,
  type SupportedModel,
} from '@/constants/models'
import { useConversationStream } from '@/hooks/useConversationStream'
import { conversationService } from '@/services/conversationService'
import { conversationStreamClient } from '@/services/conversationStreamClient'
import type { Message } from '@/types/conversation'
import { MessageBubble } from './MessageBubble'

const STREAM_USER_ID = 1 // TODO: Replace once auth is wired

interface ConversationViewProps {
  conversationId?: number
  onConversationCreate?: (conversationId: number) => void
  onTitleUpdate?: () => void
}

export function ConversationView({
  conversationId,
  onConversationCreate,
  onTitleUpdate,
}: ConversationViewProps) {
  const [inputValue, setInputValue] = useState('')
  const [selectedModel, setSelectedModel] =
    useState<SupportedModel>(DEFAULT_MODEL)
  const [currentConversationId, setCurrentConversationId] = useState<
    number | null
  >(conversationId ?? null)
  const [conversationTitle, setConversationTitle] = useState('New Conversation')
  const [shouldAnimateTitle, setShouldAnimateTitle] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitle, setEditingTitle] = useState('')

  const [isSending, setIsSending] = useState(false)
  const previousTitleRef = useRef<string | null>(null)

  useEffect(() => {
    setCurrentConversationId(conversationId ?? null)
  }, [conversationId])

  const {
    status: streamStatus,
    conversation: streamConversation,
    messages: streamMessages,
    error: streamError,
    isStreaming,
  } = useConversationStream({
    conversationId: currentConversationId,
    userId: STREAM_USER_ID,
    client: conversationStreamClient,
  })

  const messages = streamMessages

  const canInteractWithStream =
    currentConversationId == null || streamStatus === 'ready'
  const isConnected = streamStatus === 'ready'
  const isLoadingConversation = streamStatus === 'loading'
  const conversationError = streamError

  useEffect(() => {
    if (isEditingTitle) return

    if (!currentConversationId) {
      previousTitleRef.current = null
      setConversationTitle('New Conversation')
      return
    }

    if (!streamConversation) {
      setConversationTitle(prev =>
        prev === 'New Conversation' ? 'Conversation' : prev
      )
      return
    }

    const incomingTitle = streamConversation.title?.trim().length
      ? streamConversation.title.trim()
      : 'Conversation'

    if (
      previousTitleRef.current &&
      previousTitleRef.current !== incomingTitle
    ) {
      setShouldAnimateTitle(true)
    }

    previousTitleRef.current = incomingTitle
    setConversationTitle(incomingTitle)
  }, [streamConversation, currentConversationId, isEditingTitle])

  useEffect(() => {
    if (!shouldAnimateTitle) return
    const timer = window.setTimeout(() => setShouldAnimateTitle(false), 200)
    return () => window.clearTimeout(timer)
  }, [shouldAnimateTitle])

  const statusLabel = useMemo(() => {
    if (isStreaming) return 'AI is typing...'
    if (isConnected) return 'Ready'
    if (currentConversationId == null) return 'Awaiting first message'
    if (streamStatus === 'loading') return 'Loading...'
    if (streamStatus === 'error') return 'Disconnected'
    return 'Idle'
  }, [isStreaming, isConnected, currentConversationId, streamStatus])

  const handleSend = async () => {
    if (!inputValue.trim() || isStreaming || isSending) return

    setIsSending(true)
    try {
      let conversationIdToUse = currentConversationId

      if (!conversationIdToUse) {
        const newConv = await conversationService.createConversation()
        conversationIdToUse = newConv.id
        setCurrentConversationId(conversationIdToUse)
        onConversationCreate?.(conversationIdToUse)
      }

      await conversationService.sendMessage(
        conversationIdToUse,
        inputValue,
        selectedModel
      )
      setInputValue('')
    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleTitleEditStart = () => {
    setIsEditingTitle(true)
    setEditingTitle(conversationTitle)
  }

  const handleTitleEditSave = async () => {
    if (!currentConversationId || editingTitle.trim() === '') {
      return
    }

    try {
      await conversationService.updateTitle(
        currentConversationId,
        editingTitle.trim()
      )
      setConversationTitle(editingTitle.trim())
      setIsEditingTitle(false)
      setEditingTitle('')
      setShouldAnimateTitle(true)
      onTitleUpdate?.()
    } catch (error) {
      console.error('Failed to update conversation title:', error)
      alert('Failed to update title. Please try again.')
    }
  }

  const handleTitleEditCancel = () => {
    setIsEditingTitle(false)
    setEditingTitle('')
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleTitleEditSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleTitleEditCancel()
    }
  }

  const retryLoadConversation = () => {
    // TODO: Implement retry logic if needed
  }

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
                    onChange={e => setEditingTitle(e.target.value)}
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
                  onClick={
                    currentConversationId &&
                    conversationTitle !== 'New Conversation'
                      ? handleTitleEditStart
                      : undefined
                  }
                  className={`${
                    currentConversationId &&
                    conversationTitle !== 'New Conversation'
                      ? 'cursor-pointer hover:bg-accent/50 rounded px-1 py-0.5 -mx-1 -my-0.5 transition-colors'
                      : ''
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
              {messages.length} messages • {statusLabel}
            </p>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value as SupportedModel)}
              className="text-xs bg-transparent border-none focus:outline-none text-muted-foreground"
            >
              {Object.values(SUPPORTED_MODELS).map(model => (
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
          {isLoadingConversation && (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">
                Loading conversation...
              </div>
            </div>
          )}

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

          {!isLoadingConversation &&
            !conversationError &&
            (messages.length > 0 ? (
              messages.map((message: Message) => (
                <MessageBubble key={message.id} message={message} />
              ))
            ) : (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Start a conversation by sending a message.
              </div>
            ))}
        </div>
      </div>

      <Separator />

      <div className="p-2 sm:p-4 bg-card">
        <div className="max-w-4xl mx-auto flex gap-2">
          <Input
            placeholder="Type your message..."
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            className="flex-1 text-sm"
            disabled={!canInteractWithStream || isStreaming}
          />
          <Button
            onClick={handleSend}
            disabled={
              !inputValue.trim() ||
              !canInteractWithStream ||
              isStreaming ||
              isSending
            }
            size="sm"
            className="px-3"
          >
            <Send className="w-3 h-3 sm:w-4 sm:h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
