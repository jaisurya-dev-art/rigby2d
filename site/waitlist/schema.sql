-- SPDX-License-Identifier: MIT OR Apache-2.0
-- Apply: npx wrangler d1 execute rigby2d-waitlist --remote --file site/waitlist/schema.sql
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);
