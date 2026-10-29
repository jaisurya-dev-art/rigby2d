// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's Cloud page. The waitlist form stays hidden until WAITLIST is set to the mailing list's
// subscribe endpoint (a form POST with an `email` field); update docs/privacy.md when turning it on.

import { startAnalytics } from '../../src/editor/analytics.js';
import { installMobileNav } from '../nav.js';

const WAITLIST = '';

startAnalytics();
installMobileNav();

if (WAITLIST) {
  const form = document.getElementById('waitlist');
  form.action = WAITLIST;
  form.method = 'post';
  form.target = '_blank';
  form.hidden = false;
  document.getElementById('waitlist-note').textContent =
    'One email when Cloud opens, and nothing else. Unsubscribe any time.';
}
