import Opencode from '@opencode-ai/sdk';
import cors from 'cors';
import express, { Request, Response } from 'express';

const app = express();
const port = 7654;

app.use(cors());
app.use(express.json());
app.use(express.static('dist/public'));

const opencode = new Opencode({
  baseURL: process.env.OPENCODE_URL || 'http://127.0.0.1:4096',
});

let currentSessionId: string | null = null;
let clients: Response[] = [];

// In-memory storage for recent models (per session)
interface RecentModel {
  providerId: string;
  modelId: string;
  name: string;
  provider: string;
  lastUsed: number;
}

const recentModels: Map<string, RecentModel[]> = new Map();
let currentModel = {
  providerId: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
};

// Cache for models data
let modelsCache: any = null;
let modelsCacheTimestamp: number = 0;
const MODELS_CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

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
    const { text, providerId, modelId } = req.body;
    console.log('Sending message:', text);

    // Update current model if provided
    if (providerId && modelId) {
      currentModel = { providerId, modelId };

      // Track recent model usage
      if (currentSessionId) {
        const sessionRecents = recentModels.get(currentSessionId) || [];
        const existingIndex = sessionRecents.findIndex(
          m => m.providerId === providerId && m.modelId === modelId
        );

        const modelEntry: RecentModel = {
          providerId,
          modelId,
          name: modelId, // Will be updated from frontend if needed
          provider: providerId,
          lastUsed: Date.now(),
        };

        if (existingIndex >= 0) {
          sessionRecents[existingIndex] = modelEntry;
        } else {
          sessionRecents.unshift(modelEntry);
          // Keep only the 10 most recent models
          if (sessionRecents.length > 10) {
            sessionRecents.splice(10);
          }
        }

        recentModels.set(currentSessionId, sessionRecents);
      }
    }

    if (!currentSessionId) {
      console.log('No session, creating one...');
      const newSession = await opencode.session.create();
      currentSessionId = newSession.id;
      console.log('Created new session for message:', currentSessionId);
      streamEvents();
    }

    console.log(
      'Using session:',
      currentSessionId,
      'with model:',
      currentModel
    );

    const result = await opencode.session.chat(currentSessionId, {
      providerID: currentModel.providerId,
      modelID: currentModel.modelId,
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

// Get current model and recent models
app.get('/api/models/current', async (_req: Request, res: Response) => {
  try {
    const sessionRecents = currentSessionId
      ? recentModels.get(currentSessionId) || []
      : [];
    res.json({
      currentModel,
      recentModels: sessionRecents.sort((a, b) => b.lastUsed - a.lastUsed),
    });
  } catch (error: any) {
    console.error('Failed to get current model:', error);
    res.status(500).json({ error: 'Failed to get current model' });
  }
});

// Update current model
app.post('/api/models/current', async (req: Request, res: Response) => {
  try {
    const { providerId, modelId, name, provider } = req.body;

    if (!providerId || !modelId) {
      return res
        .status(400)
        .json({ error: 'Provider ID and Model ID are required' });
    }

    currentModel = { providerId, modelId };

    // Update recent models with proper name and provider if provided
    if (currentSessionId && name && provider) {
      const sessionRecents = recentModels.get(currentSessionId) || [];
      const existingIndex = sessionRecents.findIndex(
        m => m.providerId === providerId && m.modelId === modelId
      );

      const modelEntry: RecentModel = {
        providerId,
        modelId,
        name,
        provider,
        lastUsed: Date.now(),
      };

      if (existingIndex >= 0) {
        sessionRecents[existingIndex] = modelEntry;
      } else {
        sessionRecents.unshift(modelEntry);
        if (sessionRecents.length > 10) {
          sessionRecents.splice(10);
        }
      }

      recentModels.set(currentSessionId, sessionRecents);
    }

    res.json({ success: true, currentModel });
  } catch (error: any) {
    console.error('Failed to update current model:', error);
    res.status(500).json({ error: 'Failed to update current model' });
  }
});

// Proxy endpoint for models.dev API with caching
app.get('/api/models', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();

    // Check if we have cached data that's still fresh
    if (modelsCache && now - modelsCacheTimestamp < MODELS_CACHE_DURATION) {
      console.log('Serving models from cache');
      return res.json(modelsCache);
    }

    console.log('Fetching fresh models data from models.dev');
    const response = await fetch('https://models.dev/api.json');

    if (!response.ok) {
      throw new Error(
        `Failed to fetch models: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // Cache the data
    modelsCache = data;
    modelsCacheTimestamp = now;

    console.log('Models data cached successfully');
    res.json(data);
  } catch (error: any) {
    console.error('Failed to fetch models data:', error);

    // If we have stale cached data, serve it as fallback
    if (modelsCache) {
      console.log('Serving stale cached data as fallback');
      return res.json(modelsCache);
    }

    res.status(500).json({
      error: 'Failed to fetch models data',
      details: error?.message || 'Unknown error',
    });
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
  console.log(
    `Connected to OpenCode at: ${process.env.OPENCODE_URL || 'http://127.0.0.1:4096'}`
  );
});
