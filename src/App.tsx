import React, { useState, useEffect } from 'react';
import ConversationViewer from './components/ConversationViewer';
import MessageInput from './components/MessageInput';

const App: React.FC = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Initialize session
    fetch('/api/session', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        setSessionId(data.sessionId);
        console.log('Session created:', data.sessionId);
      })
      .catch(err => console.error('Failed to create session:', err));

    // Setup SSE connection
    const eventSource = new EventSource('/events');
    
    eventSource.onopen = () => {
      setIsConnected(true);
      console.log('Connected to event stream');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setEvents(prev => [...prev, data]);
      } catch (err) {
        console.error('Failed to parse event:', err);
      }
    };

    eventSource.onerror = (error) => {
      console.error('EventSource failed:', error);
      setIsConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const sendMessage = async (text: string) => {
    try {
      await fetch('/api/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <div style={{ 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      fontFamily: 'monospace',
      backgroundColor: '#1e1e1e',
      color: '#ffffff'
    }}>
      <header style={{ 
        padding: '1rem', 
        backgroundColor: '#2d2d30', 
        borderBottom: '1px solid #3e3e42'
      }}>
        <h1>Conversation Stream Viewer</h1>
        <div>
          Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'} | 
          Session: {sessionId ? sessionId.slice(-8) : 'None'} | 
          Events: {events.length}
        </div>
      </header>
      
      <div style={{ flex: 1, display: 'flex' }}>
        <ConversationViewer events={events} />
      </div>
      
      <MessageInput onSendMessage={sendMessage} disabled={!sessionId} />
    </div>
  );
};

export default App;