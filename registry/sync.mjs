// SPDX-License-Identifier: MIT OR Apache-2.0
// Updates registry/index.json from the add-ons' repositories: new releases become new versions once
// they pass the checks. Run by .github/workflows/addon-registry.yml every few hours, and by hand:
//   node registry/sync.mjs            update the index
//   node registry/sync.mjs --check    check every entry, write nothing; fails when one has no good version
//   node registry/sync.mjs --only id  update one add-on
// Set GITHUB_TOKEN to raise GitHub's rate limit.

import { inspect, readEntries, readIndex, writeIndex } from './registry.mjs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const previous = new Map(readIndex().addons.map((a) => [a.id, a]));
const result = new Map(previous);
let failed = 0;
for (const entry of readEntries()) {
  if (only && entry.id !== only) continue;
  const addon = await inspect(entry, previous.get(entry.id), console.log);
  const versions = addon.versions.map((v) => v.version).join(', ') || 'none';
  console.log(`${addon.problems.length ? '✗' : '✓'} ${entry.id}: ${versions}${addon.problems.length ? ` (${addon.problems.join('; ')})` : ''}`);
  for (const s of addon.skipped ?? []) console.log(`    skipped ${s.tag}: ${s.problems.join('; ')}`);
  if (addon.problems.length) failed++;
  result.set(entry.id, addon);
}
// Entries that were removed leave the index.
const ids = new Set(readEntries().map((e) => e.id));
for (const id of result.keys()) if (!ids.has(id)) result.delete(id);

if (check) process.exit(failed ? 1 : 0);
console.log(writeIndex([...result.values()]) ? 'registry/index.json updated' : 'registry/index.json unchanged');
