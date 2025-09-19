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
      blocks: [
        {
          id: 'block-1',
          type: 'text',
          content:
            'Can you help me set up a new development environment for a Node.js project?',
        },
      ],
      timestamp: '2024-12-01T10:00:00Z',
    },
    {
      id: 'msg-2',
      type: 'assistant',
      blocks: [
        {
          id: 'block-2',
          type: 'text',
          content:
            "I'll help you set up a Node.js development environment. Let me first check your current system and then create the necessary files.",
        },
        {
          id: 'block-3',
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: 'bash',
            input: {
              command: 'node --version && npm --version',
              description: 'Check Node.js and npm versions',
            },
          },
        },
        {
          id: 'block-4',
          type: 'tool_result',
          content: '',
          metadata: {
            toolName: 'bash',
            toolUseId: 'tool-1',
            output: 'v20.10.0\n10.2.3',
          },
        },
      ],
      timestamp: '2024-12-01T10:00:15Z',
      metadata: {
        model: 'claude-3-sonnet',
        tokens: 45,
        cost: 0.0012,
      },
      toolCalls: [
        {
          id: 'tool-1',
          name: 'bash',
          parameters: {
            command: 'node --version && npm --version',
            description: 'Check Node.js and npm versions',
          },
          result: 'v20.10.0\n10.2.3',
          status: 'completed',
          startTime: '2024-12-01T10:00:16Z',
          endTime: '2024-12-01T10:00:17Z',
        },
      ],
    },
    {
      id: 'msg-3',
      type: 'assistant',
      blocks: [
        {
          id: 'block-5',
          type: 'text',
          content:
            "Great! You have Node.js v20.10.0 and npm v10.2.3 installed. Now I'll create a basic project structure with TypeScript support.",
        },
        {
          id: 'block-6',
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: 'write',
            input: {
              filePath: './package.json',
              content: JSON.stringify(
                {
                  name: 'my-project',
                  version: '1.0.0',
                  type: 'module',
                  scripts: {
                    dev: 'tsx src/index.ts',
                    build: 'tsc',
                    start: 'node dist/index.js',
                  },
                },
                null,
                2
              ),
            },
          },
        },
        {
          id: 'block-7',
          type: 'tool_result',
          content: '',
          metadata: {
            toolName: 'write',
            toolUseId: 'tool-2',
            output: 'File created successfully',
          },
        },
        {
          id: 'block-8',
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: 'bash',
            input: {
              command: 'npm install -D typescript tsx @types/node',
              description: 'Install TypeScript dependencies',
            },
          },
        },
        {
          id: 'block-9',
          type: 'tool_result',
          content: '',
          metadata: {
            toolName: 'bash',
            toolUseId: 'tool-3',
            output: 'added 12 packages in 3.2s',
          },
        },
      ],
      timestamp: '2024-12-01T10:00:20Z',
      metadata: {
        model: 'claude-3-sonnet',
        tokens: 32,
        cost: 0.0008,
      },
      toolCalls: [
        {
          id: 'tool-2',
          name: 'write',
          parameters: {
            filePath: './package.json',
            content: JSON.stringify(
              {
                name: 'my-project',
                version: '1.0.0',
                type: 'module',
                scripts: {
                  dev: 'tsx src/index.ts',
                  build: 'tsc',
                  start: 'node dist/index.js',
                },
              },
              null,
              2
            ),
          },
          result: 'File created successfully',
          status: 'completed',
          startTime: '2024-12-01T10:00:21Z',
          endTime: '2024-12-01T10:00:22Z',
        },
        {
          id: 'tool-3',
          name: 'bash',
          parameters: {
            command: 'npm install -D typescript tsx @types/node',
            description: 'Install TypeScript dependencies',
          },
          result: 'added 12 packages in 3.2s',
          status: 'completed',
          startTime: '2024-12-01T10:00:23Z',
          endTime: '2024-12-01T10:00:26Z',
        },
      ],
    },
    {
      id: 'msg-4',
      type: 'user',
      blocks: [
        {
          id: 'block-10',
          type: 'text',
          content:
            'Perfect! Can you also add ESLint and Prettier for code formatting?',
        },
      ],
      timestamp: '2024-12-01T10:05:00Z',
    },
    {
      id: 'msg-5',
      type: 'assistant',
      blocks: [
        {
          id: 'block-11',
          type: 'text',
          content:
            "Absolutely! I'll add ESLint and Prettier to maintain consistent code quality and formatting.",
        },
        {
          id: 'block-12',
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: 'bash',
            input: {
              command:
                'npm install -D eslint @biomejs/biome @typescript-eslint/parser @typescript-eslint/eslint-plugin',
              description: 'Install ESLint and Biome',
            },
          },
        },
        {
          id: 'block-13',
          type: 'tool_result',
          content: '',
          metadata: {
            toolName: 'bash',
            toolUseId: 'tool-4',
            output: 'added 45 packages in 5.1s',
          },
        },
        {
          id: 'block-14',
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: 'write',
            input: {
              filePath: './.eslintrc.json',
              content: JSON.stringify(
                {
                  extends: ['@typescript-eslint/recommended'],
                  parser: '@typescript-eslint/parser',
                  plugins: ['@typescript-eslint'],
                  rules: {},
                },
                null,
                2
              ),
            },
          },
        },
        {
          id: 'block-15',
          type: 'tool_result',
          content: '',
          metadata: {
            toolName: 'write',
            toolUseId: 'tool-5',
            output: 'ESLint configuration created',
          },
        },
      ],
      timestamp: '2024-12-01T10:05:05Z',
      metadata: {
        model: 'claude-3-sonnet',
        tokens: 28,
        cost: 0.0007,
      },
      toolCalls: [
        {
          id: 'tool-4',
          name: 'bash',
          parameters: {
            command:
              'npm install -D eslint @biomejs/biome @typescript-eslint/parser @typescript-eslint/eslint-plugin',
            description: 'Install ESLint and Biome',
          },
          result: 'added 45 packages in 5.1s',
          status: 'completed',
          startTime: '2024-12-01T10:05:06Z',
          endTime: '2024-12-01T10:05:11Z',
        },
        {
          id: 'tool-5',
          name: 'write',
          parameters: {
            filePath: './.eslintrc.json',
            content: JSON.stringify(
              {
                extends: ['@typescript-eslint/recommended'],
                parser: '@typescript-eslint/parser',
                plugins: ['@typescript-eslint'],
                rules: {},
              },
              null,
              2
            ),
          },
          result: 'ESLint configuration created',
          status: 'completed',
          startTime: '2024-12-01T10:05:12Z',
          endTime: '2024-12-01T10:05:13Z',
        },
      ],
    },
    {
      id: 'msg-6',
      type: 'user',
      blocks: [
        {
          id: 'block-16',
          type: 'text',
          content:
            'Can you also schedule a meeting for next week to review this project?',
        },
      ],
      timestamp: '2024-12-01T10:15:00Z',
    },
    {
      id: 'msg-7',
      type: 'assistant',
      blocks: [
        {
          id: 'block-17',
          type: 'text',
          content:
            "I'll schedule a project review meeting for next week and send invitations to the team.",
        },
        {
          id: 'block-18',
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: 'google_calendar',
            input: {
              action: 'create_event',
              title: 'Node.js Project Review',
              start_time: '2024-12-08T14:00:00Z',
              end_time: '2024-12-08T15:00:00Z',
              location: 'Conference Room A',
              attendees: ['team@company.com', 'manager@company.com'],
            },
          },
        },
        {
          id: 'block-19',
          type: 'tool_result',
          content: '',
          metadata: {
            toolName: 'google_calendar',
            toolUseId: 'tool-8',
            output:
              'Meeting scheduled successfully. Calendar invite sent to all attendees.',
          },
        },
        {
          id: 'block-20',
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: 'gmail',
            input: {
              action: 'send_email',
              to: 'team@company.com',
              subject: 'Project Review Meeting - Dec 8th',
              body: "Hi team,\n\nI've scheduled our Node.js project review meeting for next Friday, December 8th at 2:00 PM in Conference Room A.\n\nWe'll be reviewing:\n- Development environment setup\n- Code structure and architecture\n- Next steps for the project\n\nLooking forward to seeing everyone there!\n\nBest regards",
            },
          },
        },
        {
          id: 'block-21',
          type: 'tool_result',
          content: '',
          metadata: {
            toolName: 'gmail',
            toolUseId: 'tool-9',
            output: 'Email sent successfully to team@company.com',
          },
        },
      ],
      timestamp: '2024-12-01T10:15:05Z',
      metadata: {
        model: 'claude-3-sonnet',
        tokens: 22,
        cost: 0.0006,
      },
      toolCalls: [
        {
          id: 'tool-8',
          name: 'google_calendar',
          parameters: {
            action: 'create_event',
            title: 'Node.js Project Review',
            start_time: '2024-12-08T14:00:00Z',
            end_time: '2024-12-08T15:00:00Z',
            location: 'Conference Room A',
            attendees: ['team@company.com', 'manager@company.com'],
          },
          result:
            'Meeting scheduled successfully. Calendar invite sent to all attendees.',
          status: 'completed',
          startTime: '2024-12-01T10:15:06Z',
          endTime: '2024-12-01T10:15:08Z',
        },
        {
          id: 'tool-9',
          name: 'gmail',
          parameters: {
            action: 'send_email',
            to: 'team@company.com',
            subject: 'Project Review Meeting - Dec 8th',
            body: "Hi team,\n\nI've scheduled our Node.js project review meeting for next Friday, December 8th at 2:00 PM in Conference Room A.\n\nWe'll be reviewing:\n- Development environment setup\n- Code structure and architecture\n- Next steps for the project\n\nLooking forward to seeing everyone there!\n\nBest regards",
          },
          result: 'Email sent successfully to team@company.com',
          status: 'completed',
          startTime: '2024-12-01T10:15:09Z',
          endTime: '2024-12-01T10:15:11Z',
        },
      ],
    },
    {
      id: 'msg-8',
      type: 'user',
      blocks: [
        {
          id: 'block-22',
          type: 'text',
          content:
            'Perfect! Can you also create a task in Asana to track the project setup completion?',
        },
      ],
      timestamp: '2024-12-01T10:20:00Z',
    },
    {
      id: 'msg-9',
      type: 'assistant',
      blocks: [
        {
          id: 'block-23',
          type: 'text',
          content:
            "I'll create an Asana task to track the project setup and assign it to you with the appropriate details.",
        },
        {
          id: 'block-24',
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: 'asana',
            input: {
              action: 'create_task',
              name: 'Complete Node.js Development Environment Setup',
              project: 'Development Projects',
              assignee: 'user@company.com',
              due_date: '2024-12-05',
              description:
                'Set up complete Node.js development environment with TypeScript, ESLint, Prettier, and basic HTTP server. Includes package.json configuration and development scripts.',
            },
          },
        },
        {
          id: 'block-25',
          type: 'tool_result',
          content: '',
          metadata: {
            toolName: 'asana',
            toolUseId: 'tool-10',
            output: 'Task created successfully in Asana. Task ID: #1234567',
          },
        },
      ],
      timestamp: '2024-12-01T10:20:05Z',
      metadata: {
        model: 'claude-3-sonnet',
        tokens: 26,
        cost: 0.0007,
      },
      toolCalls: [
        {
          id: 'tool-10',
          name: 'asana',
          parameters: {
            action: 'create_task',
            name: 'Complete Node.js Development Environment Setup',
            project: 'Development Projects',
            assignee: 'user@company.com',
            due_date: '2024-12-05',
            description:
              'Set up complete Node.js development environment with TypeScript, ESLint, Prettier, and basic HTTP server. Includes package.json configuration and development scripts.',
          },
          result: 'Task created successfully in Asana. Task ID: #1234567',
          status: 'completed',
          startTime: '2024-12-01T10:20:06Z',
          endTime: '2024-12-01T10:20:08Z',
        },
      ],
    },
    {
      id: 'msg-10',
      type: 'assistant',
      blocks: [
        {
          id: 'block-26',
          type: 'text',
          content:
            'Great! Now I need to create a simple HTTP server. Let me set that up for you.',
        },
        {
          id: 'block-27',
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: 'write',
            input: {
              filePath: './src/index.ts',
              content: `import http from 'http'\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'application/json' })\n  res.end(JSON.stringify({ message: 'Hello World!' }))\n})\n\nserver.listen(3000, () => {\n  console.log('Server running on http://localhost:3000')\n})`,
            },
          },
        },
        {
          id: 'block-28',
          type: 'tool_result',
          content: '',
          metadata: {
            toolName: 'write',
            toolUseId: 'tool-11',
            output: 'HTTP server created',
          },
        },
        {
          id: 'block-29',
          type: 'tool_use',
          content: '',
          metadata: {
            toolName: 'bash',
            input: {
              command: 'npm run dev',
              description: 'Start development server',
            },
          },
        },
      ],
      timestamp: '2024-12-01T10:25:10Z',
      metadata: {
        model: 'claude-3-sonnet',
        tokens: 35,
        cost: 0.0009,
      },
      toolCalls: [
        {
          id: 'tool-11',
          name: 'write',
          parameters: {
            filePath: './src/index.ts',
            content: `import http from 'http'\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'application/json' })\n  res.end(JSON.stringify({ message: 'Hello World!' }))\n})\n\nserver.listen(3000, () => {\n  console.log('Server running on http://localhost:3000')\n})`,
          },
          result: 'HTTP server created',
          status: 'completed',
          startTime: '2024-12-01T10:25:11Z',
          endTime: '2024-12-01T10:25:12Z',
        },
        {
          id: 'tool-12',
          name: 'bash',
          parameters: {
            command: 'npm run dev',
            description: 'Start development server',
          },
          status: 'running',
          startTime: '2024-12-01T10:25:15Z',
        },
      ],
    },
  ],
}
