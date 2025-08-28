import Opencode from '@opencode-ai/sdk';
import cors from 'cors';
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { SessionManager } from './SessionManager';

// Dev mode detection
const isDev =
  process.env.NODE_ENV === 'development' ||
  process.env.NODE_ENV !== 'production';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (isDev && !fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Get log file path with timestamp
const getLogFilePath = () => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
  return path.join(logsDir, `opencode-${dateStr}-${timeStr}.log`);
};

// Current log file path (created once per session)
let currentLogFile: string | null = null;

// Write to both console and file
const writeLog = (message: string) => {
  if (!isDev) return;

  // Console output
  console.log(message);

  // File output
  if (!currentLogFile) {
    currentLogFile = getLogFilePath();
  }

  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(currentLogFile, logEntry);
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

// Enhanced logging for dev mode
const devLog = {
  request: (method: string, endpoint: string, data?: any) => {
    if (!isDev) return;
    writeLog('\n🔵 [OpenCode Request]');
    writeLog(`${method} ${endpoint}`);
    if (data) {
      writeLog('Request Data: ' + JSON.stringify(data, null, 2));
    }
  },
  response: (method: string, endpoint: string, response: any, error?: any) => {
    if (!isDev) return;
    writeLog('\n🟢 [OpenCode Response]');
    writeLog(`${method} ${endpoint}`);
    if (error) {
      writeLog('❌ Error: ' + JSON.stringify(error, null, 2));
    } else {
      writeLog('✅ Response: ' + JSON.stringify(response, null, 2));
    }
  },
  event: (event: any) => {
    if (!isDev) return;
    writeLog('\n🟡 [Stream Event]');
    writeLog('Event Type: ' + event.type);
    writeLog('Event Data: ' + JSON.stringify(event, null, 2));
  },
};

const app = express();
const port = 7654;

app.use(cors());
app.use(express.json());
app.use(express.static('dist/public'));

const opencode = new Opencode({
  baseURL: process.env.OPENCODE_URL || 'http://127.0.0.1:4096',
});

// Initialize SessionManager
const sessionManager = new SessionManager(opencode);

// For backward compatibility with frontend that expects a single "current" session
let currentSessionId: string | null = null;

// Cache for models data
let modelsCache: any = null;
let modelsCacheTimestamp: number = 0;
const MODELS_CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

// SSE endpoint for streaming events
app.get('/events', async (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || currentSessionId;

  if (!sessionId) {
    res.status(400).json({ error: 'Session ID required' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Add client to session
  sessionManager.addClient(sessionId, res);
  console.log(`Client connected to session ${sessionId}`);

  req.on('close', () => {
    sessionManager.removeClient(sessionId, res);
    console.log(`Client disconnected from session ${sessionId}`);
  });
});

// Start a new session
app.post('/api/session', async (_req: Request, res: Response) => {
  try {
    if (!currentSessionId) {
      devLog.request('POST', 'session.create()');
      const newSession = await opencode.session.create();
      devLog.response('POST', 'session.create()', newSession);

      currentSessionId = newSession.id;
      console.log('Created session:', currentSessionId);
      // Initialize session in SessionManager
      sessionManager.getOrCreateSession(currentSessionId);
    }
    res.json({ sessionId: currentSessionId });
  } catch (error: any) {
    devLog.response('POST', 'session.create()', null, error);
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
    if (currentSessionId && providerId && modelId) {
      sessionManager.updateCurrentModel(
        currentSessionId,
        providerId,
        modelId,
        modelId, // Will be updated from frontend if needed
        providerId
      );
    }

    if (!currentSessionId) {
      console.log('No session, creating one...');
      const newSession = await opencode.session.create();
      currentSessionId = newSession.id;
      console.log('Created new session for message:', currentSessionId);
      sessionManager.getOrCreateSession(currentSessionId);
    }

    const currentModel = sessionManager.getCurrentModel(currentSessionId);
    console.log(
      'Using session:',
      currentSessionId,
      'with model:',
      currentModel
    );

    const chatParams = {
      providerID: currentModel.providerId,
      modelID: currentModel.modelId,
      parts: [{ type: 'text' as const, text }],
    };

    devLog.request('POST', `session.chat(${currentSessionId})`, chatParams);
    const result = await opencode.session.chat(currentSessionId, chatParams);
    devLog.response('POST', `session.chat(${currentSessionId})`, result);

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
    devLog.request('GET', 'session.list()');
    const sessionList = await opencode.session.list();
    devLog.response('GET', 'session.list()', sessionList);

    const sessions = sessionList.map(session => ({
      id: session.id,
      title: session.title || `Session ${session.id.slice(-6)}`,
      created: (session as any).time?.created || Date.now(),
    }));
    res.json({ sessions });
  } catch (error: any) {
    devLog.response('GET', 'session.list()', null, error);
    console.error('Failed to list sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Get session details including messages
app.get('/api/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    // Get session info and messages using OpenCode SDK
    devLog.request('GET', 'session.list()');
    const sessionList = await opencode.session.list();
    devLog.response('GET', 'session.list()', sessionList);

    const session = sessionList.find(s => s.id === sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get messages for this session
    devLog.request('GET', `session.messages(${sessionId})`);
    const messages = await opencode.session.messages(sessionId);
    devLog.response('GET', `session.messages(${sessionId})`, messages);

    res.json({ session, messages });
  } catch (error: any) {
    devLog.response(
      'GET',
      `session operations for ${req.params.sessionId}`,
      null,
      error
    );
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
      devLog.request('GET', 'session.list()');
      const sessionList = await opencode.session.list();
      devLog.response('GET', 'session.list()', sessionList);

      const sessionExists = sessionList.some(s => s.id === sessionId);

      if (sessionExists) {
        currentSessionId = sessionId;
      } else {
        return res.status(404).json({ error: 'Session not found' });
      }
    } else {
      // Create new session
      devLog.request('POST', 'session.create()');
      const newSession = await opencode.session.create();
      devLog.response('POST', 'session.create()', newSession);
      currentSessionId = newSession.id;
    }

    // Initialize session in SessionManager
    if (currentSessionId) {
      sessionManager.getOrCreateSession(currentSessionId);
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
    if (!currentSessionId) {
      return res.status(400).json({ error: 'No active session' });
    }

    const currentModel = sessionManager.getCurrentModel(currentSessionId);
    const recentModels = sessionManager.getRecentModels(currentSessionId);

    res.json({
      currentModel,
      recentModels,
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

    if (!currentSessionId) {
      return res.status(400).json({ error: 'No active session' });
    }

    sessionManager.updateCurrentModel(
      currentSessionId,
      providerId,
      modelId,
      name,
      provider
    );

    const currentModel = sessionManager.getCurrentModel(currentSessionId);
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
    devLog.request('GET', 'session.list() [health check]');
    const sessionList = await opencode.session.list();
    devLog.response('GET', 'session.list() [health check]', sessionList);

    res.json({
      status: 'ok',
      opencode: 'connected',
      currentSessionId,
    });
  } catch (error: any) {
    devLog.response('GET', 'session.list() [health check]', null, error);
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

  if (isDev) {
    console.log(
      '\n🔍 [Dev Mode] Enhanced logging enabled for OpenCode operations'
    );
    console.log('   - All API requests and responses will be logged');
    console.log('   - All streaming events will be logged');
    console.log('   - Logs saved to: ./logs/ directory');
    console.log('   - Set NODE_ENV=production to disable verbose logging\n');
  }
});
