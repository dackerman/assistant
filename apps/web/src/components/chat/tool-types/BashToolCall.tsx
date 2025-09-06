import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ChevronRight, ChevronDown, Terminal } from "lucide-react";
import type { ToolCall } from "@/types/conversation";

interface BashToolCallProps {
  toolCall: ToolCall;
  isExpanded: boolean;
  onToggle: () => void;
  statusIcon: React.ReactNode;
}

export function BashToolCall({
  toolCall,
  isExpanded,
  onToggle,
  statusIcon,
}: BashToolCallProps) {
  return (
    <Card className="border-l-4 border-l-green-400">
      <CardHeader
        className="pb-1 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )}
            <Terminal className="w-3 h-3 text-green-500" />
            <span className="text-xs font-mono font-medium">bash</span>
          </div>
          {statusIcon}
        </div>
        <div className="text-xs text-muted-foreground font-mono mt-1 leading-tight">
          $ {toolCall.parameters.command || "No command"}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <div className="space-y-3">
            <div>
              <div className="bg-gray-900 text-green-400 p-3 rounded font-mono text-xs">
                <div className="flex items-center gap-2 mb-2 text-gray-400">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                    <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  </div>
                  <span>bash</span>
                </div>
                <div className="text-green-400">
                  <span className="text-blue-400">$</span>{" "}
                  {toolCall.parameters.command}
                </div>
              </div>
            </div>

            {toolCall.result && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">
                  Output:
                </p>
                <div className="bg-gray-900 text-gray-100 p-3 rounded font-mono text-xs overflow-x-auto leading-relaxed whitespace-pre">
                  {typeof toolCall.result === "string"
                    ? toolCall.result
                    : JSON.stringify(toolCall.result, null, 2)}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:justify-between text-xs text-muted-foreground pt-2 border-t gap-1">
              <span>
                Started: {new Date(toolCall.startTime).toLocaleTimeString()}
              </span>
              {toolCall.endTime && (
                <span>
                  Ended: {new Date(toolCall.endTime).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
