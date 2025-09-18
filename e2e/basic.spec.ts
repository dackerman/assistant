import { test, expect } from '@playwright/test'

test.describe('Basic App Functionality', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/')

    // Check that the page loads without errors
    await expect(page).toHaveTitle(/.*/)

    // Check for main UI elements
    await expect(page.locator('[data-testid="conversation-view"]')).toBeVisible({ timeout: 10000 })
  })

  test('should show mobile menu button on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    // Mobile menu button should be visible
    await expect(page.locator('button[aria-label="Open menu"], button:has(svg)').first()).toBeVisible()
  })

  test('should have sidebar visible on desktop', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    // Sidebar should be visible on desktop
    await expect(page.locator('[data-testid="conversation-sidebar"]')).toBeVisible({ timeout: 10000 })
  })
})