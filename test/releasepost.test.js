// SPDX-License-Identifier: MIT OR Apache-2.0
// Release notes to devlog posts (.github/scripts/release-post.mjs): the post the release workflow
// writes for each published release, and that the devlog can read.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { postExists, releasePost } from '../.github/scripts/release-post.mjs';

const NOTES = `Rigby2D 0.5.0: **faster exports**, a [timeline](https://x) you can zoom, and Cocos Creator. Second sentence.

## What's new

### Faster exports

- Twice as fast.

## Downloads

| File | What |

## SHA-256 checksums

\`\`\`
abc  file
\`\`\`
`;

test('a release becomes a devlog post without downloads or checksums', () => {
  const post = releasePost({ tag: 'v0.5.0', date: '2026-11-20', notes: NOTES, name: 'Rigby2D 0.5.0' });
  assert.equal(post.file, '2026-11-20-rigby2d-0-5-0.md');
  assert.match(post.text, /^---\ntitle: Rigby2D 0\.5\.0: Faster exports, a timeline you can zoom, and Cocos Creator\n|^---\ntitle: Rigby2D 0\.5\.0: faster exports/);
  assert.match(post.text, /\nsummary: Faster exports, a timeline you can zoom, and Cocos Creator\. Second sentence\.\n/);
  assert.match(post.text, /### Faster exports/);
  assert.ok(!post.text.includes('SHA-256') && !post.text.includes('| File |'));
  assert.match(post.text, /releases\/tag\/v0\.5\.0/);
});

test('a release name that says more becomes the title', () => {
  const post = releasePost({ tag: 'v0.5.0', date: '2026-11-20', notes: NOTES, name: 'Rigby2D 0.5.0: the Cocos release' });
  assert.match(post.text, /\ntitle: Rigby2D 0\.5\.0: the Cocos release\n/);
});

test('an existing post for the version is found, whatever its date', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posts-'));
  fs.writeFileSync(path.join(dir, '2026-11-19-rigby2d-0-5-0.md'), 'x');
  assert.ok(postExists('rigby2d-0-5-0', dir));
  assert.ok(!postExists('rigby2d-0-5-1', dir));
});
