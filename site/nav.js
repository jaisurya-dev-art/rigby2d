// SPDX-License-Identifier: MIT OR Apache-2.0
// The site header's menu button on small screens: shows and hides the section links.

export function installMobileNav() {
  const header = document.querySelector('.nav');
  const button = header?.querySelector('.nav-toggle');
  const menu = header?.querySelector('#site-nav');
  if (!button || !menu) return;
  const set = (open) => {
    header.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
  };
  button.addEventListener('click', () => set(!header.classList.contains('open')));
  // A link was followed (often an anchor on this page): the menu has done its job.
  menu.addEventListener('click', (e) => e.target.closest('a') && set(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && header.classList.contains('open')) {
      set(false);
      button.focus();
    }
  });
  document.addEventListener('click', (e) => header.classList.contains('open') && !header.contains(e.target) && set(false));
  // Back to a wide window: the links are in the bar again.
  matchMedia('(min-width: 821px)').addEventListener('change', (e) => e.matches && set(false));
}
