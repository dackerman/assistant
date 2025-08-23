import express, { Request, Response } from 'express';
import cors from 'cors';
import Opencode from '@opencode-ai/sdk';

const app = express();
const port = 7654;

app.use(cors());
app.use(express.json());
app.use(express.static('dist/public'));

const opencode = new Opencode({
  baseURL: 'http://localhost:4096',
});

let currentSession: any = null;
let clients: Response[] = [];

// SSE endpoint for streaming events
app.get('/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  clients.push(res);

  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
});

async function streamEvents(sessionId: string) {
  try {
    const events = await opencode.event.list();

    for await (const event of events) {
      // Broadcast to all connected clients
      clients.forEach(client => {
        client.write(`data: ${JSON.stringify(event)}\n\n`);
      });
    }
  } catch (error) {
    console.error('Error streaming events:', error);
  }
}

// Start a new session
app.post('/api/session', async (req: Request, res: Response) => {
  try {
    if (!currentSession) {
      currentSession = await opencode.session.create();
      // Start streaming events (don't await)
      streamEvents(currentSession.id);
    }
    res.json({ sessionId: currentSession.id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Send a message
app.post('/api/message', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!currentSession) {
      return res.status(400).json({ error: 'No active session' });
    }

    await opencode.session.chat(currentSession.id, {
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-20250514',
      parts: [{ type: 'text', text }],
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
