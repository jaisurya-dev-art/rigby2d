// SPDX-License-Identifier: MIT OR Apache-2.0
// TypeScript usage of the PixiJS runtime. This file is documentation for the API.
//
// In this repository: import { rigbyPixi, type RigbySkeleton } from './rigby-pixi.ts';

import * as PIXI from 'pixi.js';
import { rigbyPixi, type RigbySkeleton, type SkeletonEvent, type TrackEntry } from './rigby-pixi.ts';

const { loadRigby, RigbySkeleton: Skeleton } = rigbyPixi(PIXI);

const app = new PIXI.Application();
await app.init({ width: 960, height: 600 });

const data = await loadRigby('assets/hero.skel', 'assets/hero.atlas');
const hero: RigbySkeleton = new Skeleton(data, { animation: 'idle', ticker: app.ticker });
hero.position.set(400, 550);
hero.on('event', (_entry: TrackEntry, event: SkeletonEvent) => console.log(event.name, event.int));
app.stage.addChild(hero);

const entry = hero.play('run', true, 0.2);
if (entry) console.log(entry.name, entry.mix());
hero.queue('idle');

const sword = hero.attachToBone('hand_r', new PIXI.Sprite(PIXI.Texture.WHITE), { rotate: true });
const hand = hero.boneTransform('hand_r'); // BoneTransform | null
if (hand) console.log(hand.x, hand.y, hand.rotation);
sword.alpha = 0.5;
