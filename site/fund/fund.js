// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's Support page: the monthly goal, the Founding 20 seats and the other supporters
// (supporters.js).

import { startAnalytics } from '../../src/editor/analytics.js';
import { installMobileNav } from '../nav.js';
import { loadSupporters, renderFounding, renderGoal } from '../supporters.js';

startAnalytics();
installMobileNav();

const data = await loadSupporters();
renderGoal(document.getElementById('goal'), data.goal);
renderFounding(data, { seats: 'seats', others: 'wall', othersBlock: 'others-block', empty: 'wall-empty', supporters: 'stat-supporters', spotsLeft: 'stat-founding' });
if (data.kofi) {
  const kofi = document.getElementById('kofi');
  kofi.href = data.kofi;
  kofi.hidden = false;
}
