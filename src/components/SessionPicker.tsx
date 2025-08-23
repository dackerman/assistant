import React, { useState, useEffect } from 'react';

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
      <div className="session-picker">
        <div className="session-picker-header">
          <h2>Loading Sessions...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="session-picker">
      <div className="session-picker-header">
        <h2>Select a Session</h2>
        <button
          className="new-session-btn"
          onClick={() => handleSessionSelect(null)}
        >
          Start New Session
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="sessions-list">
        {sessions.length === 0 ? (
          <div className="empty-state">
            <p>No existing sessions found.</p>
            <button
              className="new-session-btn"
              onClick={() => handleSessionSelect(null)}
            >
              Start Your First Session
            </button>
          </div>
        ) : (
          sessions.map(session => (
            <div
              key={session.id}
              className="session-item"
              onClick={() => handleSessionSelect(session.id)}
            >
              <div className="session-title">{session.title}</div>
              <div className="session-date">{formatDate(session.created)}</div>
            </div>
          ))
        )}
      </div>

      <style>{`
        * {
          box-sizing: border-box;
        }
        
        html, body {
          margin: 0;
          padding: 0;
          height: 100%;
          overflow: hidden;
        }
        
        #root {
          height: 100%;
        }
        
        .session-picker {
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: #0d1117;
          color: #e6edf3;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
          margin: 0;
          padding: 0;
        }
        
        .session-picker-header {
          padding: 20px;
          background: #161b22;
          border-bottom: 1px solid #30363d;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 15px;
        }
        
        .session-picker-header h2 {
          margin: 0;
          font-size: 24px;
          color: #f0f6fc;
          font-weight: 600;
        }
        
        .new-session-btn {
          padding: 10px 20px;
          background: #238636;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: background-color 0.2s;
        }
        
        .new-session-btn:hover {
          background: #2ea043;
        }
        
        .error-message {
          margin: 20px;
          padding: 12px;
          background: #da3633;
          color: #ffffff;
          border-radius: 6px;
          font-size: 14px;
        }
        
        .sessions-list {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }
        
        .empty-state {
          text-align: center;
          padding: 60px 20px;
        }
        
        .empty-state p {
          margin-bottom: 20px;
          color: #8b949e;
          font-size: 16px;
        }
        
        .session-item {
          padding: 16px;
          margin-bottom: 12px;
          background: #21262d;
          border: 1px solid #30363d;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .session-item:hover {
          background: #30363d;
          border-color: #484f58;
        }
        
        .session-title {
          font-size: 16px;
          font-weight: 500;
          color: #f0f6fc;
          margin-bottom: 6px;
        }
        
        .session-date {
          font-size: 12px;
          color: #8b949e;
        }
        
        @media (max-width: 768px) {
          .session-picker-header {
            flex-direction: column;
            align-items: stretch;
            gap: 12px;
          }
          
          .session-picker-header h2 {
            font-size: 20px;
            text-align: center;
          }
          
          .sessions-list {
            padding: 16px;
          }
          
          .session-item {
            padding: 12px;
          }
        }
      `}</style>
    </div>
  );
};

export default SessionPicker;
