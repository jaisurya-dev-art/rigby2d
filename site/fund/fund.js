// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's Support page: the monthly goal and the supporters wall (supporters.js).

import { startAnalytics } from '../../src/editor/analytics.js';
import { installMobileNav } from '../nav.js';
import { loadSupporters, renderGoal, renderWall } from '../supporters.js';

startAnalytics();
installMobileNav();

const data = await loadSupporters();
renderGoal(document.getElementById('goal'), data.goal);
renderWall(document.getElementById('wall'), document.getElementById('wall-empty'), data);
if (data.kofi) {
  const kofi = document.getElementById('kofi');
  kofi.href = data.kofi;
  kofi.hidden = false;
}
