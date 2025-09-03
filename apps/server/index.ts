import { createServer } from "http";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { type ToolSet, stepCountIs, streamText } from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer } from "ws";

const app = new Hono();

// Model configuration
function getModel(modelName?: string) {
  const model =
    modelName || process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514";

  switch (model) {
    case "gpt-5-2025-08-07":
    case "gpt-5-chat-latest":
    case "gpt-5-nano-2025-08-07":
      return openai.responses(model);

    case "claude-sonnet-4-20250514":
    case "claude-opus-4-1-20250805":
      return anthropic(model);

    case "gemini-2.5-pro":
      return google(model);

    case "grok-code-fast-1":
    case "grok-4-latest":
      return xai(model);
  }

  throw new Error(`Unknown model: ${model}`);
}

function getTools(model: string) {
  const tools: ToolSet = {};
  switch (model) {
    case "gpt-5-2025-08-07": {
      console.log("Adding web search tool");
      const webSearch = openai.tools.webSearchPreview({
        searchContextSize: "medium",
        userLocation: {
          type: "approximate",
          country: "US",
          city: "Summit",
          region: "NJ",
          timezone: "America/New_York",
        },
      });
      tools.web_search = webSearch;
      break;
    }
    case "claude-sonnet-4-20250514":
    case "claude-opus-4-1-20250805": {
      console.log("Adding web search tool");
      const webSearch = anthropic.tools.webSearch_20250305();
      tools.web_search = webSearch;
      break;
    }
  }

  return tools;
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
          tools: getTools(message.model),
          stopWhen: stepCountIs(20), // Allow up to 5 steps for tool execution and follow-up
        });

        // Send start of stream
        ws.send(
          JSON.stringify({
            type: "stream_start",
            messageId: message.messageId,
          }),
        );

        // Stream the response
        for await (const part of result.fullStream) {
          if (ws.readyState !== ws.OPEN) break;

          switch (part.type) {
            case "text-start":
              ws.send(
                JSON.stringify({
                  type: "text_start",
                  messageId: message.messageId,
                  id: part.id,
                  providerMetadata: part.providerMetadata,
                }),
              );
              break;

            case "text-end":
              ws.send(
                JSON.stringify({
                  type: "text_end",
                  messageId: message.messageId,
                  id: part.id,
                  providerMetadata: part.providerMetadata,
                }),
              );
              break;

            case "text-delta":
              ws.send(
                JSON.stringify({
                  type: "stream_text",
                  messageId: message.messageId,
                  id: part.id,
                  text: part.text,
                  providerMetadata: part.providerMetadata,
                }),
              );
              break;

            case "reasoning-start":
              ws.send(
                JSON.stringify({
                  type: "reasoning_start",
                  messageId: message.messageId,
                  id: part.id,
                  providerMetadata: part.providerMetadata,
                }),
              );
              break;

            case "reasoning-end":
              ws.send(
                JSON.stringify({
                  type: "reasoning_end",
                  messageId: message.messageId,
                  id: part.id,
                  providerMetadata: part.providerMetadata,
                }),
              );
              break;

            case "reasoning-delta":
              ws.send(
                JSON.stringify({
                  type: "reasoning_delta",
                  messageId: message.messageId,
                  id: part.id,
                  text: part.text,
                  providerMetadata: part.providerMetadata,
                }),
              );
              break;

            case "tool-input-start":
              ws.send(
                JSON.stringify({
                  type: "tool_input_start",
                  messageId: message.messageId,
                  id: part.id,
                  toolName: part.toolName,
                  providerMetadata: part.providerMetadata,
                  providerExecuted: part.providerExecuted,
                  dynamic: part.dynamic,
                }),
              );
              break;

            case "tool-input-end":
              ws.send(
                JSON.stringify({
                  type: "tool_input_end",
                  messageId: message.messageId,
                  id: part.id,
                  providerMetadata: part.providerMetadata,
                }),
              );
              break;

            case "tool-input-delta":
              ws.send(
                JSON.stringify({
                  type: "tool_input_delta",
                  messageId: message.messageId,
                  id: part.id,
                  delta: part.delta,
                  providerMetadata: part.providerMetadata,
                }),
              );
              break;

            case "tool-call":
              ws.send(
                JSON.stringify({
                  type: "tool_call",
                  messageId: message.messageId,
                  toolCall: {
                    id: part.toolCallId,
                    name: part.toolName,
                    parameters: part.input,
                    providerExecuted: part.providerExecuted,
                    dynamic: part.dynamic,
                    invalid: part.invalid,
                    error: part.error,
                    providerMetadata: part.providerMetadata,
                    status: "running",
                    startTime: new Date().toISOString(),
                    endTime: null,
                    result: null,
                  },
                }),
              );
              break;

            case "tool-result":
              ws.send(
                JSON.stringify({
                  type: "tool_result",
                  messageId: message.messageId,
                  toolResult: {
                    id: part.toolCallId,
                    name: part.toolName,
                    parameters: part.input,
                    output: part.output,
                    providerExecuted: part.providerExecuted,
                    dynamic: part.dynamic,
                    preliminary: part.preliminary,
                    status: "completed",
                    startTime: new Date().toISOString(),
                    endTime: new Date().toISOString(),
                    result:
                      typeof part.output === "string"
                        ? part.output
                        : JSON.stringify(part.output),
                  },
                }),
              );
              break;

            case "tool-error":
              ws.send(
                JSON.stringify({
                  type: "tool_error",
                  messageId: message.messageId,
                  toolError: {
                    id: part.toolCallId,
                    name: part.toolName,
                    parameters: part.input,
                    error: part.error,
                    providerExecuted: part.providerExecuted,
                    dynamic: part.dynamic,
                    status: "error",
                    startTime: new Date().toISOString(),
                    endTime: new Date().toISOString(),
                    result: null,
                  },
                }),
              );
              break;

            case "source":
              ws.send(
                JSON.stringify({
                  type: "source",
                  messageId: message.messageId,
                  source: part, // Send the entire source object as it has different structures for url/document
                }),
              );
              break;

            case "file":
              ws.send(
                JSON.stringify({
                  type: "file",
                  messageId: message.messageId,
                  file: {
                    base64: part.file.base64,
                    uint8Array: null, // Don't send binary data over WebSocket
                    mediaType: part.file.mediaType,
                  },
                }),
              );
              break;

            case "tool-error":
              ws.send(
                JSON.stringify({
                  type: "tool_error",
                  messageId: message.messageId,
                  toolError: {
                    id: part.toolCallId,
                    name: part.toolName,
                    parameters: part.input,
                    error: part.error,
                    providerExecuted: part.providerExecuted,
                    dynamic: part.dynamic,
                    status: "error",
                    startTime: new Date().toISOString(),
                    endTime: new Date().toISOString(),
                    result: null,
                  },
                }),
              );
              break;

            case "source":
              ws.send(
                JSON.stringify({
                  type: "source",
                  messageId: message.messageId,
                  source: part, // Send the entire source object as it has different structures for url/document
                }),
              );
              break;

            case "file":
              ws.send(
                JSON.stringify({
                  type: "file",
                  messageId: message.messageId,
                  file: {
                    base64: part.file.base64,
                    uint8Array: null, // Don't send binary data over WebSocket
                    mediaType: part.file.mediaType,
                  },
                }),
              );
              break;

            case "start-step":
              ws.send(
                JSON.stringify({
                  type: "start_step",
                  messageId: message.messageId,
                  request: part.request,
                  warnings: part.warnings,
                }),
              );
              break;

            case "finish-step":
              ws.send(
                JSON.stringify({
                  type: "finish_step",
                  messageId: message.messageId,
                  response: part.response,
                  usage: part.usage,
                  finishReason: part.finishReason,
                  providerMetadata: part.providerMetadata,
                }),
              );
              break;

            case "start":
              ws.send(
                JSON.stringify({
                  type: "start",
                  messageId: message.messageId,
                }),
              );
              break;

            case "finish":
              ws.send(
                JSON.stringify({
                  type: "finish",
                  messageId: message.messageId,
                  finishReason: part.finishReason,
                  totalUsage: part.totalUsage,
                }),
              );
              break;

            case "abort":
              ws.send(
                JSON.stringify({
                  type: "abort",
                  messageId: message.messageId,
                }),
              );
              break;

            case "error":
              ws.send(
                JSON.stringify({
                  type: "stream_error",
                  messageId: message.messageId,
                  error:
                    part.error instanceof Error
                      ? part.error.message
                      : String(part.error),
                }),
              );
              break;

            case "raw":
              // Raw values might contain sensitive data, so we'll log it for debugging
              // but not send it to the client unless specifically needed
              console.log("Raw stream part:", part.rawValue);
              break;

            default:
              // Exhaustive check - this should never happen with proper typing
              console.warn("Unhandled stream part type:", (part as any).type);
              break;
          }
        }
        // Send end of stream
        ws.send(
          JSON.stringify({
            type: "stream_end",
            messageId: message.messageId,
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

console.log(`🚀 Server is running on http://0.0.0.0:${port}`);
console.log(`🔌 WebSocket server is running on ws://0.0.0.0:${port}`);

server.listen(Number(port), "0.0.0.0", () => {
  console.log(`✅ Server listening on port ${port}`);
});
