// SPDX-License-Identifier: MIT OR Apache-2.0
// The documentation's table of contents: sections in order, each a list of pages (docs/<slug>.md).
// Every page in docs/ that the website publishes must be listed here (test/docs.test.js checks it).

export const NAV = [
  {
    title: 'Getting started',
    pages: ['index', 'installation', 'quick-start', 'interface', 'preferences'],
  },
  {
    title: 'Rigging',
    pages: ['importing-art', 'autorig', 'bones-and-slots', 'meshes', 'constraints', 'skins-and-events'],
  },
  {
    title: 'Animation',
    pages: ['animating', 'graph-editor', 'onion-skin', 'guides', 'poses-and-faces', 'retargeting'],
  },
  {
    title: 'Film and audio',
    pages: ['film', 'scenes', 'lip-sync'],
  },
  {
    title: 'Automation',
    pages: ['scripting', 'addons', 'mcp', 'mcp-tools'],
  },
  {
    title: 'Shipping',
    pages: ['export', 'runtimes', 'file-formats'],
  },
  {
    title: 'Reference',
    pages: ['shortcuts', 'recovery', 'troubleshooting', 'demos', 'privacy'],
  },
];

export const PAGES = NAV.flatMap((s) => s.pages.map((slug) => ({ slug, section: s.title })));
