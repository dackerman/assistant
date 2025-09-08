-- Add LISTEN/NOTIFY support for tool calls

-- Create the notification function
CREATE OR REPLACE FUNCTION notify_tool_call_created()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify for newly created tool calls
  IF NEW.state = 'created' THEN
    PERFORM pg_notify(
      'tool_call_created', 
      json_build_object(
        'id', NEW.id,
        'prompt_id', NEW.prompt_id,
        'tool_name', NEW.tool_name,
        'api_tool_call_id', NEW.api_tool_call_id,
        'request', NEW.request
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on tool_calls table
CREATE TRIGGER tool_call_created_trigger
  AFTER INSERT ON tool_calls
  FOR EACH ROW
  EXECUTE FUNCTION notify_tool_call_created();

-- Also create a trigger for state updates (optional - useful for monitoring)
CREATE OR REPLACE FUNCTION notify_tool_call_state_changed()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify when state actually changes
  IF OLD.state IS DISTINCT FROM NEW.state THEN
    PERFORM pg_notify(
      'tool_call_state_changed',
      json_build_object(
        'id', NEW.id,
        'old_state', OLD.state,
        'new_state', NEW.state,
        'tool_name', NEW.tool_name
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tool_call_state_changed_trigger
  AFTER UPDATE ON tool_calls
  FOR EACH ROW
  EXECUTE FUNCTION notify_tool_call_state_changed();