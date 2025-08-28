import Opencode from '@opencode-ai/sdk';
import { Response } from 'express';

interface RecentModel {
  providerId: string;
  modelId: string;
  name: string;
  provider: string;
  lastUsed: number;
}

interface SessionState {
  id: string;
  clients: Response[];
  isStreaming: boolean;
  currentModel: {
    providerId: string;
    modelId: string;
  };
  recentModels: RecentModel[];
  abortController?: AbortController;
}

export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private defaultModel = {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
  };

  constructor(private opencode: Opencode) {}

  // Create or get session state
  getOrCreateSession(sessionId: string): SessionState {
    if (!this.sessions.has(sessionId)) {
      const state: SessionState = {
        id: sessionId,
        clients: [],
        isStreaming: false,
        currentModel: { ...this.defaultModel },
        recentModels: [],
      };
      this.sessions.set(sessionId, state);
    }
    return this.sessions.get(sessionId)!;
  }

  // Add SSE client to session
  addClient(sessionId: string, client: Response): void {
    const session = this.getOrCreateSession(sessionId);
    session.clients.push(client);

    // Start streaming events for this session if not already streaming
    if (!session.isStreaming) {
      this.startStreamingEvents(sessionId);
    }
  }

  // Remove SSE client from session
  removeClient(sessionId: string, client: Response): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.clients = session.clients.filter(c => c !== client);

    // Stop streaming if no clients left
    if (session.clients.length === 0) {
      this.stopStreamingEvents(sessionId);
    }
  }

  // Get current model for session
  getCurrentModel(sessionId: string): { providerId: string; modelId: string } {
    const session = this.sessions.get(sessionId);
    return session?.currentModel || { ...this.defaultModel };
  }

  // Update current model for session
  updateCurrentModel(
    sessionId: string,
    providerId: string,
    modelId: string,
    name?: string,
    provider?: string
  ): void {
    const session = this.getOrCreateSession(sessionId);
    session.currentModel = { providerId, modelId };

    // Update recent models if name and provider provided
    if (name && provider) {
      const existingIndex = session.recentModels.findIndex(
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
        session.recentModels[existingIndex] = modelEntry;
      } else {
        session.recentModels.unshift(modelEntry);
        // Keep only the 10 most recent models
        if (session.recentModels.length > 10) {
          session.recentModels.splice(10);
        }
      }
    }
  }

  // Get recent models for session
  getRecentModels(sessionId: string): RecentModel[] {
    const session = this.sessions.get(sessionId);
    return session?.recentModels.sort((a, b) => b.lastUsed - a.lastUsed) || [];
  }

  // Start streaming events for a session
  private async startStreamingEvents(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.isStreaming) return;

    session.isStreaming = true;
    session.abortController = new AbortController();

    try {
      console.log(`Starting event stream for session: ${sessionId}`);
      const eventStream = await this.opencode.event.list();

      for await (const event of eventStream) {
        // Check if streaming should stop
        if (session.abortController.signal.aborted) {
          break;
        }

        console.log(`Received event for session ${sessionId}:`, event.type);

        // Broadcast to all clients of this session
        session.clients.forEach(client => {
          try {
            client.write(`data: ${JSON.stringify(event)}\n\n`);
          } catch (error) {
            console.error('Error writing to client:', error);
          }
        });

        // Clean up dead clients
        session.clients = session.clients.filter(client => !client.destroyed);
      }
    } catch (error: any) {
      console.error(`Error streaming events for session ${sessionId}:`, error);
      // Retry after a delay
      setTimeout(() => {
        if (session.clients.length > 0) {
          this.startStreamingEvents(sessionId);
        }
      }, 5000);
    } finally {
      session.isStreaming = false;
    }
  }

  // Stop streaming events for a session
  private stopStreamingEvents(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isStreaming) return;

    console.log(`Stopping event stream for session: ${sessionId}`);

    if (session.abortController) {
      session.abortController.abort();
    }

    session.isStreaming = false;
  }

  // Cleanup session when no longer needed
  cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.stopStreamingEvents(sessionId);

    // Close all clients
    session.clients.forEach(client => {
      try {
        client.end();
      } catch (error) {
        // Client already closed
      }
    });

    this.sessions.delete(sessionId);
    console.log(`Cleaned up session: ${sessionId}`);
  }

  // Get all active sessions
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  // Check if session has active clients
  hasActiveClients(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session ? session.clients.length > 0 : false;
  }
}
