-- Streaming State Machine Database Schema
-- Complete implementation including conversations, messages, and streaming

-- Users table (simplified for this example)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Conversations - groups messages together
CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active_prompt_id INTEGER, -- Currently streaming prompt, if any
    
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_user_conversations (user_id, updated_at DESC)
);

-- Messages - container for both user and assistant messages
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL,
    prompt_id INTEGER, -- Links to prompts table for assistant messages
    role ENUM('user', 'assistant', 'system') NOT NULL,
    is_complete BOOLEAN DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (prompt_id) REFERENCES prompts(id),
    INDEX idx_conversation_messages (conversation_id, created_at)
);

-- Prompts - represents an AI completion request and its state
CREATE TABLE prompts (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL,
    message_id INTEGER, -- The assistant message this prompt is generating
    state VARCHAR(20) NOT NULL CHECK (state IN ('CREATED', 'IN_PROGRESS', 'WAITING_FOR_TOOLS', 'FAILED', 'ERROR', 'COMPLETED', 'CANCELED')),
    model VARCHAR(100) NOT NULL, -- Which AI model is being used
    system_message TEXT, -- System prompt used for this request
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    error TEXT, -- Nullable - stores error messages when state is FAILED or ERROR
    current_block INTEGER, -- Nullable - index of the currently active block during streaming
    
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id),
    
    -- Indexes for performance
    INDEX idx_prompts_state (state),
    INDEX idx_prompts_conversation (conversation_id),
    INDEX idx_prompts_last_updated (last_updated)
);

-- Auto-update last_updated timestamp
CREATE TRIGGER update_prompts_last_updated 
    BEFORE UPDATE ON prompts 
    FOR EACH ROW 
    SET NEW.last_updated = CURRENT_TIMESTAMP;

-- Stream events - granular log of all streaming activity (ephemeral)
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    prompt_id INTEGER NOT NULL,
    index_num INTEGER NOT NULL, -- Monotonically increasing per prompt
    type VARCHAR(20) NOT NULL CHECK (type IN ('block_start', 'block_delta', 'block_end')),
    block_type VARCHAR(20) CHECK (block_type IN ('text', 'thinking', 'tool_call', 'attachment')),
    block_index INTEGER, -- Which block this event relates to
    delta TEXT, -- The actual content/change for this event
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
    
    -- Ensure monotonic ordering per prompt
    UNIQUE KEY unique_prompt_index (prompt_id, index_num),
    INDEX idx_events_prompt_id (prompt_id),
    INDEX idx_events_prompt_index (prompt_id, index_num)
);

-- Content blocks - serves both streaming (temporary) and completed messages (permanent)
CREATE TABLE blocks (
    id SERIAL PRIMARY KEY,
    prompt_id INTEGER NOT NULL,
    message_id INTEGER, -- NULL while streaming, set when complete
    type VARCHAR(20) NOT NULL CHECK (type IN ('text', 'thinking', 'tool_call', 'attachment')),
    index_num INTEGER NOT NULL, -- Block ordering within the message
    content TEXT, -- For text/thinking blocks - accumulated from deltas
    metadata JSON, -- For attachments, tool parameters, or other structured data
    is_finalized BOOLEAN DEFAULT false, -- True when streaming is complete
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    
    -- Indexes optimized for both streaming and completed queries
    UNIQUE KEY unique_prompt_block_index (prompt_id, index_num),
    INDEX idx_blocks_streaming (prompt_id, index_num) WHERE message_id IS NULL,
    INDEX idx_blocks_completed (message_id, index_num) WHERE message_id IS NOT NULL
);

-- Auto-update blocks updated_at timestamp
CREATE TRIGGER update_blocks_updated_at 
    BEFORE UPDATE ON blocks 
    FOR EACH ROW 
    SET NEW.updated_at = CURRENT_TIMESTAMP;

