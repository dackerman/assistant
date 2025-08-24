# Personal Assistant

A powerful AI-powered personal assistant that combines the best of code editing capabilities and conversational AI. Think of it as a mashup of Claude Code and ChatGPT - it can chat naturally while also editing your code and running commands directly on your machine.

## ✨ Features

### 🤖 AI Assistant

- **Natural conversation** - Chat with your AI assistant just like ChatGPT
- **Code understanding** - The AI can read, write, and edit your code files
- **Command execution** - Run terminal commands and see results in real-time
- **Tool integration** - Built-in support for file operations, web searches, and more

### 💻 Developer-Friendly

- **Dark theme** - Beautiful GitHub-inspired dark interface designed for developers
- **Monospace fonts** - Perfect for code readability
- **Real-time updates** - See tool executions and responses as they happen
- **Debug panel** - Optional technical view for troubleshooting

### 📱 Mobile-First Design

- **Responsive layout** - Works seamlessly on phones, tablets, and desktops
- **Touch-friendly** - Large buttons and optimized for mobile interaction
- **Adaptive interface** - Debug panel stacks vertically on mobile
- **Multiline input** - 5-line textarea for longer messages and code snippets

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- OpenCode CLI running on port 4096
- pnpm package manager

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd core

# Install dependencies
pnpm install

# Start the application
pnpm run dev
```

The app will be available at `http://localhost:7653`

### Development

```bash
# Run frontend and backend separately
pnpm run dev:frontend  # Vite dev server (port 7653)
pnpm run dev:backend   # Express server (port 7654)

# Build for production
pnpm run build

# Format code
pnpm run format
```

### Testing

```bash
# Run E2E tests (requires OpenCode on port 4096)
pnpm run test:e2e

# Run tests in Docker (for NixOS compatibility)
pnpm run test:e2e:docker

# Run specific test file
pnpm run test:e2e:docker tests/e2e/session.spec.ts

# Run tests matching pattern (use quotes)
pnpm run test:e2e:docker -g '"should send"'

# Run tests with video recording
pnpm run test:e2e:video

# View test results UI
pnpm run test:report
```

## 🎯 How to Use

### Basic Chat

1. Type your message in the multiline input box at the bottom
2. Click "Send" or press `Cmd/Ctrl + Enter` to send
3. Watch as the AI responds and executes any necessary tools

### Code Editing

The AI can help you with code in several ways:

- **Read files**: "Show me the contents of src/App.tsx"
- **Edit code**: "Add error handling to the login function"
- **Create files**: "Create a new React component for the navigation bar"
- **Debug issues**: "Why is my build failing?"

### Command Execution

Ask the AI to run terminal commands:

- **Git operations**: "Check the git status and commit my changes"
- **Package management**: "Install the latest version of React"
- **File operations**: "List all TypeScript files in the src directory"
- **Build processes**: "Run the tests and show me any failures"

### Debug Mode

- Toggle the debug panel with the "Show Debug" button
- View real-time technical events and API calls
- See detailed tool execution logs
- Perfect for troubleshooting or understanding what's happening behind the scenes

## 💡 Pro Tips

### Keyboard Shortcuts

- `Cmd/Ctrl + Enter` - Send message (allows Enter for new lines)
- Regular `Enter` - Create new line in the input

### Mobile Usage

- **Landscape mode** recommended for coding tasks
- **Debug panel** automatically stacks below main chat on mobile
- **Touch targets** are optimized for thumb navigation
- **Input zoom** prevented on iOS devices

### Best Practices

- Be specific about file paths when asking for code changes
- Use the debug panel when troubleshooting complex operations
- The AI remembers context within your conversation
- Ask for explanations if you want to understand what commands do

## 🏗️ Architecture

This is a real-time web application built with:

- **Frontend**: React + TypeScript + Vite
- **Backend**: Express.js + TypeScript
- **Communication**: Server-Sent Events (SSE) for real-time updates
- **AI Integration**: OpenCode SDK for AI capabilities

The app connects to a local OpenCode instance to provide AI functionality with access to your local file system and terminal.

## 🎨 Design Philosophy

- **Developer-first**: Built by developers, for developers
- **Mobile-friendly**: Works great on all devices
- **Real-time**: See what's happening as it happens
- **Accessible**: High contrast ratios and clear typography
- **Minimal**: Clean interface that gets out of your way

## 📄 License

ISC License - see LICENSE file for details.

## 🤝 Contributing

This is a personal project, but issues and suggestions are welcome!
