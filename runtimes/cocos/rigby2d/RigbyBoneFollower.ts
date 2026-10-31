// SPDX-License-Identifier: MIT OR Apache-2.0
// Keeps a node on a bone of a RigbySkeleton: a sword in a hand, particles at a muzzle, a collider on
// a foot. Put the node under the RigbySkeleton's node (or set Skeleton), pick the bone by name, and
// choose whether it follows the bone's rotation and scale too.

import { _decorator, CCString, Component, Node } from 'cc';
import { RigbySkeleton } from './RigbySkeleton';

const { ccclass, property, executeInEditMode, menu } = _decorator;

@ccclass('RigbyBoneFollower')
@menu('Rigby2D/RigbyBoneFollower')
@executeInEditMode
export class RigbyBoneFollower extends Component {
  @property({ type: RigbySkeleton, tooltip: 'The skeleton (default: the RigbySkeleton on the parent node).' })
  skeleton: RigbySkeleton | null = null;

  @property({ type: CCString, tooltip: 'The bone to follow.' })
  bone = '';

  @property({ tooltip: "Turn with the bone's rotation." })
  followRotation = true;

  @property({ tooltip: "Grow and shrink with the bone's scale." })
  followScale = false;

  lateUpdate() {
    const sk = this.skeleton ?? this.node.parent?.getComponent(RigbySkeleton) ?? null;
    if (!sk || !this.bone) return;
    const t = sk.boneTransform(this.bone);
    if (!t) return;
    // In the skeleton node's space: the follower is its child, or is placed through world space.
    if (this.node.parent === sk.node) {
      this.node.setPosition(t.position.x, t.position.y, this.node.position.z);
    } else {
      const world = sk.node.worldMatrix;
      const x = world.m00 * t.position.x + world.m04 * t.position.y + world.m12;
      const y = world.m01 * t.position.x + world.m05 * t.position.y + world.m13;
      this.node.setWorldPosition(x, y, this.node.worldPosition.z);
    }
    if (this.followRotation) this.node.angle = t.rotation;
    if (this.followScale) this.node.setScale(t.scaleX, t.scaleY, this.node.scale.z);
  }
}

export type { Node };
