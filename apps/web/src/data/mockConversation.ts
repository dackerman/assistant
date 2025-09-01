import type { Conversation } from '@/types/conversation'

export const mockConversation: Conversation = {
  id: 'conv-1',
  title: 'System Setup & Task Management',
  createdAt: '2024-12-01T10:00:00Z',
  updatedAt: '2024-12-01T11:30:00Z',
  messages: [
    {
      id: 'msg-1',
      type: 'user',
      content: 'Can you help me set up a new development environment for a Node.js project?',
      timestamp: '2024-12-01T10:00:00Z'
    },
    {
      id: 'msg-2',
      type: 'assistant',
      content: 'I\'ll help you set up a Node.js development environment. Let me first check your current system and then create the necessary files.',
      timestamp: '2024-12-01T10:00:15Z',
      metadata: {
        model: 'claude-3-sonnet',
        tokens: 45,
        cost: 0.0012
      },
      toolCalls: [
        {
          id: 'tool-1',
          name: 'bash',
          parameters: {
            command: 'node --version && npm --version',
            description: 'Check Node.js and npm versions'
          },
          result: 'v20.10.0\n10.2.3',
          status: 'completed',
          startTime: '2024-12-01T10:00:16Z',
          endTime: '2024-12-01T10:00:17Z'
        }
      ]
    },
    {
      id: 'msg-3',
      type: 'assistant',
      content: 'Great! You have Node.js v20.10.0 and npm v10.2.3 installed. Now I\'ll create a basic project structure with TypeScript support.',
      timestamp: '2024-12-01T10:00:20Z',
      metadata: {
        model: 'claude-3-sonnet',
        tokens: 32,
        cost: 0.0008
      },
      toolCalls: [
        {
          id: 'tool-2',
          name: 'write',
          parameters: {
            filePath: './package.json',
            content: JSON.stringify({
              name: 'my-project',
              version: '1.0.0',
              type: 'module',
              scripts: {
                dev: 'tsx src/index.ts',
                build: 'tsc',
                start: 'node dist/index.js'
              }
            }, null, 2)
          },
          result: 'File created successfully',
          status: 'completed',
          startTime: '2024-12-01T10:00:21Z',
          endTime: '2024-12-01T10:00:22Z'
        },
        {
          id: 'tool-3',
          name: 'bash',
          parameters: {
            command: 'npm install -D typescript tsx @types/node',
            description: 'Install TypeScript dependencies'
          },
          result: 'added 12 packages in 3.2s',
          status: 'completed',
          startTime: '2024-12-01T10:00:23Z',
          endTime: '2024-12-01T10:00:26Z'
        }
      ]
    },
    {
      id: 'msg-4',
      type: 'user',
      content: 'Perfect! Can you also add ESLint and Prettier for code formatting?',
      timestamp: '2024-12-01T10:05:00Z'
    },
    {
      id: 'msg-5',
      type: 'assistant',
      content: 'Absolutely! I\'ll add ESLint and Prettier to maintain consistent code quality and formatting.',
      timestamp: '2024-12-01T10:05:05Z',
      metadata: {
        model: 'claude-3-sonnet',
        tokens: 28,
        cost: 0.0007
      },
      toolCalls: [
        {
          id: 'tool-4',
          name: 'bash',
          parameters: {
            command: 'npm install -D eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin',
            description: 'Install ESLint and Prettier'
          },
          result: 'added 45 packages in 5.1s',
          status: 'completed',
          startTime: '2024-12-01T10:05:06Z',
          endTime: '2024-12-01T10:05:11Z'
        },
        {
          id: 'tool-5',
          name: 'write',
          parameters: {
            filePath: './.eslintrc.json',
            content: JSON.stringify({
              extends: ['@typescript-eslint/recommended'],
              parser: '@typescript-eslint/parser',
              plugins: ['@typescript-eslint'],
              rules: {}
            }, null, 2)
          },
          result: 'ESLint configuration created',
          status: 'completed',
          startTime: '2024-12-01T10:05:12Z',
          endTime: '2024-12-01T10:05:13Z'
        }
      ]
    },
    {
      id: 'msg-6',
      type: 'system',
      content: 'Development environment setup completed successfully. All tools are now configured and ready to use.',
      timestamp: '2024-12-01T10:05:20Z'
    },
    {
      id: 'msg-7',
      type: 'user',
      content: 'Great! Now I need to create a simple HTTP server. Can you help with that?',
      timestamp: '2024-12-01T10:10:00Z'
    },
    {
      id: 'msg-8',
      type: 'assistant',
      content: 'I\'ll create a simple HTTP server using Node.js built-in modules. Let me set that up for you.',
      timestamp: '2024-12-01T10:10:10Z',
      metadata: {
        model: 'claude-3-sonnet',
        tokens: 35,
        cost: 0.0009
      },
      toolCalls: [
        {
          id: 'tool-6',
          name: 'write',
          parameters: {
            filePath: './src/index.ts',
            content: `import http from 'http'\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'application/json' })\n  res.end(JSON.stringify({ message: 'Hello World!' }))\n})\n\nserver.listen(3000, () => {\n  console.log('Server running on http://localhost:3000')\n})`
          },
          result: 'HTTP server created',
          status: 'completed',
          startTime: '2024-12-01T10:10:11Z',
          endTime: '2024-12-01T10:10:12Z'
        },
        {
          id: 'tool-7',
          name: 'bash',
          parameters: {
            command: 'npm run dev',
            description: 'Start development server'
          },
          status: 'running',
          startTime: '2024-12-01T10:10:15Z'
        }
      ]
    }
  ]
}