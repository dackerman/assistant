import React from 'react';

interface EventRendererProps {
  event: any;
}

const EventRenderer: React.FC<EventRendererProps> = ({ event }) => {
  const getEventColor = (type: string) => {
    switch (type) {
      case 'message.part.updated':
        return '#4CAF50';
      case 'tool':
        return '#2196F3';
      case 'step-start':
        return '#FF9800';
      case 'step-finish':
        return '#9C27B0';
      default:
        return '#888';
    }
  };

  const renderEventContent = () => {
    switch (event.type) {
      case 'message.part.updated':
        const part = event.properties?.part;
        if (part?.type === 'text') {
          return (
            <div style={{ marginLeft: '1rem' }}>
              <strong>Text:</strong> {part.text}
            </div>
          );
        } else if (part?.type === 'tool') {
          return (
            <div style={{ marginLeft: '1rem' }}>
              <strong>Tool:</strong> {part.tool} |<strong> Status:</strong>{' '}
              {part.state?.status} |<strong> Call ID:</strong> {part.callID}
              {part.state?.input && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.9em',
                    opacity: 0.8,
                  }}
                >
                  <strong>Input:</strong>{' '}
                  {JSON.stringify(part.state.input, null, 2)}
                </div>
              )}
              {part.state?.output && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.9em',
                    opacity: 0.8,
                    maxHeight: '200px',
                    overflow: 'auto',
                    backgroundColor: '#2d2d30',
                    padding: '0.5rem',
                    borderRadius: '4px',
                  }}
                >
                  <strong>Output:</strong>
                  <br />
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                    {typeof part.state.output === 'string'
                      ? part.state.output.substring(0, 500) +
                        (part.state.output.length > 500 ? '...' : '')
                      : JSON.stringify(part.state.output, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        }
        break;

      case 'step-start':
        return (
          <div style={{ marginLeft: '1rem', color: '#FF9800' }}>
            Starting step...
          </div>
        );

      case 'step-finish':
        const tokens = event.properties?.tokens;
        return (
          <div style={{ marginLeft: '1rem', color: '#9C27B0' }}>
            Step finished - Input: {tokens?.input}, Output: {tokens?.output}
          </div>
        );

      default:
        return (
          <div style={{ marginLeft: '1rem', fontSize: '0.9em', opacity: 0.7 }}>
            {JSON.stringify(event.properties, null, 2)}
          </div>
        );
    }
  };

  return (
    <div
      style={{
        marginBottom: '0.5rem',
        padding: '0.5rem',
        backgroundColor: '#2d2d30',
        borderLeft: `3px solid ${getEventColor(event.type)}`,
        borderRadius: '4px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '0.25rem',
        }}
      >
        <span
          style={{
            color: getEventColor(event.type),
            fontWeight: 'bold',
            fontSize: '0.9em',
          }}
        >
          {event.type}
        </span>
        <span style={{ fontSize: '0.8em', opacity: 0.6 }}>
          {new Date().toLocaleTimeString()}
        </span>
      </div>
      {renderEventContent()}
    </div>
  );
};

export default EventRenderer;
