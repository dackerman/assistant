import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function globalSetup() {
  // Clean up test directory
  const testDir = path.join(__dirname, '..', '.test-opencode');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  console.log('Test environment prepared');

  // Optionally verify services are running
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Check backend health
    const response = await page.request.get('http://localhost:7654/health');
    if (!response.ok()) {
      throw new Error('Backend health check failed');
    }

    await browser.close();
    console.log('Services are ready');
  } catch (error) {
    console.error('Service check failed:', error);
    // Don't fail setup, webServer config will handle startup
  }
}

export default globalSetup;
