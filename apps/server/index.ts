import { createServer } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import "dotenv/config";

import { db as defaultDb } from "./src/db";
import { BashSessionManager } from "./src/services/bashSessionManager";
import { ConversationService } from "./src/services/conversationService";
import { PromptService } from "./src/services/promptService";
import { ToolExecutorService } from "./src/services/toolExecutorService";
import { createBashTool } from "./src/services/tools/bashTool";
import { logger } from "./src/utils/logger";

const app = new Hono();

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicApiKey) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

// Initialize services
const anthropic = new Anthropic({
  apiKey: anthropicApiKey,
});

const bashSessionManager = new BashSessionManager();
const toolExecutorService = new ToolExecutorService(
  [createBashTool(bashSessionManager)],
  defaultDb,
);
toolExecutorService.initialize();

const promptService = new PromptService(undefined, {
  anthropicClient: anthropic,
  toolExecutor: toolExecutorService,
});

const conversationService = new ConversationService(undefined, {
  promptService,
});

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

app.put("/api/conversations/:id", async (c) => {
  const conversationId = Number.parseInt(c.req.param("id"));
  const userId = 1; // TODO: Get from auth

  try {
    const body = await c.req.json();
    const { title } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return c.json({ error: "Title is required" }, 400);
    }

    // Verify the user owns this conversation by trying to get it first
    const conversation = await conversationService.getConversation(
      conversationId,
      userId,
    );
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    await conversationService.setTitle(conversationId, title.trim());
    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to update conversation title:", error);
    return c.json({ error: "Failed to update title" }, 500);
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
  if (!req.url) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request: Missing URL");
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
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
    duplex: req.method !== "GET" && req.method !== "HEAD" ? "half" : undefined,
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
  | { type: "subscribed"; conversationId: number }
  | { type: "conversation_updated"; conversationId: number; data: unknown }
  | { type: "message_created"; conversationId: number; message: unknown }
  | {
      type: "snapshot";
      conversationId: number;
      activeStream: unknown;
    }
  | { type: "stream_started"; conversationId: number; promptId: number }
  | {
      type: "stream_delta";
      conversationId: number;
      promptId: number;
      delta: string;
    }
  | { type: "stream_complete"; conversationId: number; promptId: number }
  | {
      type: "stream_error";
      conversationId: number;
      promptId: number;
      error: string;
    }
  | {
      type: "tool_call_started";
      conversationId: number;
      promptId: number;
      toolCallId: number;
      toolName: string;
      parameters: Record<string, unknown>;
    }
  | {
      type: "tool_call_output_delta";
      conversationId: number;
      promptId: number;
      toolCallId: number;
      stream: "stdout" | "stderr";
      delta: string;
    }
  | {
      type: "tool_call_completed";
      conversationId: number;
      promptId: number;
      toolCallId: number;
      exitCode: number;
    }
  | {
      type: "tool_call_error";
      conversationId: number;
      promptId: number;
      toolCallId: number;
      error: string;
    };

type ClientMessage = { type: "subscribe"; conversationId: number };

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

      if (message.type === "subscribe") {
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
        const activeStream = await conversationService.getActiveStream(convId);

        subscribeLogger.wsEvent("snapshot_sent", {
          hasActiveStream: !!activeStream,
        });

        ws.send(
          JSON.stringify({
            type: "snapshot",
            conversationId: convId,
            activeStream,
          }),
        );
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

logger.info("Server starting up", {
  port,
  nodeEnv: process.env.NODE_ENV,
  anthropicApiKey: !!process.env.ANTHROPIC_API_KEY,
  supportedModels: Object.values(SUPPORTED_MODELS),
  defaultModel: DEFAULT_MODEL,
});

// Log the file being used for this server run (if file logging is enabled)
if (process.env.LOG_TO_FILE === "true") {
  const logDir = process.env.LOG_DIR || "logs";
  logger.info("File logging enabled", {
    logDirectory: logDir,
    logFile: `Logs will be written to ${logDir}/app-{timestamp}.log`,
    note: "Each server run creates a unique log file with timestamp",
  });
}

server.listen(Number(port), "0.0.0.0", () => {
  logger.info("Server ready", {
    httpUrl: `http://0.0.0.0:${port}`,
    wsUrl: `ws://0.0.0.0:${port}`,
    port: Number(port),
  });
});
