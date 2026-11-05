-- Golden Store — support chat (2026-11-05)
-- Safe to run more than once. The API also calls ensureSupportSchema(), which
-- issues the same CREATE TABLE IF NOT EXISTS statements, so a fresh deployment
-- works even before this migration is applied manually.
--
-- Apply with:  wrangler d1 execute <DB_NAME> --file=./migrations/20261105_support_chat.sql

CREATE TABLE IF NOT EXISTS support_threads (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,                       -- Firebase uid of the requester
  user_email TEXT,
  user_name TEXT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',    -- 'open' | 'closed'
  created_at INTEGER NOT NULL,            -- unix seconds
  updated_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  unread_admin INTEGER NOT NULL DEFAULT 0,
  unread_user INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  sender TEXT NOT NULL,                   -- 'user' | 'admin'
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_threads_uid   ON support_threads(uid, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_threads_admin ON support_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, created_at);
