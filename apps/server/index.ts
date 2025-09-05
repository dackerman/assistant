import { createServer } from "http";
import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer } from "ws";
import "dotenv/config";

import { db } from "./src/db";
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

// API routes
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    message: "Server is running",
    providers: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    },
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

  const result = await conversationService.createUserMessage(
    conversationId,
    body.content,
    body.model || "claude-3-5-sonnet-20241022",
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

wss.on("connection", (ws) => {
  console.log("New WebSocket connection");

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "send_message") {
        // Create user message and start streaming
        const result = await conversationService.createUserMessage(
          message.conversationId,
          message.content,
          message.model,
        );

        // Start streaming with Anthropic
        await startAnthropicStream(result.promptId, ws);
      } else if (message.type === "subscribe") {
        // Subscribe to conversation updates
        // TODO: Implement subscription management
        ws.send(
          JSON.stringify({
            type: "subscribed",
            conversationId: message.conversationId,
          }),
        );
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
    console.log("WebSocket connection closed");
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

/**
 * Start streaming with Anthropic SDK
 */
async function startAnthropicStream(promptId: number, ws: any) {
  const stateMachine = new StreamingStateMachine(promptId);

  try {
    // Get conversation history
    // TODO: Build proper conversation history from database
    const messages = [
      { role: "user" as const, content: "Hello" }, // Placeholder
    ];

    // Start streaming from Anthropic
    const stream = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
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

          // Forward to client
          ws.send(
            JSON.stringify({
              type: "text_delta",
              promptId,
              delta: event.delta.text,
            }),
          );
        }
      } else if (event.type === "message_stop") {
        await stateMachine.handleMessageStop();

        ws.send(
          JSON.stringify({
            type: "stream_complete",
            promptId,
          }),
        );
      }
    }
  } catch (error) {
    console.error("Streaming error:", error);
    await stateMachine.handleError(
      error instanceof Error ? error.message : "Unknown error",
    );

    ws.send(
      JSON.stringify({
        type: "stream_error",
        promptId,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
}

console.log(`🚀 Server is running on http://0.0.0.0:${port}`);
console.log(`🔌 WebSocket server is running on ws://0.0.0.0:${port}`);

server.listen(Number(port), "0.0.0.0", () => {
  console.log(`✅ Server listening on port ${port}`);
});
