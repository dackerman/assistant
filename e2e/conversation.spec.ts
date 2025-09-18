import { test, expect } from '@playwright/test'

test.describe('Conversation Functionality', () => {
  test('should be able to start a new conversation', async ({ page }) => {
    await page.goto('/')

    // Look for message input or new conversation button
    const messageInput = page.locator('textarea, input[type="text"]').first()

    if (await messageInput.isVisible()) {
      // Try to type a message
      await messageInput.fill('Hello, this is a test message')

      // Look for send button
      const sendButton = page.locator('button:has-text("Send"), button[type="submit"], button:has(svg)').last()
      if (await sendButton.isVisible()) {
        await sendButton.click()

        // Wait for message to appear
        await expect(page.locator('text=Hello, this is a test message')).toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('should navigate between conversations', async ({ page }) => {
    await page.goto('/')

    // Check if we can navigate to a specific conversation
    await page.goto('/conversation/1')

    // Should load without errors
    await expect(page).toHaveURL(/\/conversation\/1/)
    await expect(page.locator('[data-testid="conversation-view"]')).toBeVisible({ timeout: 10000 })
  })

  test('should handle conversation creation', async ({ page }) => {
    await page.goto('/')

    // Look for new conversation button
    const newConversationButton = page.locator('button:has-text("New"), button:has-text("Start"), [data-testid="new-conversation"]').first()

    if (await newConversationButton.isVisible()) {
      await newConversationButton.click()

      // Should navigate to home or new conversation
      await expect(page).toHaveURL('/')
    }
  })
})