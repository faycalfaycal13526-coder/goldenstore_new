-- ============================================================================
-- OPTIONAL (not required by /api/search): FTS5 full-text index for large stores.
-- The shipped endpoint uses portable LIKE as requested; enable this only when
-- the catalog is big enough that a text scan becomes measurable. To use it,
-- replace the text predicate in lib/d1.ts searchApps() with an apps_fts MATCH.
-- D1 supports FTS5; the external-content table below mirrors `apps`.
-- ============================================================================
CREATE VIRTUAL TABLE IF NOT EXISTS apps_fts USING fts5(
  name, developer, short_description, description, search_terms,
  content='apps', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Backfill existing rows once.
INSERT INTO apps_fts(apps_fts) VALUES('rebuild');

-- Keep the index in sync with writes from the admin panel.
CREATE TRIGGER IF NOT EXISTS apps_ai AFTER INSERT ON apps BEGIN
  INSERT INTO apps_fts(rowid, name, developer, short_description, description, search_terms)
  VALUES (new.rowid, new.name, new.developer, new.short_description, new.description, new.search_terms);
END;
CREATE TRIGGER IF NOT EXISTS apps_ad AFTER DELETE ON apps BEGIN
  INSERT INTO apps_fts(apps_fts, rowid, name, developer, short_description, description, search_terms)
  VALUES ('delete', old.rowid, old.name, old.developer, old.short_description, old.description, old.search_terms);
END;
CREATE TRIGGER IF NOT EXISTS apps_au AFTER UPDATE ON apps BEGIN
  INSERT INTO apps_fts(apps_fts, rowid, name, developer, short_description, description, search_terms)
  VALUES ('delete', old.rowid, old.name, old.developer, old.short_description, old.description, old.search_terms);
  INSERT INTO apps_fts(rowid, name, developer, short_description, description, search_terms)
  VALUES (new.rowid, new.name, new.developer, new.short_description, new.description, new.search_terms);
END;
