import React from 'react';
import EventRenderer from './EventRenderer';

interface ConversationViewerProps {
  events: any[];
}

const ConversationViewer: React.FC<ConversationViewerProps> = ({ events }) => {
  return (
    <div style={{
      flex: 1,
      padding: '1rem',
      overflow: 'auto',
      backgroundColor: '#1e1e1e'
    }}>
      {events.length === 0 ? (
        <div style={{ color: '#888', textAlign: 'center', marginTop: '2rem' }}>
          No events yet. Send a message to get started!
        </div>
      ) : (
        events.map((event, index) => (
          <EventRenderer key={index} event={event} />
        ))
      )}
    </div>
  );
};

export default ConversationViewer;