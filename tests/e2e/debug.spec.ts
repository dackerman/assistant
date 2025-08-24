import { test, expect } from '@playwright/test';

test.describe('Debug Test - Visual Confirmation', () => {
  test('visual test run - shows browser actions', async ({ page }) => {
    // Slow down actions so they're visible
    test.slow();

    console.log('📍 Step 1: Going to homepage...');
    await page.goto('/');
    await page.waitForTimeout(1000); // Pause to see

    console.log('📍 Step 2: Checking session picker is visible...');
    await expect(page.locator('h2')).toContainText('Select a Session');
    await page.waitForTimeout(1000);

    console.log('📍 Step 3: Clicking "Start New Session" button...');
    await page.click('.new-session-btn');
    await page.waitForTimeout(1000);

    console.log('📍 Step 4: Verifying main app loaded...');
    await expect(page.locator('.message-input-field')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Personal Assistant');
    await page.waitForTimeout(1000);

    console.log('📍 Step 5: Typing a message...');
    await page.fill('.message-input-field', 'This is a test message');
    await page.waitForTimeout(1000);

    console.log('📍 Step 6: Sending the message...');
    await page.click('.message-send-button');
    await page.waitForTimeout(1000);

    console.log('📍 Step 7: Verifying message appears...');
    await expect(page.locator('.message.user').first()).toContainText(
      'This is a test message'
    );

    console.log('✅ Visual test complete!');
  });
});
