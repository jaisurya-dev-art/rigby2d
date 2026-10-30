// SPDX-License-Identifier: MIT OR Apache-2.0
// Writes latest.json, the manifest the desktop app's auto-update reads
// (releases/latest/download/latest.json): the version, the release notes link, and for each
// platform the update file's address and signature. The app looks for `{os}-{arch}-{installer}`
// first, so an MSI install updates with the MSI and an NSIS install with the setup program (mixing
// them makes the installer ask to uninstall the other), then for `{os}-{arch}`.
// Usage: node .github/scripts/updater-manifest.mjs <folder with the release files> <version>

import fs from 'node:fs';
import path from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !version) throw new Error('usage: updater-manifest.mjs <dir> <version>');
const base = `https://github.com/jaisurya-dev-art/rigby2d/releases/download/v${version}`;

/** The update file and its .sig for a platform; null when the build had no signing key. */
function entry(file) {
  const sig = path.join(dir, `${file}.sig`);
  if (!fs.existsSync(path.join(dir, file)) || !fs.existsSync(sig)) return null;
  return { signature: fs.readFileSync(sig, 'utf8').trim(), url: `${base}/${file}` };
}

const nsis = entry(`Rigby2D_${version}_x64-setup.exe`);
const msi = entry(`Rigby2D_${version}_x64_en-US.msi`);
const mac = entry(`Rigby2D_${version}_universal.app.tar.gz`);
const linux = entry(`Rigby2D_${version}_amd64.AppImage`);
const platforms = {};
if (nsis) {
  platforms['windows-x86_64'] = nsis;
  platforms['windows-x86_64-nsis'] = nsis;
}
if (msi) platforms['windows-x86_64-msi'] = msi;
if (mac) {
  platforms['darwin-aarch64'] = mac;
  platforms['darwin-x86_64'] = mac;
}
if (linux) {
  platforms['linux-x86_64'] = linux;
  platforms['linux-x86_64-appimage'] = linux;
}
if (!Object.keys(platforms).length) {
  console.log('No signed update files: latest.json not written (set the TAURI_SIGNING_PRIVATE_KEY secret)');
  process.exit(0);
}

const manifest = {
  version,
  notes: `Rigby2D ${version}: see https://github.com/jaisurya-dev-art/rigby2d/releases/tag/v${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};
fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(manifest, null, 2));
console.log(`latest.json: ${Object.keys(platforms).join(', ')}`);
