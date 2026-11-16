CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  total INTEGER NOT NULL,
  maze_ms INTEGER,
  levels TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_rank ON scores (total DESC, maze_ms ASC, id ASC);
CREATE INDEX IF NOT EXISTS scores_ip ON scores (ip_hash, created_at);
