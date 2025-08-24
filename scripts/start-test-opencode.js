#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Create test directory
const testDir = path.join(__dirname, '..', '.test-opencode');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

// Write a minimal claude_config.json for testing
const config = {
  opencode: {
    memory: {
      path: path.join(testDir, 'memory'),
    },
  },
  models: {
    default: 'claude-3-5-sonnet-20241022',
  },
};

fs.writeFileSync(
  path.join(testDir, 'claude_config.json'),
  JSON.stringify(config, null, 2)
);

console.log('Starting OpenCode in test directory:', testDir);
console.log('Port: 4096');

// Start OpenCode
const opencode = spawn(
  'opencode',
  ['serve', '--port', '4096', '--hostname', '127.0.0.1'],
  {
    cwd: testDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENCODE_DIR: testDir,
      ANTHROPIC_API_KEY:
        process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    },
  }
);

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down test OpenCode...');
  opencode.kill('SIGINT');
  process.exit();
});

process.on('SIGTERM', () => {
  opencode.kill('SIGTERM');
  process.exit();
});

opencode.on('error', err => {
  console.error('Failed to start OpenCode:', err);
  process.exit(1);
});

opencode.on('exit', code => {
  console.log('OpenCode exited with code:', code);
  process.exit(code || 0);
});
