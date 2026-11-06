// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's page for studios: mostly static, plus the studios that sponsor Rigby2D (from
// supporters.js), the shared navigation and visit counts.

import { startAnalytics } from '../../src/editor/analytics.js';
import { installMobileNav } from '../nav.js';
import { loadSupporters, renderStudios } from '../supporters.js';

startAnalytics();
installMobileNav();

loadSupporters().then((data) => renderStudios(document.getElementById('studio-logos'), data, { spots: 3 }));
