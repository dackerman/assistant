import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

interface Session {
  id: string;
  title: string;
  created: number;
}

interface SessionPickerProps {
  onSessionSelect: (sessionId: string | null) => void;
}

const SessionPicker: React.FC<SessionPickerProps> = ({ onSessionSelect }) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/sessions');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setError('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  const handleSessionSelect = async (sessionId: string | null) => {
    try {
      const response = await fetch('/api/sessions/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      onSessionSelect(sessionId);
    } catch (error) {
      console.error('Failed to switch session:', error);
      setError('Failed to switch session');
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Card className="w-96">
          <CardHeader>
            <CardTitle className="text-center font-mono">
              <span className="text-primary">⚡</span> Loading Sessions...
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-4">
      <div className="max-w-4xl mx-auto">
        <Card className="shadow-lg">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-2xl font-mono flex items-center gap-2">
                <span className="text-primary">{'>'}</span>
                Select a Session
              </CardTitle>
              <Button
                onClick={() => handleSessionSelect(null)}
                className="shadow-md"
              >
                <span className="mr-2">+</span>
                New Session
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {error && (
              <div className="m-4 p-3 bg-destructive/10 border border-destructive/50 rounded text-destructive text-sm font-mono">
                ⚠️ {error}
              </div>
            )}

            <ScrollArea className="h-[60vh]">
              <div className="p-4">
                {sessions.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-4xl mb-4">📁</div>
                    <p className="text-muted-foreground mb-6 font-mono">
                      No existing sessions found
                    </p>
                    <Button
                      onClick={() => handleSessionSelect(null)}
                      size="lg"
                      className="shadow-lg"
                    >
                      Start Your First Session
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sessions.map(session => (
                      <Card
                        key={session.id}
                        className="cursor-pointer transition-all hover:bg-accent/10 hover:border-primary/50"
                        onClick={() => handleSessionSelect(session.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-mono font-semibold text-foreground">
                                {session.title}
                              </div>
                              <div className="text-xs text-muted-foreground font-mono mt-1">
                                {formatDate(session.created)}
                              </div>
                            </div>
                            <Badge variant="outline" className="font-mono">
                              #{session.id.slice(0, 8)}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SessionPicker;
