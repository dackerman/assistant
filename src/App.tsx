import React, { useState } from 'react';
import ConversationView from './components/ConversationView';
import DebugPane from './components/DebugPane';
import MessageInput from './components/MessageInput';
import { useConversation } from './hooks/useConversation';

const App: React.FC = () => {
  const { messages, toolCalls, events, sendMessage } = useConversation();
  const [showDebug, setShowDebug] = useState(false);

  const handleSendMessage = async (text: string) => {
    await sendMessage(text);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Personal Assistant</h1>
        <div className="header-controls">
          <div className="stats">
            Messages: {messages.length} | Events: {events.length}
          </div>
          <button
            className="debug-toggle"
            onClick={() => setShowDebug(!showDebug)}
          >
            {showDebug ? 'Hide Debug' : 'Show Debug'}
          </button>
        </div>
      </header>

      <div className="app-body">
        <div className={`main-pane ${showDebug ? 'with-debug' : ''}`}>
          <ConversationView messages={messages} toolCalls={toolCalls} />
        </div>
        {showDebug && (
          <div className="debug-pane-container">
            <DebugPane events={events} />
          </div>
        )}
      </div>

      <MessageInput onSendMessage={handleSendMessage} disabled={false} />

      <style>{`
        .app {
          height: 100vh;
          display: flex;
          flex-direction: column;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
          background: #ffffff;
          color: #333;
        }
        
        .app-header {
          padding: 15px 20px;
          background: #f8f9fa;
          border-bottom: 1px solid #dee2e6;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .app-header h1 {
          margin: 0;
          font-size: 24px;
          color: #212529;
        }
        
        .header-controls {
          display: flex;
          align-items: center;
          gap: 15px;
        }
        
        .stats {
          font-size: 14px;
          color: #6c757d;
        }
        
        .debug-toggle {
          padding: 6px 12px;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }
        
        .debug-toggle:hover {
          background: #0056b3;
        }
        
        .app-body {
          flex: 1;
          display: flex;
          overflow: hidden;
        }
        
        .main-pane {
          flex: 1;
          transition: all 0.3s ease;
        }
        
        .main-pane.with-debug {
          flex: 0 0 60%;
        }
        
        .debug-pane-container {
          flex: 0 0 40%;
          min-width: 300px;
        }
      `}</style>
    </div>
  );
};

export default App;
