// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's Cloud page and its waitlist form, which posts to the Worker in site/waitlist/.

import { startAnalytics } from '../../src/editor/analytics.js';
import { installMobileNav } from '../nav.js';

startAnalytics();
installMobileNav();

const form = document.getElementById('waitlist');
const note = document.getElementById('waitlist-note');
form.hidden = false;
note.textContent = 'One email when Cloud opens, and nothing else. See the privacy statement.';

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.email.value, website: form.website.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
    form.hidden = true;
    note.textContent = "You're on the list. We'll email you when Rigby2D Cloud opens.";
  } catch (err) {
    note.textContent = err.message;
    button.disabled = false;
  }
});
