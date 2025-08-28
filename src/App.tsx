import React, { useState } from 'react';
import ConversationView from './components/ConversationView';
import DebugPane from './components/DebugPane';
import MessageInput from './components/MessageInput';
import SessionPicker from './components/SessionPicker';
import { useConversation } from './hooks/useConversation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const App: React.FC = () => {
  const {
    messages,
    toolCalls,
    events,
    isSessionReady,
    sendMessage,
    switchSession,
    backToSessions,
  } = useConversation();
  const [showDebug, setShowDebug] = useState(false);

  const handleSendMessage = async (text: string) => {
    await sendMessage(text);
  };

  const handleSessionSelect = async (sessionId: string | null) => {
    await switchSession(sessionId);
  };

  // Show session picker if no session is ready
  if (!isSessionReady) {
    return <SessionPicker onSessionSelect={handleSessionSelect} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-mono">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-primary text-xl">⚡</span>
            <h1 className="text-xl font-bold terminal-text">
              {'>'} Personal Assistant
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="outline" className="hidden sm:inline-flex">
              Messages: {messages.length}
            </Badge>
            <Badge variant="outline" className="hidden sm:inline-flex">
              Events: {events.length}
            </Badge>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDebug(!showDebug)}
              className="gap-2"
            >
              <span>🔧</span>
              <span className="hidden sm:inline">
                {showDebug ? 'Hide Debug' : 'Debug'}
              </span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={backToSessions}
              className="gap-2"
            >
              <span>📁</span>
              <span className="hidden sm:inline">Sessions</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden pb-32">
        <div
          className={`flex-1 transition-all duration-300 ${showDebug ? 'lg:max-w-[60%]' : ''}`}
        >
          <ConversationView messages={messages} toolCalls={toolCalls} />
        </div>

        {showDebug && (
          <div className="w-full lg:w-[40%] border-t lg:border-t-0 lg:border-l border-border bg-card/30">
            <DebugPane events={events} />
          </div>
        )}
      </div>

      {/* Fixed Message Input */}
      <MessageInput onSendMessage={handleSendMessage} disabled={false} />
    </div>
  );
};

export default App;
