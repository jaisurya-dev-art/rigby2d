// SPDX-License-Identifier: MIT OR Apache-2.0
// Writes test/fixtures/sample-4.2.skel, the clean-room format 4.2 sample from skel42.js, which the
// runtimes' golden tests play (runtimes/rust/rigby-runtime/tests/golden/skel42.golden.json).
//   node test/fixtures/make-skel42.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encode42 } from './skel42.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sample-4.2.skel');
fs.writeFileSync(out, encode42());
console.log('wrote', out);
