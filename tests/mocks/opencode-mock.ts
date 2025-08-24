import express from 'express';

const mockApp = express();
mockApp.use(express.json());

let mockSessionId = 'test-session-123';
let eventClients: any[] = [];

// Mock session endpoints
mockApp.post('/session', (_req, res) => {
  res.json({ id: mockSessionId, created: Date.now() });
});

mockApp.get('/session', (_req, res) => {
  res.json([
    { id: mockSessionId, title: 'Test Session', time: { created: Date.now() } },
  ]);
});

mockApp.get('/session/:id/messages', (_req, res) => {
  res.json([
    {
      info: { id: 'msg-1', role: 'user', time: { created: Date.now() } },
      parts: [{ type: 'text', text: 'Hello' }],
    },
    {
      info: { id: 'msg-2', role: 'assistant', time: { created: Date.now() } },
      parts: [{ type: 'text', text: 'Hello! How can I help you today?' }],
    },
  ]);
});

mockApp.post('/session/:id/chat', (req, res) => {
  const { parts } = req.body;
  const userText = parts[0]?.text || '';

  // Send events to simulate streaming
  setTimeout(() => {
    eventClients.forEach(client => {
      // Send user message event
      client.write(
        `data: ${JSON.stringify({
          type: 'message.updated',
          properties: {
            info: { id: `msg-${Date.now()}`, role: 'user' },
          },
        })}\n\n`
      );

      client.write(
        `data: ${JSON.stringify({
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'text',
              text: userText,
              messageID: `msg-${Date.now()}`,
            },
          },
        })}\n\n`
      );
    });
  }, 100);

  // Send assistant response
  setTimeout(() => {
    eventClients.forEach(client => {
      client.write(
        `data: ${JSON.stringify({
          type: 'message.updated',
          properties: {
            info: { id: `msg-${Date.now()}-assistant`, role: 'assistant' },
          },
        })}\n\n`
      );

      client.write(
        `data: ${JSON.stringify({
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'text',
              text: 'This is a mock response from the assistant.',
              messageID: `msg-${Date.now()}-assistant`,
            },
          },
        })}\n\n`
      );

      client.write(
        `data: ${JSON.stringify({
          type: 'message.completed',
          properties: {},
        })}\n\n`
      );
    });
  }, 500);

  res.json({ success: true });
});

// Mock event stream
mockApp.get('/event', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  eventClients.push(res);

  req.on('close', () => {
    eventClients = eventClients.filter(c => c !== res);
  });
});

export function startMockServer() {
  const server = mockApp.listen(4096, () => {
    console.log('Mock OpenCode server running on port 4096');
  });
  return server;
}
