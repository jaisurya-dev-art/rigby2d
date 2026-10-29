// SPDX-License-Identifier: MIT OR Apache-2.0
// Demo files for the desktop app: downloaded from the Rigby2D website when a demo is opened, so the
// app itself carries no character artwork (NILA and Rigbytron are proprietary Rigby2D demo characters,
// and the signed release must contain open-source code only). The website publishes them at
// demos/<id>.rigby and demos/<id>.png (site/vite.config.js).

export const REMOTE = true;

const BASE = 'https://rigby2d.com/demos/';
const of = (id) => ({ url: `${BASE}${id}.rigby`, thumbnail: `${BASE}${id}.png` });

export const SOURCES = { rigbytron: of('rigbytron'), nila: of('nila'), scene: of('scene') };
