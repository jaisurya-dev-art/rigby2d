// SPDX-License-Identifier: MIT OR Apache-2.0
// The documentation's table of contents: sections in order, each a list of pages (docs/<slug>.md).
// Every page in docs/ that the website publishes must be listed here (test/docs.test.js checks it).

export const NAV = [
  {
    title: 'Getting started',
    pages: ['index', 'installation', 'quick-start', 'interface', 'preferences', 'migrating-from-spine', 'migrating-from-dragonbones'],
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

/** Each page's icon (a name in site/icons.js), in the sidebar and next to its title. */
export const PAGE_ICONS = {
  index: 'book-open',
  installation: 'download',
  'quick-start': 'rocket',
  interface: 'panels-top-left',
  preferences: 'settings',
  'migrating-from-spine': 'arrow-right-left',
  'migrating-from-dragonbones': 'arrow-right-left',
  'importing-art': 'image',
  autorig: 'wand-sparkles',
  'bones-and-slots': 'bone',
  meshes: 'shapes',
  constraints: 'link',
  'skins-and-events': 'shirt',
  animating: 'play',
  'graph-editor': 'chart-spline',
  'onion-skin': 'layers',
  guides: 'ruler',
  'poses-and-faces': 'smile',
  retargeting: 'repeat-2',
  film: 'clapperboard',
  scenes: 'drama',
  'lip-sync': 'audio-lines',
  scripting: 'code',
  addons: 'puzzle',
  mcp: 'bot',
  'mcp-tools': 'wrench',
  export: 'package',
  runtimes: 'gamepad-2',
  'file-formats': 'file-code',
  shortcuts: 'keyboard',
  recovery: 'life-buoy',
  troubleshooting: 'bug',
  demos: 'sparkles',
  privacy: 'shield',
};
