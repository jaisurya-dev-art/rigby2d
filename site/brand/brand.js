// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's Brand page: static content (the logo files are copied in by vite.config.js,
// brandFiles); only the anonymous visit counts and the mobile menu run here.

import { startAnalytics } from '../../src/editor/analytics.js';
import { installMobileNav } from '../nav.js';

startAnalytics();
installMobileNav();
