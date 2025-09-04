# TODO

## 1. persist conversations

- show a list of past conversations on the landing page, and a blank new conversation.
- clicking on a past conversation opens it up and lets you add more chats
- (optional) you can see how much context has been taken up so far

### Data model

We need to store _everything_ in the DB. Every user message, assistant message, tool call request/response. Also the _currently streaming LLM response_ needs to be persisted as well in a way that can be delivered to a client who previously disconnected.

When a client connects to a conversation, it needs to be able to stream in all the past messages and tool calls, and most importantly, the _currently streaming_ LLM result. This should be seamless and flawless, which means we need to perfectly be able to load in the partial message all the way up to the current chunk being returned, and then attach to the head of the stream.

Ideally this is a single abstraction - like you "connect" to a conversation and tell it where you are in the stream, and it will catch you up. It has to store the in-progress chunks, but for past messages, it doesn't have to send each one individually, you could get all the past messages in batch. So we need to store the ephemeral chunks but not really keep them around forever. so maybe there's some sort of separate table where the chunks are being stored for the current "in progress" message, and that gets garbage collected over time?

no matter what, it just has to be super robust to disconnections and reconnections - and when you reconnect, you can't lose any information.


## State machine for streaming
### Start stream
- create a prompt with all inputs
- prompt is in state CREATED
- send prompt data to AI 
  - on failure, prompt state is FAILED and store error in prompt
  - on success, prompt state is IN_PROGRESS
    - on event
      - in a transaction
        - write the event
        - if type is block_start, insert a new block with index N
            - update prompt current_block to N
        - if type is block_delta, update the block with index N
        - if type is block_end
          - if block type is tool_use
            - tool_call record is created with inputs (and ID of tool call from API)
            - async task is started to execute tool call
              - when async task finishes, it writes result to tool_use record
              - if the tool is marked canceled, the task runner will kill the job
    - on failure, prompt state is ERROR, and error is written to prompt
    - on message_stop
      - if tool call records were created
        - prompt state is WAITING_FOR_TOOLS
        - wait until all tool_call records are settled
          - then send tool call data response back to AI
            - prompt stat is IN_PROGRESS
            - continue streaming events as before
        - if tool_call.updated_at is more than 1 minute old
          - mark it canceled
          - mark the prompt state to ERROR
      - otherwise
        - prompt state is COMPLETED

### Resume stream
- if prompt state is COMPLETED
  - return success
- if prompt state is FAILED or CREATED
  - send prompt data to AI
  - continue the same as Start Stream flow
- if prompt state is ERROR
  - gather all completed text blocks and build up partial assistant message
  - send prompt data to AI
    - continue the same stream handling 

### Cancel stream
- if prompt state is CREATED, FAILED, ERROR, COMPLETED, or CANCELED
  - set prompt state to CANCELED
- if prompt state is IN_PROGRESS
  - query for all running tool_calls for this prompt
    - mark them canceled

### tables
prompts
- state: CREATED, IN_PROGRESS, FAILED, ERROR, COMPLETED, CANCELED
- last_updated: timestamp automatically updated
- error: text (nullable)
- current_block: integer (nullable)

events
- prompt: FK to prompts
- index: integer (monotonically increasing)
- type: block_start, block_delta, block_end
- block_type: text, thinking, tool_call
- delta: text

blocks
- prompt: FK to prompts
- type: text, thinking, tool_call
- index: integer
- content: text

tool_calls
- prompt: FK to prompts
- block: FK to blocks
- tool_name: text
- state: created, running, complete, error, canceled
- created_at: timestamp
- updated_at: timestamp
- request: text
- response: text
- error: text