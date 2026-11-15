#!/usr/bin/env node
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `rigby` command: Rigby2D editor operations from the command line (see docs/cli.md).

import { main } from '../src/cli/main.js';

process.exitCode = await main(process.argv.slice(2));
