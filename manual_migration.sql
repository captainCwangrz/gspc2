-- Add updated_at to users
ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add updated_at to relationships
ALTER TABLE relationships ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add created_at to users (optional but good practice, though current_timestamp on insert handles it usually if we had it, but let's stick to user request for updated_at)
-- We will just stick to updated_at for ETag.

-- Add Unique Index to relationships to prevent duplicate A->B rows
ALTER TABLE relationships ADD UNIQUE INDEX idx_rel_from_to (from_id, to_id);

-- Add Index for pagination on messages
ALTER TABLE messages ADD INDEX idx_msg_pagination (from_id, to_id, id);
