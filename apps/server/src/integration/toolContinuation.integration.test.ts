import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  events,
  blocks,
  conversations,
  messages,
  prompts,
  toolCalls,
  users,
} from "../db/schema.js";
import { ConversationService } from "../services/conversationService.js";
import { ToolExecutorService } from "../services/toolExecutorService.js";
import { StreamingStateMachine } from "../streaming/stateMachine.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  testDb,
} from "../test/setup.js";

describe("Tool Continuation Integration Test", () => {
  let conversationService: ConversationService;
  let toolExecutorService: ToolExecutorService;
  let userId: number;

  beforeAll(async () => {
    await setupTestDatabase();

    // Create test infrastructure
    conversationService = new ConversationService(testDb);
    toolExecutorService = new ToolExecutorService(testDb);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    // Create test user
    const [user] = await testDb
      .insert(users)
      .values({
        email: "test@example.com",
      })
      .returning();
    userId = user.id;
  });

  afterEach(async () => {
    // Clean up test data and reset mocks
    vi.restoreAllMocks();
    await testDb.delete(toolCalls);
    await testDb.delete(events);
    await testDb.delete(blocks);
    await testDb.delete(prompts);
    await testDb.delete(messages);
    await testDb.delete(conversations);
    await testDb.delete(users);
  });

  describe("Complete tool continuation flow", () => {
    it("should handle user message → AI tool call → tool execution → AI continuation", async () => {
      // Step 1: Create conversation
      const conversationId = await conversationService.createConversation(
        userId,
        "Tool Test Conversation",
      );

      // Step 2: Send user message (creates database setup)
      const { userMessageId, promptId } =
        await conversationService.createUserMessage(
          conversationId,
          "Find the largest file in the current directory",
        );

      // Step 3: Mock bash tool to return predictable results
      const mockToolResult = {
        output: "total 42\n-rw-r--r-- 1 user user 1234 test.txt",
        exitCode: 0,
      };
      mockBashTool(mockToolResult);

      // Step 4: Simulate the complete Anthropic streaming process
      await simulateAnthropicStreamWithToolCall(
        promptId,
        conversationId,
        mockToolResult,
        toolExecutorService,
      );

      // Step 5: Verify final state - conversation should have continued after tool execution
      const finalConversation = await conversationService.getConversation(
        conversationId,
        userId,
      );

      // Should have the user message + AI response
      expect(finalConversation.messages).toHaveLength(2);

      const aiMessage = finalConversation.messages.find(
        (m) => m.role === "assistant",
      );
      expect(aiMessage).toBeDefined();
      expect(aiMessage?.blocks).toBeDefined();

      // Should have both text blocks AND the tool call block
      const toolCallBlock = aiMessage?.blocks?.find(
        (b) => b.type === "tool_call",
      );
      const textBlocks =
        aiMessage?.blocks?.filter((b) => b.type === "text") || [];

      expect(toolCallBlock).toBeDefined();
      expect(textBlocks.length).toBeGreaterThan(0);

      // Verify tool call was executed successfully
      const toolCall = toolCallBlock?.toolCall;
      expect(toolCall?.state).toBe("complete");
      expect(toolCall?.response).toContain("test.txt");

      // Verify message_stop event was created and handled properly
      const messageStopEvents = await testDb
        .select()
        .from(events)
        .where(eq(events.type, "message_stop"));
      expect(messageStopEvents.length).toBeGreaterThan(0);

      // Verify prompt completed successfully
      const finalPrompt = await testDb.query.prompts.findFirst({
        where: eq(prompts.id, promptId),
      });
      expect(finalPrompt?.state).toBe("COMPLETED");

      // Verify there are continuation blocks after the tool call
      // This proves the AI continued responding after seeing tool results
      const allBlocks = aiMessage?.blocks || [];
      const toolBlockIndex = allBlocks.findIndex((b) => b.type === "tool_call");
      expect(toolBlockIndex).toBeGreaterThan(-1);

      // There should be text blocks after the tool call block
      const blocksAfterTool = allBlocks.slice(toolBlockIndex + 1);
      const textAfterTool = blocksAfterTool.filter((b) => b.type === "text");
      expect(textAfterTool.length).toBeGreaterThan(0);
    });
  });
});

// Test infrastructure functions

