# Web Frontend

React + TypeScript application built with Vite, featuring a modern chat interface for AI conversations.

## Tech Stack

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS + shadcn/ui components
- **Routing**: React Router DOM
- **Markdown**: react-markdown with syntax highlighting
- **Icons**: Lucide React
- **Testing**: Vitest + React Testing Library

## Development

Start the development server:

```bash
pnpm run dev
```

The app will be available at http://localhost:4000

## Available Scripts

- `pnpm run dev` - Start development server
- `pnpm run build` - Build for production
- `pnpm run test` - Run tests with Vitest
- `pnpm run lint` - Check code with Biome
- `pnpm run lint:fix` - Fix linting issues
- `pnpm run preview` - Preview production build

## Project Structure

```
src/
├── components/       # React components
│   ├── chat/        # Chat-related components
│   └── ui/          # Reusable UI components (shadcn/ui)
├── constants/       # Application constants
├── data/           # Mock data and fixtures
├── hooks/          # Custom React hooks
├── lib/            # Utility functions
├── services/       # API services
├── types/          # TypeScript type definitions
└── test/           # Test utilities and setup
```

## Key Features

- Real-time conversation streaming
- Tool call visualization (Bash, Gmail, Asana, etc.)
- Markdown rendering with syntax highlighting
- Responsive design with Tailwind CSS
- Type-safe development with TypeScript

## Environment Variables

Create a `.env.local` file based on `.env.local.example`:

```bash
cp .env.local.example .env.local
```

## Testing

Run unit tests:

```bash
pnpm run test
```

Run tests for a specific file:

```bash
pnpm run test src/hooks/useConversationStream.test.tsx
```

## Building for Production

```bash
pnpm run build
```

The production build will be in the `dist/` directory.

## Code Style

This project uses Biome for code formatting and linting. The configuration enforces:
- 2 spaces for indentation
- 80 character line width
- Single quotes for strings
- No semicolons (except where necessary)
- Organized imports