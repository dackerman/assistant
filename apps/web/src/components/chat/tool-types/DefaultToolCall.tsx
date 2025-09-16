import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ToolCall } from "@/types/conversation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatInlineValue, formatMultilineValue } from "./utils";

interface DefaultToolCallProps {
  toolCall: ToolCall;
  isExpanded: boolean;
  onToggle: () => void;
  statusIcon: React.ReactNode;
}

export function DefaultToolCall({
  toolCall,
  isExpanded,
  onToggle,
  statusIcon,
}: DefaultToolCallProps) {
  const params = toolCall.parameters;

  const getSimpleDescription = () => {
    // For write commands, show the file path
    if (toolCall.name === "write" && params.filePath !== undefined) {
      return `Write to ${formatInlineValue(params.filePath)}`;
    }

    // For other tools, show description if available, otherwise parameters
    if (params.description !== undefined && params.description !== null) {
      return formatInlineValue(params.description);
    }

    // Fallback to showing the tool name with first parameter
    const firstParam = Object.entries(params)[0];
    return firstParam
      ? `${firstParam[0]}: ${formatInlineValue(firstParam[1]).slice(0, 50)}...`
      : "No parameters";
  };

  return (
    <Card className="border-l-4 border-l-purple-400">
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
            <CardTitle className="text-xs font-mono">{toolCall.name}</CardTitle>
          </div>
          {statusIcon}
        </div>
        <div className="text-xs text-muted-foreground font-mono mt-1 leading-tight">
          {getSimpleDescription()}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <div className="space-y-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium">
                Parameters:
              </p>
              <pre className="text-xs bg-muted p-2 rounded font-mono overflow-x-auto leading-tight">
                {formatMultilineValue(params)}
              </pre>
            </div>

            {toolCall.result !== undefined && toolCall.result !== null && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">
                  Result:
                </p>
                <pre className="text-xs bg-green-50 p-2 rounded font-mono overflow-x-auto border border-green-200 leading-tight">
                  {formatMultilineValue(toolCall.result)}
                </pre>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:justify-between text-xs text-muted-foreground pt-1 border-t gap-1">
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
