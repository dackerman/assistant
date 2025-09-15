import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import { and, eq, or } from "drizzle-orm";
import { db as defaultDb } from "../db";
import type { DB } from "../db";
import {
  type NewBlock,
  type NewPrompt,
  type NewPromptEvent,
  type NewToolCall,
  blocks,
  messages,
  promptEvents,
  prompts,
  toolCalls,
} from "../db/schema";
import { Logger } from "../utils/logger";
import { ToolExecutorService } from "./toolExecutorService";

export interface CreatePromptParams {
  conversationId: number;
  messageId: number;
  model?: string;
  systemMessage?: string;
  maxTokens?: number;
}

export interface StreamingCallbacks {
  onBlockStart?: (blockId: number, type: string) => void;
  onBlockDelta?: (blockId: number, content: string) => void;
  onBlockEnd?: (blockId: number) => void;
  onToolStart?: (toolCallId: number, name: string, input: any) => void;
  onToolProgress?: (toolCallId: number, output: string) => void;
  onToolEnd?: (toolCallId: number, output: string, success: boolean) => void;
  onComplete?: (promptId: number) => void;
  onError?: (error: Error) => void;
}

/**
 * PromptService handles individual prompts to LLM and manages streaming responses.
 * It creates and updates blocks during streaming and handles tool execution.
 * This is now called internally by ConversationService.
 */
export class PromptService {
  private client?: Anthropic;
  private db: DB;
  private logger: Logger;
  private toolExecutor: ToolExecutorService;

  constructor(dbInstance: DB = defaultDb) {
    // Import Anthropic dynamically to avoid issues during testing
    this.db = dbInstance;
    this.logger = new Logger({ service: "PromptService" });
    this.toolExecutor = new ToolExecutorService(dbInstance);
  }

