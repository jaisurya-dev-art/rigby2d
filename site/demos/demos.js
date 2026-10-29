// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's Demos page: static content; only the anonymous visit counts run here (analytics.js).

import { startAnalytics } from '../../src/editor/analytics.js';
import { installMobileNav } from '../nav.js';

startAnalytics();
installMobileNav();