function mockBashTool(result: { output: string; exitCode: number }) {
  // Mock the bash tool execution - but don't complete it immediately
  // This allows us to test the proper tool continuation flow
  vi.spyOn(ToolExecutorService.prototype, "executeToolCall").mockImplementation(
    async (toolCallId: number) => {
      // Just mark as running, don't complete yet
      // The test will complete it manually when needed
      await testDb
        .update(toolCalls)
        .set({
          state: "running",
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(toolCalls.id, toolCallId));
    },
  );

  return result; // Return result for manual completion later
}

/**
 * Simulates the complete Anthropic streaming process including tool continuation
 * This recreates what normally happens in startAnthropicStream() + waitForToolsAndContinue()
 */
async function simulateAnthropicStreamWithToolCall(
  promptId: number,
  conversationId: number,
  mockToolResult: any,
  toolExecutorService: ToolExecutorService,
) {
  // Create the streaming state machine
  const stateMachine = new StreamingStateMachine(
    promptId,
    testDb,
    toolExecutorService,
  );

  // Phase 1: Initial AI response with tool call
  // Simulate the Anthropic stream events that would create a tool call

  // Message start
  await stateMachine.processStreamEvent({
    type: "block_start",
    blockType: "text",
    blockIndex: 0,
  });

  // AI text before tool call
  await stateMachine.processStreamEvent({
    type: "block_delta",
    blockIndex: 0,
    delta:
      "I'll help you find the largest file. Let me search the current directory.",
  });

  // End text block
  await stateMachine.processStreamEvent({
    type: "block_end",
    blockIndex: 0,
  });

  // Start tool call block
  await stateMachine.processStreamEvent({
    type: "block_start",
    blockType: "tool_call",
    blockIndex: 1,
  });

  // Tool call JSON data (built up via deltas)
  await stateMachine.processStreamEvent({
    type: "block_delta",
    blockIndex: 1,
    delta: '{"command": "ls -la"}',
  });

  // End tool call block (this creates the tool call in the database)
  await stateMachine.processStreamEvent({
    type: "block_end",
    blockType: "tool_call",
    blockIndex: 1,
    toolCallData: {
      apiToolCallId: "toolu_test123",
      toolName: "bash",
      request: { command: "ls -la" },
    },
  });

  // Debug: Check if tool call was actually created
  const toolsAfterBlock = await testDb
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.promptId, promptId));
  console.log(
    "DEBUG: Tool calls after block_end:",
    toolsAfterBlock.map((t) => ({
      id: t.id,
      state: t.state,
      toolName: t.toolName,
    })),
  );

  // Phase 2: Message stop (this should detect pending tools and start continuation)
  // First, let's check what tool calls exist before message_stop
  const toolsBeforeStop = await testDb
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.promptId, promptId));
  console.log(
    "DEBUG: Tool calls before message_stop:",
    toolsBeforeStop.map((t) => ({ id: t.id, state: t.state })),
  );

  const messageStopResult = await stateMachine.handleMessageStop();
  console.log("DEBUG: message_stop result:", messageStopResult);

  // Verify that tools were detected as pending
  expect(messageStopResult.waitingForTools).toBe(true);

  // Phase 3: Manually complete the tool execution (simulating async completion)
  // Get the tool call that was created
  const toolCallsInDb = await testDb
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.promptId, promptId));

  expect(toolCallsInDb).toHaveLength(1);
  const toolCallToComplete = toolCallsInDb[0];
  expect(toolCallToComplete?.state).toBe("running");

  // Now complete the tool call with our mock result
  await testDb
    .update(toolCalls)
    .set({
      state: "complete",
      response: JSON.stringify(mockToolResult),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(toolCalls.id, toolCallToComplete?.id));

  // Phase 4: Continue streaming with tool results
  // This simulates what continueStreamingWithToolResults() does

  // Get current block count for proper indexing
  const existingBlocks = await testDb
    .select()
    .from(blocks)
    .where(eq(blocks.promptId, promptId));
  const blockOffset = existingBlocks.length;

  // Simulate continuation response from AI after seeing tool results
  await stateMachine.processStreamEvent({
    type: "block_start",
    blockType: "text",
    blockIndex: blockOffset, // Continue from where we left off
  });

  await stateMachine.processStreamEvent({
    type: "block_delta",
    blockIndex: blockOffset,
    delta:
      "Based on the directory listing, I can see there is a file named 'test.txt' with 1234 bytes. ",
  });

  await stateMachine.processStreamEvent({
    type: "block_delta",
    blockIndex: blockOffset,
    delta: "This appears to be the largest file in the directory.",
  });

  await stateMachine.processStreamEvent({
    type: "block_end",
    blockIndex: blockOffset,
  });

  // Final message stop (no more tools, should complete)
  const finalMessageStopResult = await stateMachine.handleMessageStop();
  expect(finalMessageStopResult.waitingForTools).toBe(false);
}
