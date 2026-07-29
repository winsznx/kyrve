-- Bounded queryable projection ONLY. Full event history lives in R2, partitioned by block range.
--
-- D1 is deliberately not the event store: 10 GB hard cap, single-threaded per database, 100 bound
-- parameters per query, 1,000 queries per invocation (PRD v1.1 A-13). Every table here is bounded
-- by design and none of them grows with event volume.
--
-- PRIVACY: no column here can hold a decrypted value. Handles, statuses, cursors and public
-- amounts only.

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

CREATE INDEX IF NOT EXISTS idx_quote_status_status ON quote_status (status);
