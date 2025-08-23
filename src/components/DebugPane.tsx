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
          background: #0d1117;
          border-left: 1px solid #30363d;
        }
        
        .debug-header {
          padding: 15px 20px;
          background: #161b22;
          border-bottom: 1px solid #30363d;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .debug-header h2 {
          margin: 0;
          font-size: 18px;
          color: #f0f6fc;
          font-weight: 600;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        }
        
        .event-count {
          font-size: 12px;
          color: #e6edf3;
          background: #21262d;
          border: 1px solid #30363d;
          padding: 4px 8px;
          border-radius: 6px;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
          font-weight: 500;
        }
        
        .debug-content {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
          background: #0d1117;
        }
      `}</style>
    </div>
  );
};

export default DebugPane;
