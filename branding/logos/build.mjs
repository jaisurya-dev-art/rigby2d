// Builds the downloadable logo files (rigby2d.com/brand/) from the R mark and the lockup: an SVG
// and a PNG for every variant, into this folder. The wordmark is outlined from Inter (outline.py),
// so the SVGs look the same without the font installed.
// node branding/logos/build.mjs   (needs Python with fontTools and brotli, and Playwright)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const font = path.join(repo, 'promo/fonts/InterVariable.woff2');
const fontFile = fs.existsSync(font) ? font : process.env.RIGBY_INTER;
const word = JSON.parse(execFileSync('python', ['-I', path.join(here, 'outline.py'), fontFile], { encoding: 'utf8' }));

// The R: the bowl, the leg and the foot (the small triangle), in the mark's 96 x 96 space.
const BOWL = 'M9 5.5H60C73 5.5 85.5 12 85.5 28C85.5 45 76 57 62 58H45V46C45 41 43 37 39 35L18 33L12 31L9 30Z';
const LEG = 'M9 37L69.5 94H9Z';
const FOOT = 'M62 65V94H89Z';

/** The colours of each version: bowl, leg, foot, and the wordmark's "Rigby" and "2D". */
const COLOURS = {
  dark: { bowl: '#F4F4F5', leg: '#B5D3E7', foot: '#7BA7C7', rigby: '#F4F4F5', twoD: '#7BA7C7' },
  light: { bowl: '#141619', leg: '#3F6E91', foot: '#7BA7C7', rigby: '#141619', twoD: '#3F6E91' },
};

/** The R in colour. */
const colourR = (c) => `<path fill="${c.foot}" d="${FOOT}"/><path fill="${c.leg}" d="${LEG}"/><path fill="${c.bowl}" d="${BOWL}"/>`;

/** The R in one colour: drawn like the colour R (the leg overlaps the foot), with a thin gap cut
 *  into the foot along the leg's edge, so the overlap still reads without the colours. */
const monoR = (fill, id) =>
  `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="96" height="96"><rect width="96" height="96" fill="#fff"/><path d="${LEG}" fill="#000" stroke="#000" stroke-width="5" stroke-linejoin="miter"/></mask></defs>` +
  `<path fill="${fill}" d="${FOOT}" mask="url(#${id})"/><path fill="${fill}" d="${LEG}"/><path fill="${fill}" d="${BOWL}"/>`;

const svg = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}">${body}</svg>\n`;

const mark = (body, title) => svg(96, 96, title, body);
const lockup = (c, title) => svg(440, 164, title, `<g transform="translate(32 23)">${colourR(c)}</g><path fill="${c.rigby}" d="${word.Rigby}"/><path fill="${c.twoD}" d="${word['2D']}"/>`);

/** [file, svg, PNG size of the longer side]. */
const FILES = [
  ['rigby2d-r', mark(colourR(COLOURS.dark), 'Rigby2D R logo'), 1024],
  ['rigby2d-r-light', mark(colourR(COLOURS.light), 'Rigby2D R logo'), 1024],
  ['rigby2d-logo', lockup(COLOURS.dark, 'Rigby2D'), 2048],
  ['rigby2d-logo-light', lockup(COLOURS.light, 'Rigby2D'), 2048],
  ['rigby2d-r-white', mark(monoR('#FFFFFF', 'gap'), 'Rigby2D R logo, white'), 1024],
  ['rigby2d-r-black', mark(monoR('#000000', 'gap'), 'Rigby2D R logo, black'), 1024],
];

// Every file is cropped to the logo itself: the viewBox is the drawing's exact bounds (no padding),
// and the PNG is that box on a transparent background.
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, source, long] of FILES) {
  await page.setContent(`<html><body style="margin:0">${source}</body></html>`);
  const b = await page.evaluate(() => {
    const r = document.querySelector('svg').getBBox();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const r2 = (v) => Math.round(v * 100) / 100;
  const [x, y, w, h] = [r2(b.x), r2(b.y), r2(b.w), r2(b.h)];
  const k = long / Math.max(w, h);
  const [pw, ph] = [Math.round(w * k), Math.round(h * k)];
  const cropped = source.replace(/width="[\d.]+" height="[\d.]+" viewBox="[^"]+"/, `width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"`);
  fs.writeFileSync(path.join(here, `${name}.svg`), cropped);
  await page.setViewportSize({ width: pw, height: ph });
  await page.setContent(`<html><body style="margin:0;background:transparent">${cropped.replace(`width="${w}" height="${h}"`, `width="${pw}" height="${ph}"`)}</body></html>`);
  await page.screenshot({ path: path.join(here, `${name}.png`), omitBackground: true, clip: { x: 0, y: 0, width: pw, height: ph } });
  console.log(`${name}.svg (${w} x ${h}), ${name}.png (${pw} x ${ph})`);
}
await browser.close();
