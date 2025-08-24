import { test, expect } from '@playwright/test';

test.describe('Tool Call Integration', () => {
  test('should handle multiple messages in sequence', async ({ page }) => {
    // Test basic message flow without requiring API responses
    test.setTimeout(30000);

    await page.goto('/');
    await page.click('.new-session-btn');
    await page.waitForTimeout(1000);

    console.log('📍 Sending first message...');
    // Send first message
    await page.fill(
      '.message-input-field',
      'List the files in the current directory'
    );
    await page.click('.message-send-button');

    // Verify first user message appears
    await expect(page.locator('.message.user').first()).toContainText(
      'List the files in the current directory'
    );

    // Wait a bit for any response (may or may not get one depending on API)
    await page.waitForTimeout(3000);

    console.log('📍 Sending second message...');
    // Send second message without waiting for response
    await page.fill(
      '.message-input-field',
      'How many TypeScript files are there?'
    );
    await page.click('.message-send-button');

    // Verify second user message appears (messages are shown newest first)
    const userMessages = page.locator('.message.user');
    await expect(userMessages).toHaveCount(2);
    // Messages appear in reverse chronological order (newest first)
    await expect(userMessages.first()).toContainText(
      'How many TypeScript files are there?'
    );
    await expect(userMessages.nth(1)).toContainText(
      'List the files in the current directory'
    );

    // Wait a bit more
    await page.waitForTimeout(3000);

    console.log('📍 Sending third message...');
    // Send third message
    await page.fill('.message-input-field', 'Thank you for your help!');
    await page.click('.message-send-button');

    // Verify all three user messages are visible (newest first)
    await expect(userMessages).toHaveCount(3);
    await expect(userMessages.first()).toContainText(
      'Thank you for your help!'
    );
    await expect(userMessages.nth(1)).toContainText(
      'How many TypeScript files are there?'
    );
    await expect(userMessages.nth(2)).toContainText(
      'List the files in the current directory'
    );

    console.log('✅ Multiple message test complete!');

    // Check if we got any assistant responses (optional - don't fail if not)
    const assistantMessages = page.locator('.message.assistant');
    const assistantCount = await assistantMessages.count();
    console.log(`Got ${assistantCount} assistant response(s)`);

    // Check if we got any tool calls (optional - don't fail if not)
    const toolCalls = page.locator('.tool-call-inline');
    const toolCount = await toolCalls.count();
    console.log(`Got ${toolCount} tool call(s)`);
  });

  test.skip('should handle tool calls and follow-up messages', async ({
    page,
  }) => {
    // SKIP THIS TEST - requires API key configuration
    // Keeping it for when API is properly configured
    test.setTimeout(60000);

    // Navigate and create session
    await page.goto('/');
    await page.click('.new-session-btn');

    // Wait for session to be ready
    await page.waitForTimeout(1000);

    console.log('📍 Sending first message requesting tool call...');
    // Send a message that requires a tool call
    await page.fill(
      '.message-input-field',
      'List the files in the current directory'
    );
    await page.click('.message-send-button');

    // Verify user message appears
    await expect(page.locator('.message.user').first()).toContainText(
      'List the files in the current directory'
    );

    // Wait for tool call to appear (should show up as inline tool call)
    console.log('⏳ Waiting for tool call to appear...');
    await expect(page.locator('.tool-call-inline').first()).toBeVisible({
      timeout: 15000,
    });

    // Verify tool call details are visible (should be a list/ls command)
    const toolCall = page.locator('.tool-call-inline').first();
    await expect(toolCall).toContainText(/list|ls|glob/i);

    // Wait for assistant response with the file listing
    console.log('⏳ Waiting for assistant response with file listing...');
    await expect(page.locator('.message.assistant').first()).toBeVisible({
      timeout: 30000,
    });

    // Verify assistant message contains some expected files
    const assistantMessage = page.locator('.message.assistant').first();
    const assistantText = await assistantMessage.textContent();
    console.log(
      'Assistant response received:',
      assistantText?.substring(0, 100) + '...'
    );

    // Should mention some expected files/folders like src, package.json, etc
    expect(assistantText?.toLowerCase()).toMatch(
      /src|package\.json|node_modules|test/
    );

    // Send a follow-up message
    console.log('📍 Sending follow-up message...');
    await page.fill(
      '.message-input-field',
      'How many TypeScript files are in the src directory?'
    );
    await page.click('.message-send-button');

    // Verify second user message appears
    await expect(page.locator('.message.user').nth(1)).toContainText(
      'How many TypeScript files are in the src directory?'
    );

    // Wait for potential second tool call (counting/searching files)
    console.log('⏳ Waiting for second tool call or response...');
    // Either a new tool call or direct response
    await page.waitForSelector(
      '.message.assistant:nth-of-type(2), .tool-call-inline:nth-of-type(2)',
      { timeout: 30000 }
    );

    // Wait for second assistant response
    await expect(page.locator('.message.assistant').nth(1)).toBeVisible({
      timeout: 30000,
    });

    // Verify second response contains a number or count
    const secondAssistantMessage = page.locator('.message.assistant').nth(1);
    const secondAssistantText = await secondAssistantMessage.textContent();
    console.log(
      'Second assistant response:',
      secondAssistantText?.substring(0, 100) + '...'
    );

    // Should mention a number or file count
    expect(secondAssistantText).toMatch(/\d+|file|typescript|\.ts/i);

    console.log('✅ Tool call test complete!');
  });

  test.skip('should display tool call status updates', async ({ page }) => {
    // SKIP THIS TEST - requires API key configuration
    test.setTimeout(45000);

    await page.goto('/');
    await page.click('.new-session-btn');
    await page.waitForTimeout(1000);

    // Send message requiring tool
    await page.fill('.message-input-field', 'What is the current time?');
    await page.click('.message-send-button');

    // Wait for tool call to appear
    const toolCall = page.locator('.tool-call-inline').first();
    await expect(toolCall).toBeVisible({ timeout: 15000 });

    // Check for tool status indicators (pending, running, completed)
    const toolSummary = toolCall.locator('summary');
    await expect(toolSummary).toBeVisible();

    // Should show tool icon and status
    await expect(toolSummary).toContainText(/🛠️/);

    // Verify we eventually get a completed status (green checkmark)
    await expect(toolSummary).toContainText(/✅/, { timeout: 20000 });

    // Verify assistant provides the time in response
    const assistantMessage = page.locator('.message.assistant').first();
    await expect(assistantMessage).toBeVisible({ timeout: 30000 });

    const responseText = await assistantMessage.textContent();
    // Should contain time-related words
    expect(responseText?.toLowerCase()).toMatch(
      /time|date|hour|minute|\d{1,2}:\d{2}/
    );
  });
});
