CREATE TABLE feedback (
  id TEXT PRIMARY KEY NOT NULL,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 3 AND 2000),
  created_at INTEGER NOT NULL
);

CREATE INDEX feedback_created_at_idx ON feedback (created_at DESC);
