import React from 'react';
import EventRenderer from './EventRenderer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

interface DebugPaneProps {
  events: any[];
}

const DebugPane: React.FC<DebugPaneProps> = ({ events }) => {
  return (
    <div className="h-full flex flex-col bg-background/50">
      <div className="px-4 py-3 border-b border-border bg-card/30 flex items-center justify-between">
        <h2 className="text-sm font-mono font-semibold text-foreground">
          <span className="text-primary">$</span> DEBUG_EVENTS
        </h2>
        <Badge variant="secondary" className="font-mono text-xs">
          {events.length} events
        </Badge>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {events
            .slice()
            .reverse()
            .map((event, index) => (
              <EventRenderer key={events.length - 1 - index} event={event} />
            ))}
          {events.length === 0 && (
            <div className="text-center py-8 text-muted-foreground font-mono text-xs">
              <div className="text-lg mb-2">📡</div>
              <div>Waiting for events...</div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default DebugPane;
