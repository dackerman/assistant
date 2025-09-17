import { useCallback, useEffect, useRef, useState } from 'react'

interface UseWebSocketReturn {
  sendMessage: (conversationId: number, content: string, model?: string) => void
  subscribe: (conversationId: number) => void
  isConnected: boolean
  isStreaming: boolean
}

interface WebSocketMessage {
  type: string
  promptId?: number
  delta?: string
  error?: string
  conversationId?: number
  currentState?: string
  content?: string
  title?: string
  toolCallId?: number
  toolName?: string
  parameters?: Record<string, unknown>
  stream?: 'stdout' | 'stderr'
  exitCode?: number
}

export function useWebSocket(
  onTextDelta: (promptId: number, delta: string) => void,
  onStreamComplete: (promptId: number) => void,
  onStreamError: (promptId: number, error: string) => void,
  onSnapshotReceived?: (
    promptId: number,
    content: string,
    state: string
  ) => void,
  onTitleGenerated?: (title: string) => void,
  onToolCallStarted?: (
    promptId: number,
    toolCallId: number,
    toolName: string,
    parameters: Record<string, unknown>
  ) => void,
  onToolCallOutputDelta?: (
    promptId: number,
    toolCallId: number,
    stream: 'stdout' | 'stderr',
    delta: string
  ) => void,
  onToolCallCompleted?: (
    promptId: number,
    toolCallId: number,
    exitCode: number
  ) => void,
  onToolCallError?: (
    promptId: number,
    toolCallId: number,
    error: string
  ) => void
): UseWebSocketReturn {
  const ws = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const lastConversationId = useRef<number | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isConnectingRef = useRef(false)

  // Use refs to access latest callbacks without making them dependencies
  const onTextDeltaRef = useRef(onTextDelta)
  const onStreamCompleteRef = useRef(onStreamComplete)
  const onStreamErrorRef = useRef(onStreamError)
  const onSnapshotReceivedRef = useRef(onSnapshotReceived)
  const onTitleGeneratedRef = useRef(onTitleGenerated)
  const onToolCallStartedRef = useRef(onToolCallStarted)
  const onToolCallOutputDeltaRef = useRef(onToolCallOutputDelta)
  const onToolCallCompletedRef = useRef(onToolCallCompleted)
  const onToolCallErrorRef = useRef(onToolCallError)

  // Update refs when callbacks change
  onTextDeltaRef.current = onTextDelta
  onStreamCompleteRef.current = onStreamComplete
  onStreamErrorRef.current = onStreamError
  onSnapshotReceivedRef.current = onSnapshotReceived
  onTitleGeneratedRef.current = onTitleGenerated
  onToolCallStartedRef.current = onToolCallStarted
  onToolCallOutputDeltaRef.current = onToolCallOutputDelta
  onToolCallCompletedRef.current = onToolCallCompleted
  onToolCallErrorRef.current = onToolCallError

  useEffect(() => {
    const connect = () => {
      // Prevent multiple simultaneous connection attempts
      if (
        isConnectingRef.current ||
        ws.current?.readyState === WebSocket.CONNECTING
      ) {
        return
      }

      // Clean up any existing connection first
      if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
        ws.current.close()
      }

      isConnectingRef.current = true
      const wsHost =
        window.location.hostname === 'localhost'
          ? 'localhost'
          : window.location.hostname
      ws.current = new WebSocket(`ws://${wsHost}:4001`)

      ws.current.onopen = () => {
        console.log('WebSocket connected')
        isConnectingRef.current = false
        setIsConnected(true)
        // Clear any pending reconnection attempts
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
        // Resubscribe if we had an active conversation
        if (lastConversationId.current != null) {
          ws.current?.send(
            JSON.stringify({
              type: 'subscribe',
              conversationId: lastConversationId.current,
            })
          )
        }
      }

      ws.current.onmessage = event => {
        const data: WebSocketMessage = JSON.parse(event.data)

        switch (data.type) {
          case 'text_delta':
            if (data.promptId && data.delta) {
              setIsStreaming(true)
              onTextDeltaRef.current(data.promptId, data.delta)
            }
            break

          case 'stream_complete':
            if (data.promptId) {
              setIsStreaming(false)
              onStreamCompleteRef.current(data.promptId)
            }
            break

          case 'stream_error':
            if (data.promptId) {
              setIsStreaming(false)
              onStreamErrorRef.current(
                data.promptId,
                data.error || 'Unknown error'
              )
            }
            break

          case 'snapshot':
            if (
              data.promptId &&
              data.content !== undefined &&
              data.currentState
            ) {
              console.log('Received snapshot for prompt:', data.promptId, {
                state: data.currentState,
                contentLength: data.content?.length || 0,
                hasContent: !!data.content,
              })

              onSnapshotReceivedRef.current?.(
                data.promptId,
                data.content,
                data.currentState
              )

              // Set streaming state based on prompt state
              const isActiveState =
                data.currentState === 'IN_PROGRESS' ||
                data.currentState === 'WAITING_FOR_TOOLS'
              setIsStreaming(isActiveState)

              console.log(
                `Snapshot processed - streaming state: ${isActiveState}`
              )
            } else {
              console.warn('Incomplete snapshot data received:', {
                promptId: data.promptId,
                hasContent: data.content !== undefined,
                currentState: data.currentState,
              })
            }
            break

          case 'subscribed':
            console.log('Subscribed to conversation:', data.conversationId)
            break

          case 'title_generated':
            if (data.title) {
              console.log('Title generated:', data.title)
              onTitleGeneratedRef.current?.(data.title)
            }
            break

          case 'tool_call_started':
            if (
              data.promptId &&
              data.toolCallId &&
              data.toolName &&
              data.parameters
            ) {
              console.log('Tool call started:', data.toolName, data.toolCallId)
              onToolCallStartedRef.current?.(
                data.promptId,
                data.toolCallId,
                data.toolName,
                data.parameters
              )
            }
            break

          case 'tool_call_output_delta':
            if (
              data.promptId &&
              data.toolCallId &&
              data.stream &&
              data.delta !== undefined
            ) {
              console.log(
                'Tool call output delta:',
                data.toolCallId,
                data.stream,
                data.delta.length
              )
              onToolCallOutputDeltaRef.current?.(
                data.promptId,
                data.toolCallId,
                data.stream,
                data.delta
              )
            }
            break

          case 'tool_call_completed':
            if (
              data.promptId &&
              data.toolCallId &&
              data.exitCode !== undefined
            ) {
              console.log(
                'Tool call completed:',
                data.toolCallId,
                'exit code:',
                data.exitCode
              )
              onToolCallCompletedRef.current?.(
                data.promptId,
                data.toolCallId,
                data.exitCode
              )
            }
            break

          case 'tool_call_error':
            if (data.promptId && data.toolCallId && data.error) {
              console.log('Tool call error:', data.toolCallId, data.error)
              onToolCallErrorRef.current?.(
                data.promptId,
                data.toolCallId,
                data.error
              )
            }
            break

          default:
            console.log('Unknown message type:', data.type)
            break
        }
      }

      ws.current.onclose = event => {
        console.log('WebSocket disconnected', event.code, event.reason)
        isConnectingRef.current = false
        setIsConnected(false)
        setIsStreaming(false)

        // Only attempt reconnection if it wasn't a deliberate close (code 1000)
        // and we don't already have a reconnection scheduled
        if (event.code !== 1000 && !reconnectTimeoutRef.current) {
          console.log('Scheduling reconnection in 3 seconds...')
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null
            connect()
          }, 3000)
        }
      }

      ws.current.onerror = error => {
        console.error('WebSocket error:', error)
        isConnectingRef.current = false
      }
    }

    connect()

    return () => {
      // Clean up timeouts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      // Close WebSocket connection cleanly
      if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
        ws.current.close(1000, 'Component unmounting')
      }

      isConnectingRef.current = false
    }
  }, []) // Remove callback dependencies to prevent reconnection loops

  const sendMessage = useCallback(
    (conversationId: number, content: string, model?: string) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(
          JSON.stringify({
            type: 'send_message',
            conversationId,
            content,
            model,
          })
        )
      }
    },
    []
  )

  const subscribe = useCallback((conversationId: number) => {
    lastConversationId.current = conversationId
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(
        JSON.stringify({
          type: 'subscribe',
          conversationId,
        })
      )
    }
  }, [])

  return {
    sendMessage,
    subscribe,
    isConnected,
    isStreaming,
  }
}
