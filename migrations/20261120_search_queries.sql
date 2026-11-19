-- «عمليات البحث الرائجة» must reflect what people really searched.
-- One row per search, written by GET /api/search (2-60 chars, lowercased).
CREATE TABLE IF NOT EXISTS search_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_queries_term ON search_queries(term);
CREATE INDEX IF NOT EXISTS idx_search_queries_time ON search_queries(created_at);
