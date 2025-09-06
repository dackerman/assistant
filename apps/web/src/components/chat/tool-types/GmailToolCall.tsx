import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ChevronRight, ChevronDown, Mail } from "lucide-react";
import type { ToolCall } from "@/types/conversation";

interface GmailToolCallProps {
  toolCall: ToolCall;
  isExpanded: boolean;
  onToggle: () => void;
  statusIcon: React.ReactNode;
}

export function GmailToolCall({
  toolCall,
  isExpanded,
  onToggle,
  statusIcon,
}: GmailToolCallProps) {
  const getActionDescription = () => {
    if (toolCall.parameters.action === "send_email") {
      return `Sending email to: ${toolCall.parameters.to}`;
    }
    if (toolCall.parameters.action === "get_emails") {
      return `Fetching emails from inbox`;
    }
    if (toolCall.parameters.action === "reply_to_email") {
      return `Replying to email: "${toolCall.parameters.subject}"`;
    }
    return "Gmail operation";
  };

  return (
    <Card className="border-l-4 border-l-red-400">
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
            <Mail className="w-3 h-3 text-red-500" />
            <span className="text-xs font-medium">Gmail</span>
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
              <div className="bg-red-50 border border-red-200 p-3 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <Mail className="w-4 h-4 text-red-500" />
                  <span className="text-xs font-medium text-red-700">
                    Email Details
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  {toolCall.parameters.to && (
                    <div>
                      <span className="font-medium">To:</span>{" "}
                      {toolCall.parameters.to}
                    </div>
                  )}
                  {toolCall.parameters.subject && (
                    <div>
                      <span className="font-medium">Subject:</span>{" "}
                      {toolCall.parameters.subject}
                    </div>
                  )}
                  {toolCall.parameters.body && (
                    <div>
                      <span className="font-medium">Body:</span>
                      <div className="mt-1 p-2 bg-white border rounded text-xs max-h-20 overflow-y-auto">
                        {toolCall.parameters.body}
                      </div>
                    </div>
                  )}
                  {toolCall.parameters.cc && (
                    <div>
                      <span className="font-medium">CC:</span>{" "}
                      {toolCall.parameters.cc}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {toolCall.result && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">
                  Result:
                </p>
                <div className="bg-green-50 border border-green-200 p-3 rounded text-xs">
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
