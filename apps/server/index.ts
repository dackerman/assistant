import { createServer } from "http";
import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import "dotenv/config";

// import { db } from "./src/db";
import { ConversationService } from "./src/services/conversationService";
import { StreamingStateMachine } from "./src/streaming/stateMachine";
import { logger } from "./src/utils/logger";

const app = new Hono();

// Initialize services
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const conversationService = new ConversationService();

// Enable CORS for frontend
app.use(
  "*",
  cors({
    origin: [
      "http://localhost:4000",
      "http://127.0.0.1:4000",
      "http://0.0.0.0:4000",
      "http://homoiconicity:4000",
    ],
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Constants for supported models
const SUPPORTED_MODELS = {
  SONNET_4: "claude-sonnet-4-20250514",
  OPUS_4_1: "claude-opus-4-1-20250805",
} as const;

const DEFAULT_MODEL = SUPPORTED_MODELS.SONNET_4;

// API routes
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    message: "Server is running",
    providers: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    },
    supportedModels: Object.values(SUPPORTED_MODELS),
    defaultModel: DEFAULT_MODEL,
  });
});

// Conversation endpoints
app.post("/api/conversations", async (c) => {
  // TODO: Get userId from auth
  const userId = 1; // Hardcoded for now

  const body = await c.req.json();
  const conversationId = await conversationService.createConversation(
    userId,
    body.title,
  );

  return c.json({ id: conversationId });
});

app.get("/api/conversations/:id", async (c) => {
  const conversationId = Number.parseInt(c.req.param("id"));
  const userId = 1; // TODO: Get from auth

  const conversation = await conversationService.getConversation(
    conversationId,
    userId,
  );

  if (!conversation) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  return c.json(conversation);
});

app.get("/api/conversations/:id/stream", async (c) => {
  const conversationId = Number.parseInt(c.req.param("id"));

  const activeStream =
    await conversationService.getActiveStream(conversationId);

  return c.json({ activeStream });
});

app.post("/api/conversations/:id/messages", async (c) => {
  const conversationId = Number.parseInt(c.req.param("id"));
  const body = await c.req.json();

  // Validate model if provided
  const model = body.model || DEFAULT_MODEL;
  if (!Object.values(SUPPORTED_MODELS).includes(model)) {
    return c.json(
      {
        error: "Unsupported model",
        supportedModels: Object.values(SUPPORTED_MODELS),
      },
      400,
    );
  }

  const result = await conversationService.createUserMessage(
    conversationId,
    body.content,
    model,
  );

  return c.json(result);
});

app.get("/api/conversations", async (c) => {
  const userId = 1; // TODO: Get from auth

  const conversations = await conversationService.listConversations(userId);

  return c.json({ conversations });
});

app.delete("/api/conversations/:id", async (c) => {
  const conversationId = Number.parseInt(c.req.param("id"));
  const userId = 1; // TODO: Get from auth

  try {
    await conversationService.deleteConversation(conversationId, userId);
    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return c.json({ error: "Failed to delete conversation" }, 500);
  }
});

// Serve static files for production (when frontend is built)
app.get("*", (c) => {
  return c.text(
    "API Server - Frontend should be served separately in development",
  );
});

const port = process.env.PORT || 4001;

// Create HTTP server that serves both HTTP and WebSocket
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const request = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body:
      req.method !== "GET" && req.method !== "HEAD"
        ? new ReadableStream({
            start(controller) {
              req.on("data", (chunk) => controller.enqueue(chunk));
              req.on("end", () => controller.close());
              req.on("error", (err) => controller.error(err));
            },
          })
        : undefined,
  });

  try {
    const response = await app.fetch(request);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (response.body) {
      const reader = response.body.getReader();
      const pump = () => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              res.end();
              return;
            }
            res.write(value);
            pump();
          })
          .catch((err) => {
            console.error("Stream error:", err);
            res.end();
          });
      };
      pump();
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Server error:", error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Simple in-memory subscription registry
type OutgoingMessage =
  | { type: "text_delta"; promptId: number; delta: string }
  | { type: "stream_complete"; promptId: number }
  | { type: "stream_error"; promptId: number; error: string }
  | { type: "subscribed"; conversationId: number }
  | {
      type: "snapshot";
      conversationId: number;
      promptId: number;
      currentState: string;
      content: string;
    };

