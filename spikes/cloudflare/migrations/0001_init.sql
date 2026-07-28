-- Bounded queryable projection only. Full event history lives in R2.
CREATE TABLE IF NOT EXISTS cursors (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS block_partitions (
  from_block TEXT NOT NULL,
  to_block   TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  PRIMARY KEY (from_block, to_block)
);

CREATE TABLE IF NOT EXISTS quote_status (
  request_id     TEXT PRIMARY KEY,
  status         TEXT NOT NULL,
  nonce          INTEGER,
  observed_block TEXT
);
