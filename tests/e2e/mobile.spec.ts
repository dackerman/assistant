import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 12'] });

test.describe('Mobile Experience', () => {
  test('should be responsive on mobile', async ({ page }) => {
    await page.goto('/');

    // Session picker should be mobile-friendly
    const header = page.locator('.session-picker-header');
    await expect(header).toBeVisible();

    // Start new session
    await page.click('.new-session-btn');

    // Check mobile layout
    const appHeader = page.locator('.app-header');
    await expect(appHeader).toBeVisible();

    // Message input should be visible at bottom
    const messageInput = page.locator('.message-input-field');
    await expect(messageInput).toBeVisible();

    // Check viewport adjustments
    const viewport = page.viewportSize();
    expect(viewport?.width).toBeLessThan(768);
  });

  test('should handle touch interactions', async ({ page }) => {
    await page.goto('/');
    await page.tap('.new-session-btn');

    // Should navigate to main app
    await expect(page.locator('h1')).toContainText('Personal Assistant');

    // Tap to focus input
    await page.tap('.message-input-field');

    // Type message
    await page.fill('.message-input-field', 'Test message');

    // Tap send button
    await page.tap('.message-send-button');

    // Message should appear
    await expect(page.locator('.message.user').first()).toContainText(
      'Test message'
    );
  });

  test('debug panel should stack vertically on mobile', async ({ page }) => {
    await page.goto('/');
    await page.tap('.new-session-btn');

    // Open debug panel
    await page.tap('.debug-toggle');

    // Debug panel should be visible
    const debugPane = page.locator('.debug-pane-container');
    await expect(debugPane).toBeVisible();

    // On mobile, it should stack below (check CSS is applied)
    const debugPaneBox = await debugPane.boundingBox();
    const mainPaneBox = await page.locator('.main-pane').boundingBox();

    if (debugPaneBox && mainPaneBox) {
      // Debug pane should be below main pane on mobile
      expect(debugPaneBox.y).toBeGreaterThan(mainPaneBox.y);
    }
  });
});
