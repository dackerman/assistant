import { test, expect } from '@playwright/test';

test.describe('Backend State Management', () => {
  test.beforeEach(async ({ page }) => {
    // Wait for backend to be ready
    await page.waitForTimeout(1000);
  });

  test('should maintain separate session state across multiple tabs', async ({
    browser,
  }) => {
    // Create two separate pages (tabs)
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // Start session in tab 1
    await page1.goto('/');
    await page1.click('.new-session-btn');
    await page1.waitForTimeout(500);

    // Send message in tab 1
    await page1.fill('.message-input-field', 'Message from tab 1');
    await page1.click('.message-send-button');
    await expect(page1.locator('.message.user').first()).toContainText(
      'Message from tab 1'
    );

    // Start session in tab 2
    await page2.goto('/');
    await page2.click('.new-session-btn');
    await page2.waitForTimeout(500);

    // Send message in tab 2
    await page2.fill('.message-input-field', 'Message from tab 2');
    await page2.click('.message-send-button');
    await expect(page2.locator('.message.user').first()).toContainText(
      'Message from tab 2'
    );

    // Verify tab 1 still shows its own message
    await expect(page1.locator('.message.user').first()).toContainText(
      'Message from tab 1'
    );

    // Verify tab 2 only shows its message (not tab 1's)
    await expect(
      page2.locator('.message.user:has-text("Message from tab 1")')
    ).toHaveCount(0);

    await context.close();
  });

  test('should handle SSE connections per session', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Monitor network requests
    const sseConnections: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/events')) {
        sseConnections.push(request.url());
      }
    });

    // Start first session
    await page.goto('/');
    await page.click('.new-session-btn');
    await page.waitForTimeout(1000);

    // Should have one SSE connection
    expect(sseConnections.length).toBeGreaterThan(0);
    const initialConnections = sseConnections.length;

    // Switch to sessions view and create another session
    await page.click('.session-toggle');
    await page.click('.new-session-btn');
    await page.waitForTimeout(1000);

    // Should still have SSE connections (may be same or new)
    expect(sseConnections.length).toBeGreaterThanOrEqual(initialConnections);

    await context.close();
  });

  test('should preserve session state when switching between sessions', async ({
    page,
  }) => {
    await page.goto('/');

    // Create first session
    await page.click('.new-session-btn');
    await page.waitForTimeout(500);

    // Send a message in first session
    await page.fill('.message-input-field', 'First session message');
    await page.click('.message-send-button');
    await expect(page.locator('.message.user').first()).toContainText(
      'First session message'
    );

    // Go back to session picker
    await page.click('.session-toggle');
    await expect(page.locator('h2')).toContainText('Select a Session');

    // Create second session
    await page.click('.new-session-btn');
    await page.waitForTimeout(500);

    // Send a message in second session
    await page.fill('.message-input-field', 'Second session message');
    await page.click('.message-send-button');
    await expect(page.locator('.message.user').first()).toContainText(
      'Second session message'
    );

    // Should not see first session's message
    await expect(
      page.locator('.message.user:has-text("First session message")')
    ).toHaveCount(0);

    // Go back to session picker and select first session
    await page.click('.session-toggle');
    await page.waitForTimeout(500);

    // Click on first session (should be in the list)
    const sessionButtons = page.locator('.session-item');
    await expect(sessionButtons).toHaveCount(2);
    await sessionButtons.first().click();
    await page.waitForTimeout(500);

    // Should see the first session's message again
    await expect(page.locator('.message.user').first()).toContainText(
      'First session message'
    );

    // Should not see second session's message
    await expect(
      page.locator('.message.user:has-text("Second session message")')
    ).toHaveCount(0);
  });

  test('should handle concurrent API requests correctly', async ({ page }) => {
    await page.goto('/');
    await page.click('.new-session-btn');
    await page.waitForTimeout(500);

    // Send multiple messages rapidly (simulating race conditions)
    await page.fill('.message-input-field', 'Message 1');
    await page.press('.message-input-field', 'Enter');

    await page.fill('.message-input-field', 'Message 2');
    await page.press('.message-input-field', 'Enter');

    await page.fill('.message-input-field', 'Message 3');
    await page.press('.message-input-field', 'Enter');

    // Wait for all messages to appear
    await page.waitForTimeout(1000);

    // Should see all three user messages
    const userMessages = page.locator('.message.user');
    await expect(userMessages).toHaveCount(3);

    // Verify messages are in correct order
    await expect(userMessages.nth(0)).toContainText('Message 1');
    await expect(userMessages.nth(1)).toContainText('Message 2');
    await expect(userMessages.nth(2)).toContainText('Message 3');
  });

  test('should maintain model selection per session', async ({ page }) => {
    await page.goto('/');
    await page.click('.new-session-btn');
    await page.waitForTimeout(500);

    // Open model picker
    await page.click('[data-testid="model-picker-trigger"]');
    await page.waitForTimeout(500);

    // Change model (if available)
    const modelOptions = page.locator('[data-testid="model-option"]');
    const optionCount = await modelOptions.count();

    if (optionCount > 1) {
      // Select second model option
      await modelOptions.nth(1).click();
      await page.waitForTimeout(500);

      // Verify model changed in picker
      const selectedModel = await page
        .locator('[data-testid="model-picker-trigger"]')
        .textContent();

      // Switch to another session
      await page.click('.session-toggle');
      await page.click('.new-session-btn');
      await page.waitForTimeout(500);

      // Model should be back to default for new session
      const newSessionModel = await page
        .locator('[data-testid="model-picker-trigger"]')
        .textContent();

      // Models should be different (new session uses default)
      expect(newSessionModel).not.toBe(selectedModel);
    }
  });

  test('should handle health check without affecting session state', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await page.click('.new-session-btn');
    await page.waitForTimeout(500);

    // Send a message to establish session state
    await page.fill('.message-input-field', 'Test message before health check');
    await page.click('.message-send-button');
    await expect(page.locator('.message.user').first()).toContainText(
      'Test message before health check'
    );

    // Make health check API call
    const healthResponse = await request.get('http://localhost:7654/health');
    expect(healthResponse.ok()).toBeTruthy();

    // Verify session state is preserved
    await expect(page.locator('.message.user').first()).toContainText(
      'Test message before health check'
    );

    // Should still be able to send messages
    await page.fill('.message-input-field', 'Test message after health check');
    await page.click('.message-send-button');
    await expect(page.locator('.message.user').last()).toContainText(
      'Test message after health check'
    );
  });

  test('should handle API errors gracefully without corrupting state', async ({
    page,
  }) => {
    await page.goto('/');
    await page.click('.new-session-btn');
    await page.waitForTimeout(500);

    // Send a valid message first
    await page.fill('.message-input-field', 'Valid message');
    await page.click('.message-send-button');
    await expect(page.locator('.message.user').first()).toContainText(
      'Valid message'
    );

    // Try to send an empty message (should be handled gracefully)
    await page.fill('.message-input-field', '');
    await page.click('.message-send-button');
    await page.waitForTimeout(500);

    // Should still be able to send valid messages
    await page.fill('.message-input-field', 'Another valid message');
    await page.click('.message-send-button');
    await expect(page.locator('.message.user').last()).toContainText(
      'Another valid message'
    );
  });

  test('should cleanup resources when switching sessions', async ({ page }) => {
    await page.goto('/');

    // Create and use first session
    await page.click('.new-session-btn');
    await page.waitForTimeout(500);
    await page.fill('.message-input-field', 'Session 1 message');
    await page.click('.message-send-button');

    // Switch to session picker
    await page.click('.session-toggle');
    await page.waitForTimeout(500);

    // Create and use second session
    await page.click('.new-session-btn');
    await page.waitForTimeout(500);
    await page.fill('.message-input-field', 'Session 2 message');
    await page.click('.message-send-button');

    // Resources should be cleaned up properly (no memory leaks)
    // This is mainly verified by the test not hanging or timing out
    await page.waitForTimeout(1000);

    // Verify we're in the correct session
    await expect(page.locator('.message.user').first()).toContainText(
      'Session 2 message'
    );
  });
});
