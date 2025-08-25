import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface EventRendererProps {
  event: any;
}

const EventRenderer: React.FC<EventRendererProps> = ({ event }) => {
  const getEventColor = (type: string) => {
    switch (type) {
      case 'message.part.updated':
        return 'default';
      case 'tool':
        return 'secondary';
      case 'step-start':
        return 'outline';
      case 'step-finish':
        return 'default';
      default:
        return 'outline';
    }
  };

  const renderEventContent = () => {
    switch (event.type) {
      case 'message.part.updated':
        const part = event.properties?.part;
        if (part?.type === 'text') {
          return (
            <div className="ml-4 text-xs font-mono">
              <span className="text-muted-foreground">TEXT:</span>{' '}
              {part.text?.substring(0, 100)}
              {part.text?.length > 100 && '...'}
            </div>
          );
        } else if (part?.type === 'tool') {
          return (
            <div className="ml-4 text-xs font-mono space-y-1">
              <div>
                <span className="text-muted-foreground">TOOL:</span> {part.tool}
              </div>
              <div>
                <span className="text-muted-foreground">STATUS:</span>{' '}
                {part.state?.status}
              </div>
              {part.callID && (
                <div className="text-xs opacity-60">ID: {part.callID}</div>
              )}
            </div>
          );
        }
        break;

      case 'step-start':
        return (
          <div className="ml-4 text-xs font-mono text-yellow-500">
            Starting step...
          </div>
        );

      case 'step-finish':
        const tokens = event.properties?.tokens;
        return (
          <div className="ml-4 text-xs font-mono text-green-500">
            Step finished - In: {tokens?.input}, Out: {tokens?.output}
          </div>
        );

      default:
        return (
          <details className="ml-4">
            <summary className="cursor-pointer text-xs font-mono text-muted-foreground hover:text-foreground">
              View event data
            </summary>
            <pre className="mt-2 p-2 bg-background/50 border border-border rounded text-xs overflow-auto max-h-32">
              {JSON.stringify(event, null, 2)}
            </pre>
          </details>
        );
    }
  };

  return (
    <Card
      className="bg-card/50 border-l-2"
      style={{ borderLeftColor: `hsl(var(--primary) / 0.5)` }}
    >
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <Badge
            variant={getEventColor(event.type)}
            className="text-xs font-mono"
          >
            {event.type}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono">
            {new Date().toLocaleTimeString()}
          </span>
        </div>
        {renderEventContent()}
      </CardContent>
    </Card>
  );
};

export default EventRenderer;
