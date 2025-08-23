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
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
          background: #0d1117;
          color: #e6edf3;
        }
        
        .app-header {
          padding: 15px 20px;
          background: #161b22;
          border-bottom: 1px solid #30363d;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }
        
        .app-header h1 {
          margin: 0;
          font-size: 24px;
          color: #f0f6fc;
          font-weight: 600;
          min-width: 0;
          flex: 1;
        }
        
        .header-controls {
          display: flex;
          align-items: center;
          gap: 15px;
          flex-wrap: wrap;
        }
        
        @media (max-width: 768px) {
          .app-header {
            padding: 12px 16px;
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }
          
          .app-header h1 {
            font-size: 20px;
            text-align: center;
          }
          
          .header-controls {
            justify-content: center;
            gap: 12px;
          }
        }
        
        .stats {
          font-size: 14px;
          color: #8b949e;
          background: #21262d;
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid #30363d;
        }
        
        .debug-toggle {
          padding: 6px 12px;
          background: #238636;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: background-color 0.2s;
        }
        
        .debug-toggle:hover {
          background: #2ea043;
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
        
        @media (max-width: 768px) {
          .app-body {
            flex-direction: column;
          }
          
          .main-pane {
            flex: 1;
            min-height: 0;
          }
          
          .main-pane.with-debug {
            flex: 1;
            max-height: 50vh;
          }
          
          .debug-pane-container {
            flex: 1;
            min-width: auto;
            max-height: 50vh;
            border-left: none;
            border-top: 1px solid #30363d;
          }
        }
      `}</style>
    </div>
  );
};

export default App;
