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

let currentSession: any = null;
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
  if (!currentSession && !isStreamingEvents) {
    try {
      currentSession = await opencode.session.create();
      console.log('Auto-created session for events:', currentSession.id);
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
app.post('/api/session', async (req: Request, res: Response) => {
  try {
    if (!currentSession) {
      currentSession = await opencode.session.create();
      console.log('Created session:', currentSession.id);
      // Start streaming events (don't await)
      streamEvents();
    }
    res.json({ sessionId: currentSession.id });
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

    if (!currentSession) {
      console.log('No session, creating one...');
      currentSession = await opencode.session.create();
      console.log('Created new session for message:', currentSession.id);
      streamEvents();
    }

    console.log('Using session:', currentSession.id);

    const result = await opencode.session.chat(currentSession.id, {
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

// Health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  try {
    // Test connection to OpenCode
    const testSession = await opencode.session.create();
    res.json({
      status: 'ok',
      opencode: 'connected',
      testSessionId: testSession.id,
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
