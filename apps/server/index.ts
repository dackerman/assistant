import { createServer } from "http";
import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer } from "ws";
import type { WebSocket, RawData } from "ws";
import "dotenv/config";

// import { db } from "./src/db";
import { ConversationService } from "./src/services/conversationService";
import { StreamingStateMachine } from "./src/streaming/stateMachine";

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
  if (!subs) return;
  const data = JSON.stringify(payload);
  for (const client of subs) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

wss.on("connection", (ws: WebSocket) => {
  console.log("New WebSocket connection");

  ws.on("message", async (data: RawData) => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;

      if (message.type === "send_message") {
        // Validate and normalize model
        const requestedModel = message.model || DEFAULT_MODEL;
        const supportedModelsList = Object.values(SUPPORTED_MODELS);

        if (!supportedModelsList.includes(requestedModel as any)) {
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

        // Create user message and start streaming
        const result = await conversationService.createUserMessage(
          message.conversationId,
          message.content,
          model,
        );

        // Start streaming with Anthropic
        await startAnthropicStream(result.promptId, message.conversationId);
      } else if (message.type === "subscribe") {
        // Subscribe to conversation updates
        const convId: number = message.conversationId;
        const set = subscriptions.get(convId) ?? new Set();
        set.add(ws);
        subscriptions.set(convId, set);
        const wsSet = wsToConversations.get(ws) ?? new Set<number>();
        wsSet.add(convId);
        wsToConversations.set(ws, wsSet);

        ws.send(
          JSON.stringify({
            type: "subscribed",
            conversationId: convId,
          }),
        );

        // Send snapshot if an active stream exists
        const active = await conversationService.getActiveStream(convId);
        if (active) {
          const content = active.blocks
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.content || "")
            .join("");
          ws.send(
            JSON.stringify({
              type: "snapshot",
              conversationId: convId,
              promptId: active.prompt.id,
              currentState: active.prompt.state,
              content,
            }),
          );
        }
      }
    } catch (error) {
      console.error("WebSocket error:", error);
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
      for (const id of convs) {
        const set = subscriptions.get(id);
        if (set) {
          set.delete(ws);
          if (set.size === 0) subscriptions.delete(id);
        }
      }
      wsToConversations.delete(ws);
    }
    console.log("WebSocket connection closed");
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

/**
 * Start streaming with Anthropic SDK
 */
async function startAnthropicStream(promptId: number, conversationId: number) {
  const stateMachine = new StreamingStateMachine(promptId);

  try {
    // Get prompt details to retrieve the model
    const promptDetails = await conversationService.getPromptById(promptId);
    if (!promptDetails) {
      throw new Error(`Prompt ${promptId} not found`);
    }

    // Get conversation history
    // TODO: Build proper conversation history from database
    const messages = [
      { role: "user" as const, content: "Hello" }, // Placeholder
    ];

    // Start streaming from Anthropic with the correct model
    const stream = await anthropic.messages.create({
      model: promptDetails.model,
      max_tokens: 4000,
      messages,
      stream: true,
    });

    // Process stream events
    for await (const event of stream) {
      if (event.type === "message_start") {
        await stateMachine.processStreamEvent({
          type: "block_start",
          blockType: "text",
          blockIndex: 0,
        });
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          await stateMachine.processStreamEvent({
            type: "block_delta",
            blockIndex: 0,
            delta: event.delta.text,
          });

          // Forward to all subscribers
          broadcast(conversationId, {
            type: "text_delta",
            promptId,
            delta: event.delta.text,
          });
        }
      } else if (event.type === "message_stop") {
        await stateMachine.handleMessageStop();

        broadcast(conversationId, {
          type: "stream_complete",
          promptId,
        });
      }
    }
  } catch (error) {
    console.error("Streaming error:", error);
    await stateMachine.handleError(
      error instanceof Error ? error.message : "Unknown error",
    );

    broadcast(conversationId, {
      type: "stream_error",
      promptId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

console.log(`🚀 Server is running on http://0.0.0.0:${port}`);
console.log(`🔌 WebSocket server is running on ws://0.0.0.0:${port}`);

server.listen(Number(port), "0.0.0.0", () => {
  console.log(`✅ Server listening on port ${port}`);
});
