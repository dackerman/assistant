import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  events,
  attachments,
  blocks,
  conversations,
  messages,
  prompts,
  toolCalls,
  users,
} from "../db/schema";
import { setupTestDatabase, teardownTestDatabase, testDb } from "../test/setup";
import { ConversationService } from "./conversationService";

describe("ConversationService", () => {
  let userId: number;
  let service: ConversationService;

  beforeAll(async () => {
    await setupTestDatabase();
    service = new ConversationService(testDb);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    // Clean tables in FK-safe order
    await testDb.delete(events);
    await testDb.delete(toolCalls);
    await testDb.delete(attachments);
    await testDb.delete(blocks);
    await testDb.delete(prompts);
    await testDb.delete(messages);
    await testDb.delete(conversations);
    await testDb.delete(users);

    const [user] = await testDb
      .insert(users)
      .values({ email: "cs_test@example.com" })
      .returning();
    userId = user.id;
  });

  it("creates a conversation", async () => {
    const id = await service.createConversation(userId, "My Title");

    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));

    expect(conv).toBeDefined();
    expect(conv.userId).toBe(userId);
    expect(conv.title).toBe("My Title");
  });

  it("creates user message, assistant placeholder, prompt and updates active prompt", async () => {
    const convId = await service.createConversation(userId);

    const { userMessageId, promptId } = await service.createUserMessage(
      convId,
      "Hello there",
      "test-model",
    );

    // user message exists and complete
    const [userMsg] = await testDb
      .select()
      .from(messages)
      .where(eq(messages.id, userMessageId));
    expect(userMsg.role).toBe("user");
    expect(userMsg.isComplete).toBe(true);

    // user message has a finalized text block with promptId set
    const [userBlock] = await testDb
      .select()
      .from(blocks)
      .where(eq(blocks.messageId, userMessageId));
    expect(userBlock.type).toBe("text");
    expect(userBlock.isFinalized).toBe(true);
    expect(userBlock.promptId).toBeDefined(); // User block has its own prompt ID, different from assistant promptId

    // assistant message placeholder exists and is incomplete
    const [prompt] = await testDb
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId));

    const [assistantMsg] = await testDb
      .select()
      .from(messages)
      .where(eq(messages.id, prompt.messageId!));
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.isComplete).toBe(false);

    // prompt metadata
    expect(prompt.state).toBe("CREATED");
    expect(prompt.model).toBe("test-model");

    // conversation points to active prompt
    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId));
    expect(conv.activePromptId).toBe(promptId);
  });

  it("returns conversation with completed messages and their blocks", async () => {
    const convId = await service.createConversation(userId);
    const { userMessageId, promptId } = await service.createUserMessage(
      convId,
      "Q1",
    );

    // finalize assistant message with a text block
    const [prompt] = await testDb
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId));

    // create assistant text block and mark assistant message as complete
    await testDb.insert(blocks).values({
      promptId,
      messageId: prompt.messageId!,
      type: "text",
      indexNum: 0,
      content: "A1",
      isFinalized: true,
    });
    await testDb
      .update(messages)
      .set({ isComplete: true })
      .where(eq(messages.id, prompt.messageId!));

    const result = await service.getConversation(convId, userId);
    expect(result).not.toBeNull();
    expect(result?.conversation.id).toBe(convId);
    // Only completed messages should appear: user + assistant
    expect(result?.messages.length).toBe(2);

    // Check assistant message has blocks
    const assistant = result?.messages.find((m: any) => m.role === "assistant");
    expect(assistant.blocks.length).toBe(1);
    expect(assistant.blocks[0].content).toBe("A1");
  });

  it("returns conversation with tool calls attached to messages", async () => {
    const convId = await service.createConversation(userId);
    const { userMessageId, promptId } = await service.createUserMessage(
      convId,
      "Can you run ls command?",
    );

    // finalize assistant message with a tool call block
    const [prompt] = await testDb
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId));

    // create assistant tool_call block
    const [toolCallBlock] = await testDb
      .insert(blocks)
      .values({
        promptId,
        messageId: prompt.messageId!,
        type: "tool_call",
        indexNum: 0,
        content: "Running ls command",
        isFinalized: true,
      })
      .returning();

    // create a tool call associated with this block
    const [toolCall] = await testDb
      .insert(toolCalls)
      .values({
        promptId,
        blockId: toolCallBlock.id,
        apiToolCallId: "call_123",
        toolName: "Bash",
        state: "complete",
        request: { command: "ls" },
        response: { output: "file1.txt\nfile2.txt" },
      })
      .returning();

    // mark assistant message as complete
    await testDb
      .update(messages)
      .set({ isComplete: true })
      .where(eq(messages.id, prompt.messageId!));

    // Test: get conversation should include tool calls
    const result = await service.getConversation(convId, userId);
    expect(result).not.toBeNull();
    expect(result?.conversation.id).toBe(convId);
    expect(result?.messages.length).toBe(2);

    // Check assistant message has tool call embedded in block
    const assistant = result?.messages.find((m: any) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant.blocks).toBeDefined();
    expect(assistant.blocks.length).toBe(1);
    expect(assistant.blocks[0].type).toBe("tool_call");
    expect(assistant.blocks[0].toolCall).toBeDefined();
    expect(assistant.blocks[0].toolCall.id).toBe(toolCall.id);
    expect(assistant.blocks[0].toolCall.toolName).toBe("Bash");
    expect(assistant.blocks[0].toolCall.state).toBe("complete");
    expect(assistant.blocks[0].toolCall.request).toEqual({ command: "ls" });
    expect(assistant.blocks[0].toolCall.response).toEqual({
      output: "file1.txt\nfile2.txt",
    });
  });

  it("getActiveStream returns active prompt and non-finalized blocks", async () => {
    const convId = await service.createConversation(userId);
    const { promptId } = await service.createUserMessage(convId, "stream me");

    // mark prompt IN_PROGRESS and create a streaming block (not finalized)
    await testDb
      .update(prompts)
      .set({ state: "IN_PROGRESS" })
      .where(eq(prompts.id, promptId));

    await testDb.insert(blocks).values({
      promptId,
      type: "text",
      indexNum: 0,
      content: "partial",
      isFinalized: false,
    });

    const active = await service.getActiveStream(convId);
    expect(active).not.toBeNull();
    expect(active?.prompt.id).toBe(promptId);
    expect(active?.blocks.length).toBe(1);
    expect(active?.blocks.at(0)?.isFinalized).toBe(false);
  });

  it("lists conversations ordered by updatedAt desc", async () => {
    const convA = await service.createConversation(userId, "A");
    const convB = await service.createConversation(userId, "B");

    // bump updatedAt of A older, B newer
    const now = new Date();
    const older = new Date(now.getTime() - 60_000);
    await testDb
      .update(conversations)
      .set({ updatedAt: older })
      .where(eq(conversations.id, convA));

    const list = await service.listConversations(userId);
    expect(list.length).toBe(2);
    // B should come first
    expect(list.at(0)?.title).toBe("B");
  });

  it("builds conversation history with user and assistant text only", async () => {
    const convId = await service.createConversation(userId);
    const { promptId } = await service.createUserMessage(convId, "Hi");

    const [prompt] = await testDb
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId));

    // finalize assistant message with text block
    await testDb.insert(blocks).values({
      promptId,
      messageId: prompt.messageId!,
      type: "text",
      indexNum: 0,
      content: "Hello!",
      isFinalized: true,
    });
    await testDb
      .update(messages)
      .set({ isComplete: true })
      .where(eq(messages.id, prompt.messageId!));

    const history = await service.buildConversationHistory(convId, userId);
    expect(history).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ]);
  });
});