  private async getAnthropicClient(): Promise<Anthropic> {
    if (!this.client) {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
    return this.client;
  }

  /**
   * Create and stream a prompt, updating blocks in real-time
   */
  async createAndStreamPrompt(
    params: CreatePromptParams,
    callbacks?: StreamingCallbacks,
  ): Promise<number> {
    const {
      conversationId,
      messageId,
      model = "claude-sonnet-4-20250514",
      systemMessage,
      maxTokens = 50000,
    } = params;

    this.logger.info("Creating and streaming prompt", {
      conversationId,
      messageId,
      model,
    });

    // Build conversation history for this prompt
    const history = await this.buildConversationHistory(conversationId);

    const request: MessageCreateParamsStreaming = {
      model,
      max_tokens: maxTokens,
      stream: true,
      system: systemMessage,
      messages: history,
      tools: [
        {
          name: "bash",
          description:
            "Execute bash commands in a persistent shell session. Use this to run any command line operations, check files, install packages, etc.",
          input_schema: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "The bash command to execute",
              },
            },
            required: ["command"],
          },
        },
      ],
    };

    // Create prompt record
    const [prompt] = await this.db
      .insert(prompts)
      .values({
        conversationId,
        messageId,
        status: "streaming",
        model,
        systemMessage,
        request: request as any,
      } as NewPrompt)
      .returning();

    const promptId = prompt?.id;

    try {
      await this.streamPromptResponse(promptId, request, callbacks);
      return promptId;
    } catch (error) {
      // Mark prompt as failed
      await this.db
        .update(prompts)
        .set({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        })
        .where(eq(prompts.id, promptId));

      callbacks?.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Stream the prompt response and handle tool calls
   */
  private async streamPromptResponse(
    promptId: number,
    request: MessageCreateParamsStreaming,
    callbacks?: StreamingCallbacks,
  ): Promise<void> {
    const client = await this.getAnthropicClient();
    let currentRequest = request;
    const toolCallResults: any[] = [];

    // Keep looping until no more tool calls are needed
    while (true) {
      const stream = await client.messages.create(currentRequest);
      const { hasToolCalls, newToolResults } = await this.handleStreamEvents(
        promptId,
        stream,
        callbacks,
      );

      if (!hasToolCalls) {
        // No tools called, we're done
        await this.completePrompt(promptId, callbacks);
        break;
      }

      // Wait for all tool calls to complete
      await this.waitForToolCallsToComplete(promptId);

      // Build continuation request with tool results
      toolCallResults.push(...newToolResults);
      currentRequest = {
        ...request,
        messages: [
          ...request.messages,
          ...toolCallResults.map((result) => ({
            role: "user" as const,
            content: [
              {
                type: "tool_result" as const,
                tool_use_id: result.tool_use_id,
                content: result.content,
              },
            ],
          })),
        ],
      };
    }
  }

  /**
   * Handle streaming events from Anthropic
   */
  private async handleStreamEvents(
    promptId: number,
    stream: AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>,
    callbacks?: StreamingCallbacks,
  ): Promise<{ hasToolCalls: boolean; newToolResults: any[] }> {
    const blockMap = new Map<number, number>(); // stream index -> block id
    const toolInputs = new Map<number, any>(); // stream index -> tool data
    const toolResults: any[] = [];
    let hasToolCalls = false;

    try {
      for await (const event of stream) {
        // Store raw event
        await this.db.insert(promptEvents).values({
          promptId,
          type: event.type,
          data: event as any,
        } as NewPromptEvent);

        switch (event.type) {
          case "content_block_start": {
            if (event.content_block.type === "text") {
              // Create text block
              const [block] = await this.db
                .insert(blocks)
                .values({
                  messageId: await this.getMessageIdForPrompt(promptId),
                  type: "text",
                  content: "",
                  order: event.index,
                } as NewBlock)
                .returning();

              blockMap.set(event.index, block?.id);
              callbacks?.onBlockStart?.(block?.id, "text");
            } else if (event.content_block.type === "tool_use") {
              hasToolCalls = true;

              // Create tool_use block
              const [block] = await this.db
                .insert(blocks)
                .values({
                  messageId: await this.getMessageIdForPrompt(promptId),
                  type: "tool_use",
                  content: `Using ${event.content_block.name} tool...`,
                  order: event.index,
                  metadata: {
                    toolName: event.content_block.name,
                    toolUseId: event.content_block.id,
                  },
                } as NewBlock)
                .returning();

              blockMap.set(event.index, block?.id);
              toolInputs.set(event.index, {
                blockId: block?.id,
                toolName: event.content_block.name,
                toolUseId: event.content_block.id,
                input: "",
              });

              callbacks?.onBlockStart?.(block?.id, "tool_use");
            }
            break;
          }

          case "content_block_delta": {
            const blockId = blockMap.get(event.index);
            if (!blockId) break;

            if (event.delta.type === "text_delta") {
              // Update text block
              await this.updateBlockContent(blockId, event.delta.text, true);
              callbacks?.onBlockDelta?.(blockId, event.delta.text);
            } else if (event.delta.type === "input_json_delta") {
              // Accumulate tool input
              const toolData = toolInputs.get(event.index);
              if (toolData) {
                toolData.input += event.delta.partial_json;
              }
            }
            break;
          }

          case "content_block_stop": {
            const blockId = blockMap.get(event.index);
            if (!blockId) break;

            const toolData = toolInputs.get(event.index);
            if (toolData) {
              // Tool call complete - start execution
              try {
                const parsedInput = JSON.parse(toolData.input);

                // Create tool call record
                const [toolCall] = await this.db
                  .insert(toolCalls)
                  .values({
                    promptId,
                    blockId,
                    apiToolCallId: toolData.toolUseId,
                    name: toolData.toolName,
                    input: parsedInput,
                    state: "pending",
                  } as NewToolCall)
                  .returning();

                callbacks?.onToolStart?.(
                  toolCall?.id,
                  toolData.toolName,
                  parsedInput,
                );

                // Start tool execution
                await this.toolExecutor.executeToolCall(toolCall?.id);

                // Get the result for continuation
                const [completedTool] = await this.db
                  .select()
                  .from(toolCalls)
                  .where(eq(toolCalls.id, toolCall?.id));

                if (completedTool) {
                  toolResults.push({
                    tool_use_id: toolData.toolUseId,
                    content: completedTool.output || "No output",
                  });

                  callbacks?.onToolEnd?.(
                    toolCall?.id,
                    completedTool.output || "",
                    completedTool.state === "completed",
                  );
                }
              } catch (error) {
                this.logger.error("Error parsing tool input", {
                  error,
                  input: toolData.input,
                });
              }
            }

            callbacks?.onBlockEnd?.(blockId);
            break;
          }

          case "message_stop": {
            // Stream completed
            break;
          }
        }
      }
    } catch (error) {
      this.logger.error("Error handling stream events", { promptId, error });
      throw error;
    }

    return { hasToolCalls, newToolResults: toolResults };
  }

  /**
   * Update block content (append if incremental)
   */
  private async updateBlockContent(
    blockId: number,
    content: string,
    append = false,
  ): Promise<void> {
    if (append) {
      // Get current content and append
      const [currentBlock] = await this.db
        .select({ content: blocks.content })
        .from(blocks)
        .where(eq(blocks.id, blockId));

      const newContent = (currentBlock?.content || "") + content;

      await this.db
        .update(blocks)
        .set({ content: newContent, updatedAt: new Date() })
        .where(eq(blocks.id, blockId));
    } else {
      await this.db
        .update(blocks)
        .set({ content, updatedAt: new Date() })
        .where(eq(blocks.id, blockId));
    }
  }

  /**
   * Wait for all tool calls to complete
   */
  private async waitForToolCallsToComplete(promptId: number): Promise<void> {
    while (true) {
      const activeCalls = await this.db
        .select()
        .from(toolCalls)
        .where(
          and(
            eq(toolCalls.promptId, promptId),
            or(
              eq(toolCalls.state, "pending"),
              eq(toolCalls.state, "executing"),
            ),
          ),
        );

      if (activeCalls.length === 0) break;

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /**
   * Mark prompt as completed
   */
  private async completePrompt(
    promptId: number,
    callbacks?: StreamingCallbacks,
  ): Promise<void> {
    await this.db
      .update(prompts)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(prompts.id, promptId));

    callbacks?.onComplete?.(promptId);

    this.logger.info("Prompt completed", { promptId });
  }

  /**
   * Get message ID for a prompt
   */
  private async getMessageIdForPrompt(promptId: number): Promise<number> {
    const [prompt] = await this.db
      .select({ messageId: prompts.messageId })
      .from(prompts)
      .where(eq(prompts.id, promptId));

    return prompt?.messageId;
  }

  /**
   * Build conversation history for prompt
   */
  private async buildConversationHistory(
    conversationId: number,
  ): Promise<Anthropic.Messages.MessageParam[]> {
    // Get all completed messages with their blocks
    const messagesWithBlocks = await this.db
      .select({
        message: messages,
        block: blocks,
      })
      .from(messages)
      .leftJoin(blocks, eq(messages.id, blocks.messageId))
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.status, "completed"),
        ),
      )
      .orderBy(messages.createdAt, blocks.order);

    // Group by messages
    const messageMap = new Map();
    for (const row of messagesWithBlocks) {
      if (!messageMap.has(row.message.id)) {
        messageMap.set(row.message.id, {
          ...row.message,
          blocks: [],
        });
      }
      if (row.block) {
        messageMap.get(row.message.id)?.blocks.push(row.block);
      }
    }

    // Convert to Anthropic format
    const history: Anthropic.Messages.MessageParam[] = [];

    for (const message of messageMap.values()) {
      if (message.role === "user") {
        const content = message.blocks
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.content)
          .join("");

        if (content) {
          history.push({
            role: "user",
            content,
          });
        }
      } else if (message.role === "assistant") {
        const content = message.blocks
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.content)
          .join("");

        if (content) {
          history.push({
            role: "assistant",
            content,
          });
        }
      }
    }

    return history;
  }
}