type ClientMessage =
  | {
      type: "send_message";
      conversationId: number;
      content: string;
      model?: string;
    }
  | { type: "subscribe"; conversationId: number };

const subscriptions = new Map<number, Set<WebSocket>>();
const wsToConversations = new Map<WebSocket, Set<number>>();

function broadcast(conversationId: number, payload: OutgoingMessage) {
  const subs = subscriptions.get(conversationId);
  if (!subs) {
    logger.debug(
      `No subscribers for conversation ${conversationId}, skipping broadcast`,
    );
    return;
  }

  const broadcastLogger = logger.child({ conversationId });
  const data = JSON.stringify(payload);
  let sentCount = 0;
  let failedCount = 0;

  for (const client of subs) {
    if (client.readyState === client.OPEN) {
      client.send(data);
      sentCount++;
    } else {
      failedCount++;
    }
  }

  broadcastLogger.debug(`Broadcast ${payload.type}`, {
    totalSubscribers: subs.size,
    sentCount,
    failedCount,
    payloadSize: data.length,
  });
}

wss.on("connection", (ws: WebSocket) => {
  const wsId = Math.random().toString(36).substring(7);
  const wsLogger = logger.child({ wsClientId: wsId });
  wsLogger.wsEvent("connection_established");

  ws.on("message", async (data: RawData) => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;
      wsLogger.wsEvent("message_received", { type: message.type });

      if (message.type === "send_message") {
        const messageLogger = wsLogger.child({
          conversationId: message.conversationId,
          contentLength: message.content.length,
          requestedModel: message.model,
        });

        messageLogger.wsEvent("send_message_request");

        // Validate and normalize model
        const requestedModel = message.model || DEFAULT_MODEL;
        const supportedModelsList = Object.values(SUPPORTED_MODELS);

        if (!supportedModelsList.includes(requestedModel as any)) {
          messageLogger.warn("Unsupported model requested", {
            requestedModel,
            supportedModels: supportedModelsList,
          });

          ws.send(
            JSON.stringify({
              type: "error",
              error: `Unsupported model: ${requestedModel}. Supported models: ${supportedModelsList.join(", ")}`,
            }),
          );
          return;
        }

        // Type assertion is safe here because we validated above
        const model =
          requestedModel as (typeof SUPPORTED_MODELS)[keyof typeof SUPPORTED_MODELS];
        messageLogger.info(`Using model: ${model}`);

        // Create user message and start streaming
        messageLogger.info("Creating user message");
        const result = await conversationService.createUserMessage(
          message.conversationId,
          message.content,
          model,
        );

        messageLogger.info("Starting Anthropic stream", {
          promptId: result.promptId,
        });
        // Start streaming with Anthropic
        await startAnthropicStream(result.promptId, message.conversationId);
      } else if (message.type === "subscribe") {
        const subscribeLogger = wsLogger.child({
          conversationId: message.conversationId,
        });

        subscribeLogger.wsEvent("subscription_request");

        // Subscribe to conversation updates
        const convId: number = message.conversationId;
        const set = subscriptions.get(convId) ?? new Set();
        set.add(ws);
        subscriptions.set(convId, set);
        const wsSet = wsToConversations.get(ws) ?? new Set<number>();
        wsSet.add(convId);
        wsToConversations.set(ws, wsSet);

        subscribeLogger.wsEvent("subscription_confirmed", {
          totalSubscribers: set.size,
        });

        ws.send(
          JSON.stringify({
            type: "subscribed",
            conversationId: convId,
          }),
        );

        // Send snapshot if an active stream exists
        subscribeLogger.info("Checking for active stream");
        const active = await conversationService.getActiveStream(convId);
        if (active) {
          const content = active.blocks
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.content || "")
            .join("");

          subscribeLogger.wsEvent("snapshot_sent", {
            promptId: active.prompt.id,
            currentState: active.prompt.state,
            contentLength: content.length,
            blockCount: active.blocks.length,
          });

          ws.send(
            JSON.stringify({
              type: "snapshot",
              conversationId: convId,
              promptId: active.prompt.id,
              currentState: active.prompt.state,
              content,
            }),
          );
        } else {
          subscribeLogger.info("No active stream found for conversation");
        }
      }
    } catch (error) {
      wsLogger.error("WebSocket message handling error", error);
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        );
      }
    }
  });

  ws.on("close", () => {
    const convs = wsToConversations.get(ws);
    if (convs) {
      wsLogger.wsEvent("connection_cleanup", {
        conversationsCount: convs.size,
        conversationIds: Array.from(convs),
      });

      for (const id of convs) {
        const set = subscriptions.get(id);
        if (set) {
          set.delete(ws);
          wsLogger.debug(
            `Unsubscribed from conversation ${id}, ${set.size} subscribers remaining`,
          );
          if (set.size === 0) {
            subscriptions.delete(id);
            wsLogger.debug(
              `No more subscribers for conversation ${id}, deleted subscription`,
            );
          }
        }
      }
      wsToConversations.delete(ws);
    }
    wsLogger.wsEvent("connection_closed");
  });

  ws.on("error", (error) => {
    wsLogger.error("WebSocket connection error", error);
  });
});