-- Tool calls - async tool execution tracking
CREATE TABLE tool_calls (
    id SERIAL PRIMARY KEY,
    prompt_id INTEGER NOT NULL,
    block_id INTEGER NOT NULL,
    api_tool_call_id VARCHAR(255), -- Tool call ID from the AI API
    tool_name VARCHAR(255) NOT NULL, -- Name of the tool being called
    state VARCHAR(20) NOT NULL CHECK (state IN ('created', 'running', 'complete', 'error', 'canceled')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    request JSON NOT NULL, -- Tool input/parameters
    response JSON, -- Tool output on success
    error TEXT, -- Error message on failure
    
    FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
    FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE,
    
    INDEX idx_tool_calls_prompt_id (prompt_id),
    INDEX idx_tool_calls_block_id (block_id),
    INDEX idx_tool_calls_state (state),
    INDEX idx_tool_calls_updated_at (updated_at), -- For timeout detection
    INDEX idx_tool_calls_prompt_state (prompt_id, state) -- For checking pending tools
);

-- Attachments for user messages
CREATE TABLE attachments (
    id SERIAL PRIMARY KEY,
    block_id INTEGER NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    storage_url TEXT NOT NULL, -- S3/CDN URL or base64 data URI
    extracted_text TEXT, -- For PDFs or OCR'd images
    
    FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE,
    INDEX idx_attachments_block_id (block_id)
);

-- Auto-update tool_calls updated_at timestamp
CREATE TRIGGER update_tool_calls_updated_at 
    BEFORE UPDATE ON tool_calls 
    FOR EACH ROW 
    SET NEW.updated_at = CURRENT_TIMESTAMP;

-- Views for common queries

-- Active prompts that may need attention
CREATE VIEW active_prompts AS
SELECT 
    p.*,
    c.user_id,
    COUNT(tc.id) as pending_tool_calls,
    MIN(tc.created_at) as oldest_tool_call
FROM prompts p
JOIN conversations c ON p.conversation_id = c.id
LEFT JOIN tool_calls tc ON p.id = tc.prompt_id AND tc.state IN ('created', 'running')
WHERE p.state IN ('IN_PROGRESS', 'WAITING_FOR_TOOLS')
GROUP BY p.id, c.user_id;

-- Tool calls that have timed out (> 1 minute old)
CREATE VIEW timed_out_tool_calls AS
SELECT *
FROM tool_calls
WHERE state IN ('created', 'running') 
AND updated_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE);

-- Get conversation with all messages and blocks
CREATE VIEW conversation_messages AS
SELECT 
    c.id as conversation_id,
    c.title,
    c.active_prompt_id,
    m.id as message_id,
    m.role,
    m.is_complete,
    m.created_at as message_time,
    b.id as block_id,
    b.type as block_type,
    b.index_num as block_index,
    b.content as block_content,
    b.metadata as block_metadata,
    b.is_finalized,
    tc.tool_name,
    tc.state as tool_state,
    tc.request as tool_request,
    tc.response as tool_response,
    a.file_name,
    a.mime_type,
    a.storage_url
FROM conversations c
JOIN messages m ON c.id = m.conversation_id
LEFT JOIN blocks b ON m.id = b.message_id OR (m.prompt_id = b.prompt_id AND b.message_id IS NULL)
LEFT JOIN tool_calls tc ON b.id = tc.block_id
LEFT JOIN attachments a ON b.id = a.block_id
ORDER BY c.id, m.created_at, b.index_num;

-- Get current streaming state for a conversation
CREATE VIEW streaming_state AS
SELECT 
    c.id as conversation_id,
    p.id as prompt_id,
    p.state as prompt_state,
    p.current_block,
    COUNT(DISTINCT b.id) as total_blocks,
    COUNT(DISTINCT CASE WHEN tc.state IN ('created', 'running') THEN tc.id END) as pending_tools,
    MAX(e.index_num) as last_event_index
FROM conversations c
JOIN prompts p ON c.active_prompt_id = p.id
LEFT JOIN blocks b ON p.id = b.prompt_id
LEFT JOIN tool_calls tc ON p.id = tc.prompt_id
LEFT JOIN events e ON p.id = e.prompt_id
WHERE p.state NOT IN ('COMPLETED', 'FAILED', 'CANCELED')
GROUP BY c.id, p.id;