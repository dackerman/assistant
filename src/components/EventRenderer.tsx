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
              <strong>Tool:</strong> {part.tool} | <strong>Status:</strong>{' '}
              {part.state?.status} | <strong>Call ID:</strong> {part.callID}
              {part.state?.input && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.9em',
                    opacity: 0.8,
                  }}
                >
                  <strong>Input:</strong>
                  <pre
                    style={{
                      margin: '0.25rem 0 0 0',
                      whiteSpace: 'pre-wrap',
                      fontSize: '0.75em',
                      color: '#ffffff',
                      fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                      lineHeight: '1.4',
                      background: '#1e1e1e',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #444',
                      overflow: 'auto',
                      maxHeight: '200px',
                    }}
                  >
                    {JSON.stringify(part.state.input, null, 2)}
                  </pre>
                </div>
              )}
              {part.state?.output && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.9em',
                    opacity: 0.8,
                  }}
                >
                  <strong>Output:</strong>
                  <div
                    style={{
                      marginTop: '0.25rem',
                      maxHeight: '200px',
                      overflow: 'auto',
                      backgroundColor: '#1e1e1e',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #444',
                    }}
                  >
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        fontSize: '0.75em',
                        color: '#ffffff',
                        fontFamily:
                          'Monaco, Consolas, "Courier New", monospace',
                        lineHeight: '1.4',
                      }}
                    >
                      {typeof part.state.output === 'string'
                        ? part.state.output.substring(0, 1000) +
                          (part.state.output.length > 1000
                            ? '\n\n... (truncated)'
                            : '')
                        : JSON.stringify(part.state.output, null, 2)}
                    </pre>
                  </div>
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
          <div style={{ marginLeft: '1rem', fontSize: '0.9em', opacity: 0.7 }}>
            <div style={{ marginBottom: '0.5rem', color: '#9C27B0' }}>
              Step finished - Input: {tokens?.input}, Output: {tokens?.output}
            </div>
            <details style={{ marginTop: '0.5rem' }}>
              <summary
                style={{
                  cursor: 'pointer',
                  color: '#ffffff',
                  fontSize: '0.8em',
                }}
              >
                View raw event data
              </summary>
              <pre
                style={{
                  margin: '0.5rem 0 0 0',
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.75em',
                  color: '#ffffff',
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  lineHeight: '1.4',
                  background: '#1e1e1e',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid #444',
                  overflow: 'auto',
                  maxHeight: '300px',
                }}
              >
                {JSON.stringify(event.properties, null, 2)}
              </pre>
            </details>
          </div>
        );

      default:
        return (
          <div style={{ marginLeft: '1rem', fontSize: '0.9em', opacity: 0.7 }}>
            <details>
              <summary
                style={{
                  cursor: 'pointer',
                  color: '#ffffff',
                  fontSize: '0.9em',
                  marginBottom: '0.5rem',
                }}
              >
                View event data
              </summary>
              <pre
                style={{
                  margin: '0.5rem 0 0 0',
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.75em',
                  color: '#ffffff',
                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                  lineHeight: '1.4',
                  background: '#1e1e1e',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid #444',
                  overflow: 'auto',
                  maxHeight: '300px',
                }}
              >
                {JSON.stringify(event, null, 2)}
              </pre>
            </details>
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
        color: '#ffffff',
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
