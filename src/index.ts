import Opencode from '@opencode-ai/sdk';
import cors from 'cors';
import express, { Request, Response } from 'express';

const app = express();
const port = 7654;

app.use(cors());
app.use(express.json());
app.use(express.static('dist/public'));

const opencode = new Opencode({
  baseURL: 'http://127.0.0.1:4096',
});

let currentSessionId: string | null = null;
let clients: Response[] = [];

// SSE endpoint for streaming events
app.get('/events', async (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  clients.push(res);
  console.log('Client connected to events, total clients:', clients.length);

  // Auto-create session if not exists and start streaming
  if (!currentSessionId && !isStreamingEvents) {
    try {
      const newSession = await opencode.session.create();
      currentSessionId = newSession.id;
      console.log('Auto-created session for events:', currentSessionId);
      streamEvents();
    } catch (error: any) {
      console.error('Failed to auto-create session:', error);
    }
  }

  req.on('close', () => {
    clients = clients.filter(client => client !== res);
    console.log('Client disconnected, remaining clients:', clients.length);
  });
});

let isStreamingEvents = false;

async function streamEvents() {
  if (isStreamingEvents) return;
  isStreamingEvents = true;

  try {
    console.log('Starting event stream...');
    const eventStream = await opencode.event.list();

    for await (const event of eventStream) {
      console.log('Received event:', event.type);
      // Broadcast to all connected clients
      clients.forEach(client => {
        try {
          client.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch (error) {
          console.error('Error writing to client:', error);
        }
      });
    }
  } catch (error: any) {
    console.error('Error streaming events:', error);
    isStreamingEvents = false;
    // Retry after a delay
    setTimeout(() => streamEvents(), 5000);
  }
}

// Start a new session
app.post('/api/session', async (_req: Request, res: Response) => {
  try {
    if (!currentSessionId) {
      const newSession = await opencode.session.create();
      currentSessionId = newSession.id;
      console.log('Created session:', currentSessionId);
      // Start streaming events (don't await)
      streamEvents();
    }
    res.json({ sessionId: currentSessionId });
  } catch (error: any) {
    console.error('Failed to create session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Send a message
app.post('/api/message', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    console.log('Sending message:', text);

    if (!currentSessionId) {
      console.log('No session, creating one...');
      const newSession = await opencode.session.create();
      currentSessionId = newSession.id;
      console.log('Created new session for message:', currentSessionId);
      streamEvents();
    }

    console.log('Using session:', currentSessionId);

    const result = await opencode.session.chat(currentSessionId, {
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-20250514',
      parts: [{ type: 'text', text }],
    });

    console.log('Message sent successfully, result:', result);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to send message:', error);
    console.error('Error details:', {
      message: error?.message || 'Unknown error',
      stack: error?.stack || 'No stack trace',
      response: error?.response?.data || 'No response data',
    });
    res.status(500).json({
      error: 'Failed to send message',
      details: error?.message || 'Unknown error',
    });
  }
});

// List all sessions
app.get('/api/sessions', async (_req: Request, res: Response) => {
  try {
    // Use OpenCode SDK to list sessions
    const sessionList = await opencode.session.list();
    const sessions = sessionList.map(session => ({
      id: session.id,
      title: session.title || `Session ${session.id.slice(-6)}`,
      created: (session as any).time?.created || Date.now(),
    }));
    res.json({ sessions });
  } catch (error: any) {
    console.error('Failed to list sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Get session details including messages
app.get('/api/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    // Get session info and messages using OpenCode SDK
    const sessionList = await opencode.session.list();
    const session = sessionList.find(s => s.id === sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get messages for this session
    const messages = await opencode.session.messages(sessionId);

    res.json({ session, messages });
  } catch (error: any) {
    console.error('Failed to get session:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Switch to a different session
app.post('/api/sessions/switch', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;

    if (sessionId) {
      // Verify session exists by checking SDK
      const sessionList = await opencode.session.list();
      const sessionExists = sessionList.some(s => s.id === sessionId);

      if (sessionExists) {
        currentSessionId = sessionId;
      } else {
        return res.status(404).json({ error: 'Session not found' });
      }
    } else {
      // Create new session
      const newSession = await opencode.session.create();
      currentSessionId = newSession.id;
    }

    // Start streaming events for this session
    if (!isStreamingEvents) {
      streamEvents();
    }

    res.json({ sessionId: currentSessionId });
  } catch (error: any) {
    console.error('Failed to switch session:', error);
    res.status(500).json({ error: 'Failed to switch session' });
  }
});

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
  try {
    // Test connection to OpenCode without creating a session
    await opencode.session.list();
    res.json({
      status: 'ok',
      opencode: 'connected',
      currentSessionId,
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      opencode: 'disconnected',
      error: error?.message || 'Unknown error',
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
