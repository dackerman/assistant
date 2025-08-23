import React from 'react';
import EventRenderer from './EventRenderer';

interface DebugPaneProps {
  events: any[];
}

const DebugPane: React.FC<DebugPaneProps> = ({ events }) => {
  return (
    <div className="debug-pane">
      <div className="debug-header">
        <h2>Debug Events</h2>
        <div className="event-count">{events.length} events</div>
      </div>
      <div className="debug-content">
        {events
          .slice()
          .reverse()
          .map((event, index) => (
            <EventRenderer key={events.length - 1 - index} event={event} />
          ))}
      </div>

      <style>{`
        .debug-pane {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: #f8f9fa;
          border-left: 1px solid #dee2e6;
        }
        
        .debug-header {
          padding: 15px 20px;
          background: #e9ecef;
          border-bottom: 1px solid #dee2e6;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .debug-header h2 {
          margin: 0;
          font-size: 18px;
          color: #495057;
        }
        
        .event-count {
          font-size: 12px;
          color: #6c757d;
          background: #fff;
          padding: 4px 8px;
          border-radius: 12px;
        }
        
        .debug-content {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
        }
      `}</style>
    </div>
  );
};

export default DebugPane;
