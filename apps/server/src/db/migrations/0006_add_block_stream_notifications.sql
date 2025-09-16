-- Add pgnotify triggers to broadcast streaming block events

-- Notify when a block is created for a prompt
CREATE OR REPLACE FUNCTION notify_block_created()
RETURNS TRIGGER AS $$
DECLARE
  prompt_id INTEGER;
BEGIN
  SELECT p.id INTO prompt_id
  FROM prompts p
  WHERE p.message_id = NEW.message_id
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF prompt_id IS NOT NULL THEN
    PERFORM pg_notify(
      'prompt_stream_events',
      json_build_object(
        'type', 'block_start',
        'prompt_id', prompt_id,
        'block_id', NEW.id,
        'block_type', NEW.type
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS block_created_notify ON blocks;
CREATE TRIGGER block_created_notify
  AFTER INSERT ON blocks
  FOR EACH ROW
  EXECUTE FUNCTION notify_block_created();

-- Notify when a block receives additional streamed content
CREATE OR REPLACE FUNCTION notify_block_updated()
RETURNS TRIGGER AS $$
DECLARE
  prompt_id INTEGER;
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

  SELECT p.id INTO prompt_id
  FROM prompts p
  WHERE p.message_id = NEW.message_id
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF prompt_id IS NOT NULL THEN
    PERFORM pg_notify(
      'prompt_stream_events',
      json_build_object(
        'type', 'block_delta',
        'prompt_id', prompt_id,
        'block_id', NEW.id,
        'block_type', NEW.type,
        'delta', delta
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS block_updated_notify ON blocks;
CREATE TRIGGER block_updated_notify
  AFTER UPDATE ON blocks
  FOR EACH ROW
  WHEN (OLD.content IS DISTINCT FROM NEW.content AND NEW.type = 'text')
  EXECUTE FUNCTION notify_block_updated();

-- Notify when a streaming block ends
CREATE OR REPLACE FUNCTION notify_block_completed()
RETURNS TRIGGER AS $$
DECLARE
  block_index INTEGER;
  block_record RECORD;
BEGIN
  IF NEW.type <> 'content_block_stop' THEN
    RETURN NEW;
  END IF;

  block_index := (NEW.data->>'index')::INTEGER;

  SELECT b.id, b.type INTO block_record
  FROM prompts p
  JOIN blocks b ON b.message_id = p.message_id AND b."order" = block_index
  WHERE p.id = NEW.prompt_id
  ORDER BY b.id DESC
  LIMIT 1;

  IF block_record.id IS NOT NULL THEN
    PERFORM pg_notify(
      'prompt_stream_events',
      json_build_object(
        'type', 'block_end',
        'prompt_id', NEW.prompt_id,
        'block_id', block_record.id,
        'block_type', block_record.type
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prompt_event_block_stop_notify ON prompt_events;
CREATE TRIGGER prompt_event_block_stop_notify
  AFTER INSERT ON prompt_events
  FOR EACH ROW
  WHEN (NEW.type = 'content_block_stop')
  EXECUTE FUNCTION notify_block_completed();
