import { test, expect } from '@playwright/test';

test.describe('Session Management', () => {
  test.beforeEach(async ({ page }) => {
    // Wait for backend to be ready
    await page.waitForTimeout(1000);
  });

  test('should show session picker on first visit', async ({ page }) => {
    await page.goto('/');

    // Should see the session picker
    await expect(page.locator('h2')).toContainText('Select a Session');
    await expect(page.locator('.new-session-btn')).toBeVisible();
  });

  test('should create a new session', async ({ page }) => {
    await page.goto('/');

    // Click "Start New Session"
    await page.click('.new-session-btn');

    // Should see the main app with message input
    await expect(page.locator('.message-input-field')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Personal Assistant');
  });

  test('should send a message', async ({ page }) => {
    await page.goto('/');
    await page.click('.new-session-btn');

    // Wait for session to be ready
    await page.waitForTimeout(500);

    // Type a simple test message
    await page.fill('.message-input-field', 'Test message');

    // Send the message
    await page.click('.message-send-button');

    // Should see the user message appear
    await expect(page.locator('.message.user').first()).toContainText(
      'Test message'
    );

    // Just verify the message was sent, don't wait for AI response
    // (AI response requires API key configuration)
  });

  test('should toggle debug panel', async ({ page }) => {
    await page.goto('/');
    await page.click('.new-session-btn');

    // Debug panel should not be visible initially
    await expect(page.locator('.debug-pane')).not.toBeVisible();

    // Click the debug toggle
    await page.click('.debug-toggle');

    // Debug panel should now be visible
    await expect(page.locator('.debug-pane')).toBeVisible();
    await expect(page.locator('.debug-header h2')).toContainText(
      'Debug Events'
    );
  });

  test('should navigate back to sessions', async ({ page }) => {
    await page.goto('/');
    await page.click('.new-session-btn');

    // Should be in the main app
    await expect(page.locator('h1')).toContainText('Personal Assistant');

    // Click sessions button
    await page.click('.session-toggle');

    // Should be back at session picker
    await expect(page.locator('h2')).toContainText('Select a Session');
  });
});
