-- Golden Store — support chat attachments (2026-11-05)
-- Images + voice notes are stored as validated base64 data URLs in D1.
-- Safe to run more than once. The API also calls ensureSupportSchema().
--
-- Apply with: wrangler d1 execute <DB_NAME> --file=./migrations/20261105_support_attachments.sql

CREATE TABLE IF NOT EXISTS support_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  sender TEXT NOT NULL,                   -- 'user' | 'admin'
  kind TEXT NOT NULL,                     -- 'image' | 'audio'
  mime TEXT NOT NULL,
  name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  data_url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_attachments_thread
  ON support_attachments(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_attachments_message
  ON support_attachments(message_id, position);
