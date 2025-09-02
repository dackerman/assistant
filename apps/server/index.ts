import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { streamText } from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const app = new Hono();

// Model configuration
function getModel(modelName?: string) {
  const model = modelName || process.env.DEFAULT_MODEL || "gpt-5-chat-latest";

  switch (model) {
    case "gpt-5-2025-08-07":
    case "gpt-5-chat-latest":
    case "gpt-5-nano-2025-08-07":
      return openai(model);

    case "claude-sonnet-4-20250514":
    case "claude-opus-4-1-20250805":
      return anthropic(model);

    case "gemini-2.5-pro":
      return google(model);

    case "grok-code-fast-1":
    case "grok-4-latest":
      return xai(model);

    default:
      console.warn(
        `Unknown model: ${model}, falling back to gpt-5-chat-latest`,
      );
      return openai("gpt-5-chat-latest");
  }
}

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
  const providers = {
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    google: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    xai: !!process.env.XAI_API_KEY,
  };

  return c.json({
    status: "ok",
    message: "Server is running",
    defaultModel: process.env.DEFAULT_MODEL || "gpt-5-chat-latest",
    providers,
  });
});

app.get("/api/models", (c) => {
  const availableModels = [
    {
      id: "gpt-5-2025-08-07",
      name: "GPT-5 (2025-08-07)",
      provider: "openai",
      enabled: !!process.env.OPENAI_API_KEY,
    },
    {
      id: "gpt-5-chat-latest",
      name: "GPT-5 Chat Latest",
      provider: "openai",
      enabled: !!process.env.OPENAI_API_KEY,
    },
    {
      id: "gpt-5-nano-2025-08-07",
      name: "GPT-5 Nano",
      provider: "openai",
      enabled: !!process.env.OPENAI_API_KEY,
    },
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      provider: "anthropic",
      enabled: !!process.env.ANTHROPIC_API_KEY,
    },
    {
      id: "claude-opus-4-1-20250805",
      name: "Claude Opus 4.1",
      provider: "anthropic",
      enabled: !!process.env.ANTHROPIC_API_KEY,
    },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      provider: "google",
      enabled: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    },
    {
      id: "grok-code-fast-1",
      name: "Grok Code Fast",
      provider: "xai",
      enabled: !!process.env.XAI_API_KEY,
    },
    {
      id: "grok-4-latest",
      name: "Grok 4 Latest",
      provider: "xai",
      enabled: !!process.env.XAI_API_KEY,
    },
  ];

  return c.json({ models: availableModels });
});

app.get("/api/hello", (c) => {
  return c.json({ message: "Hello from the backend!" });
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

      if (message.type === "chat") {
        const result = await streamText({
          model: getModel(message.model),
          messages: message.messages,
        });

        // Send start of stream
        ws.send(
          JSON.stringify({
            type: "stream_start",
            messageId: message.messageId,
          }),
        );

        // Stream the response
        for await (const textPart of result.textStream) {
          if (ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({
                type: "stream_text",
                messageId: message.messageId,
                text: textPart,
              }),
            );
          }
        }

        // Send end of stream
        if (ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              type: "stream_end",
              messageId: message.messageId,
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
    console.log("WebSocket connection closed");
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

console.log(`🚀 Server is running on http://0.0.0.0:${port}`);
console.log(`🔌 WebSocket server is running on ws://0.0.0.0:${port}`);

server.listen(Number(port), "0.0.0.0", () => {
  console.log(`✅ Server listening on port ${port}`);
});
