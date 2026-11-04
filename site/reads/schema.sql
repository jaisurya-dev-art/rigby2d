-- SPDX-License-Identifier: MIT OR Apache-2.0
-- Apply: npx wrangler d1 execute rigby2d-reads --remote --file site/reads/schema.sql
-- Reads per post per day. The running total is the sum; nothing about the readers is stored.
CREATE TABLE IF NOT EXISTS reads (
  slug TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
);
-- Who was already counted today, as one-way hashes only; rows from earlier days are deleted.
CREATE TABLE IF NOT EXISTS seen (
  hash TEXT PRIMARY KEY,
  day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS seen_day ON seen (day);
