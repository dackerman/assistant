import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import { and, eq, or } from "drizzle-orm";
import {
  type DB,
  type ToolCall,
  promptEvents,
  prompts,
  toolCalls,
} from "../db/index.js";
import type { Logger } from "../utils/logger.js";
import type { ToolExecutorService } from "./toolExecutorService.js";

const MODEL = "claude-4-sonnet-20250514";

/**
 * PromptService handles making a call to an LLM and persisting it to the database.
 * It generally persists the requests and responses directly into the DB rather than
 * abstracting it much. The database records are mainly for fault tolerance and robustness
 * to mutliple viewing clients and disconnects.
 *
 * Note that this class only handles a single prompt to an LLM, not an entire conversation. It's
 * indifferent to the mechanism by which the "previous messages" data is provided to the context.
 *
 * It does, however, handle tool calls and re-prompting with the results in a loop. So this represents
 * the entire state machine for handling a "response".
 *
 * Higher level classes are expected to use this class for individual prompts
 */
export class PromptService {
  private readonly client: Anthropic;
  private readonly db: DB;
  private readonly logger: Logger;
  private readonly toolExecutor: ToolExecutorService;

  private constructor(
    client: Anthropic,
    db: DB,
    toolExecutor: ToolExecutorService,
    logger: Logger,
  ) {
    this.client = client;
    this.db = db;
    this.toolExecutor = toolExecutor;
    this.logger = logger.child({ service: "PromptService" });
  }

  async prompt(messages: Anthropic.Messages.MessageParam[]) {
    const request: MessageCreateParamsStreaming = {
      model: MODEL,
      max_tokens: 50000,
      stream: true,
      messages,
    };
    const stream = await this.client.messages.create(request);
    const promptResults = await this.db
      .insert(prompts)
      .values({
        provider: "anthropic",
        model: MODEL,
        request,
      })
      .returning();
    const prompt = promptResults[0];
    if (!prompt) {
      throw new Error("Prompt not found");
    }

    let currentStream = stream;

    // keep looping until the LLM doesn't need to call any more tools
    while (true) {
      const toolCallIds = await this.handleTools(prompt.id, currentStream);
      if (toolCallIds.length === 0) {
        break;
      }

      const newMessages: Anthropic.Messages.MessageParam[] = [...messages];
      for (const toolCallId of toolCallIds) {
        const res = await this.db
          .select()
          .from(toolCalls)
          .where(eq(toolCalls.id, toolCallId));
        const toolCall = res[0];
        if (!toolCall) {
          throw new Error(`Tool call not found for id ${toolCallId}`);
        }
        newMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolCall.apiToolCallId,
              content: toolCall.outputStream || "<No results>",
            },
          ],
        });
      }

      const continuationRequest: MessageCreateParamsStreaming = {
        ...request,
        messages: newMessages,
      };

      currentStream = await this.client.messages.create(continuationRequest);
    }
  }

  private async handleTools(
    promptId: number,
    stream: AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>,
  ): Promise<number[]> {
    const toolInputs = new Map<number, ToolCallRequest>();
    const activeToolCalls = new Map<number, ToolCall>();

    for await (const event of stream) {
      this.logger.info("Stream event", { event });
      this.db.insert(promptEvents).values({
        prompt: promptId,
        event: event,
      });

      switch (event.type) {
        case "content_block_start": {
          if (event.content_block.type === "tool_use") {
            toolInputs.set(event.index, {
              promptId: promptId,
              index: event.index,
              input: "",
              toolName: event.content_block.name,
              toolUseId: event.content_block.id,
            });
          }
          break;
        }
        case "content_block_delta": {
          if (event.delta.type === "input_json_delta") {
            const toolInput = toolInputs.get(event.index);
            if (!toolInput) {
              throw new Error(`Tool input not found for index ${event.index}`);
            }
            toolInput.input += event.delta.partial_json;
          }
          break;
        }
        case "content_block_stop": {
          const toolInput = toolInputs.get(event.index);
          if (toolInput) {
            const activeToolCall = await this.startToolCall(toolInput);
            activeToolCalls.set(event.index, activeToolCall);
          }
          break;
        }
      }
    }

    if (toolInputs.size === 0) {
      await this.db.update(prompts).set({
        id: promptId,
        state: "completed",
      });
      return [];
    }

    await this.db.update(prompts).set({
      id: promptId,
      state: "waiting_for_tools",
    });

    // poll until all tool calls are completed
    await this.waitForToolCallsToComplete(promptId);

    await this.db.update(prompts).set({
      id: promptId,
      state: "ready_for_continuation",
    });

    return Array.from(activeToolCalls.values()).map((call) => call.id);
  }

  private async waitForToolCallsToComplete(promptId: number) {
    while (true) {
      const activeToolCalls = await this.db
        .select()
        .from(toolCalls)
        .where(
          and(
            eq(toolCalls.promptId, promptId),
            or(eq(toolCalls.state, "running"), eq(toolCalls.state, "created")),
          ),
        );
      if (activeToolCalls.length === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async startToolCall({
    promptId,
    index,
    input,
    toolName,
    toolUseId,
  }: ToolCallRequest): Promise<ToolCall> {
    const toolCallResult = await this.db
      .insert(toolCalls)
      .values({
        promptId: promptId,
        request: JSON.parse(input),
        state: "created",
        toolName: toolName,
        apiToolCallId: toolUseId,
      })
      .returning();

    const toolCall = toolCallResult[0];
    if (!toolCall) {
      throw new Error(`Tool call not found for index ${index}`);
    }
    await this.toolExecutor.executeToolCall(toolCall.id);
    return toolCall;
  }
}

type ToolCallRequest = {
  promptId: number;
  index: number;
  input: string;
  toolName: string;
  toolUseId: string;
};
