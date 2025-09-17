-- Extend streaming notifications to conversation-level events

-- Recreate block notification functions with additional metadata
CREATE OR REPLACE FUNCTION notify_block_created()
RETURNS TRIGGER AS $$
DECLARE
  prompt_record prompts%ROWTYPE;
BEGIN
  SELECT *
  INTO prompt_record
  FROM prompts
  WHERE message_id = NEW.message_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF prompt_record IS NOT NULL THEN
    PERFORM pg_notify(
      'prompt_stream_events',
      json_build_object(
        'type', 'block_start',
        'promptId', prompt_record.id,
        'conversationId', prompt_record.conversation_id,
        'messageId', prompt_record.message_id,
        'blockId', NEW.id,
        'blockType', NEW.type
      )::text
    );
    PERFORM pg_notify(
      'conversation_events',
      json_build_object(
        'type', 'block_start',
        'conversationId', prompt_record.conversation_id,
        'promptId', prompt_record.id,
        'messageId', prompt_record.message_id,
        'blockId', NEW.id,
        'blockType', NEW.type
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_block_updated()
RETURNS TRIGGER AS $$
DECLARE
  prompt_record prompts%ROWTYPE;
  delta TEXT;
  previous_length INTEGER;
  new_length INTEGER;
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content AND NEW.type = 'text' THEN
    previous_length := COALESCE(length(OLD.content), 0);
    new_length := COALESCE(length(NEW.content), 0);
    IF new_length > previous_length THEN
      delta := right(NEW.content, new_length - previous_length);
    ELSE
      delta := NEW.content;
    END IF;
  END IF;

  IF delta IS NULL OR delta = '' THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO prompt_record
  FROM prompts
  WHERE message_id = NEW.message_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF prompt_record IS NOT NULL THEN
    PERFORM pg_notify(
      'prompt_stream_events',
      json_build_object(
        'type', 'block_delta',
        'promptId', prompt_record.id,
        'conversationId', prompt_record.conversation_id,
        'messageId', prompt_record.message_id,
        'blockId', NEW.id,
        'blockType', NEW.type,
        'delta', delta
      )::text
    );
    PERFORM pg_notify(
      'conversation_events',
      json_build_object(
        'type', 'block_delta',
        'conversationId', prompt_record.conversation_id,
        'promptId', prompt_record.id,
        'messageId', prompt_record.message_id,
        'blockId', NEW.id,
        'blockType', NEW.type,
        'delta', delta
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_block_completed()
RETURNS TRIGGER AS $$
DECLARE
  prompt_record prompts%ROWTYPE;
  block_record blocks%ROWTYPE;
BEGIN
  IF NEW.type <> 'content_block_stop' THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO prompt_record
  FROM prompts
  WHERE id = NEW.prompt_id
  LIMIT 1;

  IF prompt_record IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO block_record
  FROM blocks
  WHERE message_id = prompt_record.message_id
    AND "order" = (NEW.data->>'index')::INTEGER
  ORDER BY id DESC
  LIMIT 1;

  IF block_record IS NOT NULL THEN
    PERFORM pg_notify(
      'prompt_stream_events',
      json_build_object(
        'type', 'block_end',
        'promptId', prompt_record.id,
        'conversationId', prompt_record.conversation_id,
        'messageId', prompt_record.message_id,
        'blockId', block_record.id
      )::text
    );
    PERFORM pg_notify(
      'conversation_events',
      json_build_object(
        'type', 'block_end',
        'conversationId', prompt_record.conversation_id,
        'promptId', prompt_record.id,
        'messageId', prompt_record.message_id,
        'blockId', block_record.id
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Conversation-level message events
CREATE OR REPLACE FUNCTION notify_message_event()
RETURNS TRIGGER AS $$
DECLARE
  event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_type := 'message_created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.content IS DISTINCT FROM OLD.content
      OR COALESCE(NEW.queue_order, -1) IS DISTINCT FROM COALESCE(OLD.queue_order, -1)
    THEN
      event_type := 'message_updated';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  PERFORM pg_notify(
    'conversation_events',
    json_build_object(
      'type', event_type,
      'conversationId', NEW.conversation_id,
      'message', json_build_object(
        'id', NEW.id,
        'conversationId', NEW.conversation_id,
        'role', NEW.role,
        'content', NEW.content,
        'status', NEW.status,
        'queueOrder', NEW.queue_order,
        'createdAt', NEW.created_at,
        'updatedAt', NEW.updated_at
      )
    )::text
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_events_notify ON messages;
CREATE TRIGGER message_events_notify
  AFTER INSERT OR UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_message_event();

-- Conversation-level prompt events
CREATE OR REPLACE FUNCTION notify_prompt_event()
RETURNS TRIGGER AS $$
DECLARE
  event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'streaming' THEN
      event_type := 'prompt_started';
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'completed' AND NEW.status IS DISTINCT FROM OLD.status THEN
      event_type := 'prompt_completed';
    ELSIF NEW.status = 'error' AND NEW.status IS DISTINCT FROM OLD.status THEN
      event_type := 'prompt_failed';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  PERFORM pg_notify(
    'conversation_events',
    json_build_object(
      'type', event_type,
      'conversationId', NEW.conversation_id,
      'prompt', json_build_object(
        'id', NEW.id,
        'conversationId', NEW.conversation_id,
        'messageId', NEW.message_id,
        'status', NEW.status,
        'model', NEW.model,
        'systemMessage', NEW.system_message,
        'createdAt', NEW.created_at,
        'completedAt', NEW.completed_at,
        'error', NEW.error
      )
    )::text
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prompt_events_notify ON prompts;
CREATE TRIGGER prompt_events_notify
  AFTER INSERT OR UPDATE ON prompts
  FOR EACH ROW
  EXECUTE FUNCTION notify_prompt_event();
