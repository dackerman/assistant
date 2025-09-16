import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ToolCall } from "@/types/conversation";
import { CheckSquare, ChevronDown, ChevronRight } from "lucide-react";
import { formatInlineValue, formatMultilineValue } from "./utils";

interface AsanaToolCallProps {
  toolCall: ToolCall;
  isExpanded: boolean;
  onToggle: () => void;
  statusIcon: React.ReactNode;
}

export function AsanaToolCall({
  toolCall,
  isExpanded,
  onToggle,
  statusIcon,
}: AsanaToolCallProps) {
  const params = toolCall.parameters;
  const action = typeof params.action === "string" ? params.action : "";

  const getActionDescription = () => {
    if (action === "create_task") {
      return `Creating task: "${formatInlineValue(params.name)}"`;
    }
    if (action === "update_task") {
      return `Updating task: "${formatInlineValue(params.name)}"`;
    }
    if (action === "get_tasks") {
      return `Fetching tasks from project: ${formatInlineValue(
        params.project,
      )}`;
    }
    return "Asana operation";
  };

  return (
    <Card className="border-l-4 border-l-orange-400">
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
            <CheckSquare className="w-3 h-3 text-orange-500" />
            <span className="text-xs font-medium">Asana</span>
          </div>
          {statusIcon}
        </div>
        <div className="text-xs text-muted-foreground mt-1 leading-tight">
          {getActionDescription()}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <div className="space-y-3">
            <div>
              <div className="bg-orange-50 border border-orange-200 p-3 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <CheckSquare className="w-4 h-4 text-orange-500" />
                  <span className="text-xs font-medium text-orange-700">
                    Task Details
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  {params.name !== undefined && params.name !== null && (
                    <div>
                      <span className="font-medium">Task:</span>{" "}
                      {formatInlineValue(params.name)}
                    </div>
                  )}
                  {params.project !== undefined && params.project !== null && (
                    <div>
                      <span className="font-medium">Project:</span>{" "}
                      {formatInlineValue(params.project)}
                    </div>
                  )}
                  {params.assignee !== undefined && params.assignee !== null && (
                    <div>
                      <span className="font-medium">Assignee:</span>{" "}
                      {formatInlineValue(params.assignee)}
                    </div>
                  )}
                  {params.due_date !== undefined && params.due_date !== null && (
                    <div>
                      <span className="font-medium">Due:</span>{" "}
                      {formatInlineValue(params.due_date)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {toolCall.result !== undefined && toolCall.result !== null && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">
                  Result:
                </p>
                <div className="bg-green-50 border border-green-200 p-3 rounded text-xs">
                  {formatMultilineValue(toolCall.result)}
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
