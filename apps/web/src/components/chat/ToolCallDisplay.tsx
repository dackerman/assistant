import { useState } from "react";
import { Clock, Play, CheckCircle, XCircle } from "lucide-react";
import type { ToolCall } from "@/types/conversation";
import { BashToolCall } from "./tool-types/BashToolCall";
import { AsanaToolCall } from "./tool-types/AsanaToolCall";
import { GoogleCalendarToolCall } from "./tool-types/GoogleCalendarToolCall";
import { GmailToolCall } from "./tool-types/GmailToolCall";
import { DefaultToolCall } from "./tool-types/DefaultToolCall";

interface ToolCallDisplayProps {
  toolCall: ToolCall;
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(toolCall.status === "running");

  const getStatusIcon = (status: ToolCall["status"]) => {
    switch (status) {
      case "pending":
        return <Clock className="w-3 h-3 text-gray-500" />;
      case "running":
        return <Play className="w-3 h-3 text-blue-500 animate-pulse" />;
      case "completed":
        return <CheckCircle className="w-3 h-3 text-green-500" />;
      case "error":
        return <XCircle className="w-3 h-3 text-red-500" />;
      default:
        return <Clock className="w-3 h-3 text-gray-500" />;
    }
  };

  const statusIcon = getStatusIcon(toolCall.status);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  // Route to appropriate tool component
  switch (toolCall.name) {
    case "bash":
      return (
        <BashToolCall
          toolCall={toolCall}
          isExpanded={isExpanded}
          onToggle={handleToggle}
          statusIcon={statusIcon}
        />
      );
    case "asana":
    case "asana_create_task":
    case "asana_get_tasks":
      return (
        <AsanaToolCall
          toolCall={toolCall}
          isExpanded={isExpanded}
          onToggle={handleToggle}
          statusIcon={statusIcon}
        />
      );
    case "google_calendar":
    case "calendar_create_event":
    case "calendar_get_events":
      return (
        <GoogleCalendarToolCall
          toolCall={toolCall}
          isExpanded={isExpanded}
          onToggle={handleToggle}
          statusIcon={statusIcon}
        />
      );
    case "gmail":
    case "gmail_send":
    case "gmail_get_emails":
      return (
        <GmailToolCall
          toolCall={toolCall}
          isExpanded={isExpanded}
          onToggle={handleToggle}
          statusIcon={statusIcon}
        />
      );
    default:
      return (
        <DefaultToolCall
          toolCall={toolCall}
          isExpanded={isExpanded}
          onToggle={handleToggle}
          statusIcon={statusIcon}
        />
      );
  }
}