/**
 * Start streaming with Anthropic SDK
 */
async function startAnthropicStream(promptId: number, conversationId: number) {
  const streamLogger = logger.child({ promptId, conversationId });
  streamLogger.info("Starting Anthropic stream");

  const stateMachine = new StreamingStateMachine(promptId);

  try {
    // Get prompt details to retrieve the model
    streamLogger.info("Fetching prompt details");
    const promptDetails = await conversationService.getPromptById(promptId);
    if (!promptDetails) {
      throw new Error(`Prompt ${promptId} not found`);
    }

    const anthropicLogger = streamLogger.child({
      model: promptDetails.model,
      systemMessage: promptDetails.systemMessage?.substring(0, 100) + "...",
    });

    // Get conversation history
    streamLogger.info("Building conversation history from database");

    // TODO: Build proper conversation history from database
    // For now using placeholder - this should call conversationService.buildConversationHistory()
    const messages = await conversationService.buildConversationHistory(
      conversationId,
      1,
    );

    if (messages.length === 1) {
      const userQuery = messages[0]!.content;
      anthropic.messages
        .create({
          model: "claude-3-5-haiku-latest",
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: `Generate a good conversation title for the following query: "${userQuery}"`,
            },
          ],
        })
        .then((response) => {
          const title =
            response.content[0]?.text || "New Conversation (failed)";
          return conversationService.setTitle(conversationId, title);
        })
        .catch((error) => {
          streamLogger.error("Error generating conversation title", error);
        });
    }

    streamLogger.info("Conversation history built", {
      messageCount: messages.length,
      messages: messages.map((msg, index) => ({
        index,
        role: msg.role,
        contentLength: msg.content.length,
        contentPreview:
          msg.content.substring(0, 100) +
          (msg.content.length > 100 ? "..." : ""),
      })),
    });

    const apiRequest = {
      model: promptDetails.model,
      max_tokens: 4000,
      messages,
      stream: true as const,
      ...(promptDetails.systemMessage && {
        system: promptDetails.systemMessage,
      }),
    };

    anthropicLogger.anthropicEvent("api_request_details", {
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": process.env.ANTHROPIC_API_KEY ? "[REDACTED]" : "[MISSING]",
      },
      body: {
        model: apiRequest.model,
        max_tokens: apiRequest.max_tokens,
        messages: apiRequest.messages.map((msg) => ({
          role: msg.role,
          content:
            msg.content.substring(0, 100) +
            (msg.content.length > 100 ? "..." : ""),
        })),
        stream: apiRequest.stream,
        system:
          promptDetails.systemMessage?.substring(0, 200) +
          (promptDetails.systemMessage &&
          promptDetails.systemMessage.length > 200
            ? "..."
            : ""),
      },
    });

    anthropicLogger.info("Making Anthropic API request", {
      model: promptDetails.model,
      maxTokens: 4000,
      messageCount: messages.length,
      systemMessageLength: promptDetails.systemMessage?.length || 0,
    });

    // Start streaming from Anthropic with the correct model
    const streamStartTime = Date.now();
    const stream = await anthropic.messages.create(apiRequest);

    anthropicLogger.info("Anthropic stream created", {
      requestDuration: Date.now() - streamStartTime,
      streamType: "AsyncIterator",
    });

    // Process stream events
    let eventCount = 0;
    let totalTextReceived = 0;

    for await (const event of stream) {
      eventCount++;

      // Log the complete raw event
      anthropicLogger.anthropicEvent(`raw_event_${eventCount}`, {
        eventNumber: eventCount,
        eventType: event.type,
        rawEvent: event,
      });

      if (event.type === "message_start") {
        anthropicLogger.info(
          "Message start received, initializing text block",
          {
            message: event.message,
            usage: event.message.usage,
          },
        );

        anthropicLogger.info("Processing block_start event for state machine");
        await stateMachine.processStreamEvent({
          type: "block_start",
          blockType: "text",
          blockIndex: 0,
        });
      } else if (event.type === "content_block_start") {
        anthropicLogger.info("Content block start received", {
          index: event.index,
          contentBlock: event.content_block,
        });
      } else if (event.type === "content_block_delta") {
        anthropicLogger.info("Content block delta received", {
          index: event.index,
          delta: event.delta,
        });

        if (event.delta.type === "text_delta") {
          totalTextReceived += event.delta.text.length;

          anthropicLogger.info("Processing text delta", {
            index: event.index,
            deltaLength: event.delta.text.length,
            totalTextReceived,
            deltaText: event.delta.text,
            deltaPreview:
              event.delta.text.substring(0, 100) +
              (event.delta.text.length > 100 ? "..." : ""),
          });

          anthropicLogger.info(
            "Processing block_delta event for state machine",
          );
          await stateMachine.processStreamEvent({
            type: "block_delta",
            blockIndex: event.index,
            delta: event.delta.text,
          });

          // Forward to all subscribers
          const subscriberCount = subscriptions.get(conversationId)?.size || 0;
          anthropicLogger.info(
            `Broadcasting delta to ${subscriberCount} subscribers`,
            {
              broadcastPayload: {
                type: "text_delta",
                promptId,
                delta: event.delta.text,
              },
            },
          );

          broadcast(conversationId, {
            type: "text_delta",
            promptId,
            delta: event.delta.text,
          });
        } else {
          anthropicLogger.info("Non-text delta received", {
            deltaType: (event.delta as any).type,
            delta: event.delta,
          });
        }
      } else if (event.type === "content_block_stop") {
        anthropicLogger.info("Content block stop received", {
          index: event.index,
        });
      } else if (event.type === "message_delta") {
        anthropicLogger.info("Message delta received", {
          delta: event.delta,
          usage: event.usage,
        });
      } else if (event.type === "message_stop") {
        anthropicLogger.info("Message stop received", {
          totalEvents: eventCount,
          totalTextReceived,
        });

        await stateMachine.handleMessageStop();

        broadcast(conversationId, {
          type: "stream_complete",
          promptId,
        });

        anthropicLogger.info("Stream completed successfully");
      } else {
        anthropicLogger.debug(`Unhandled event type: ${(event as any).type}`, {
          event,
        });
      }
    }
  } catch (error) {
    streamLogger.error("Streaming error occurred", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    streamLogger.anthropicEvent("stream_error", { errorMessage });

    await stateMachine.handleError(errorMessage);

    const subscriberCount = subscriptions.get(conversationId)?.size || 0;
    streamLogger.info(`Broadcasting error to ${subscriberCount} subscribers`);

    broadcast(conversationId, {
      type: "stream_error",
      promptId,
      error: errorMessage,
    });
  }
}

logger.info("Server starting up", {
  port,
  nodeEnv: process.env.NODE_ENV,
  anthropicApiKey: !!process.env.ANTHROPIC_API_KEY,
  supportedModels: Object.values(SUPPORTED_MODELS),
  defaultModel: DEFAULT_MODEL,
});

server.listen(Number(port), "0.0.0.0", () => {
  logger.info("Server ready", {
    httpUrl: `http://0.0.0.0:${port}`,
    wsUrl: `ws://0.0.0.0:${port}`,
    port: Number(port),
  });
});
