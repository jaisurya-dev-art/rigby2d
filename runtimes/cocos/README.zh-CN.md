# Rigby2D for Cocos Creator（中文）

在 **Cocos Creator 3.8** 中用 Rigby2D 运行时播放 Rigby2D 骨骼动画，效果与编辑器中完全一致：网格与权重、IK、
变换 / 路径 / 物理 / 滑块约束、裁剪、双色着色、所有混合模式、皮肤、事件，以及支持交叉淡入的多轨道动画。

- **纯 2D 渲染器**：放在 Canvas 下即可，与精灵和 UI 按顺序绘制，跟随节点的颜色和透明度。
  不需要 3D 引擎模块，2D 项目开箱即用。
- **零配置**：把导出的 `.json` 和 `.atlas` 放进项目，Cocos 会把它们合成一个 *Skeleton Data* 资源，
  拖到组件上、选择动画即可。
- **骨骼跟随**：让任意节点（武器、粒子、碰撞体）跟随某根骨骼。
- **在 Cocos 编辑器中预览动画**。

已在 Cocos Creator 3.8.8 中测试：Web 构建，60 fps。

## 从 DragonBones 迁移

用 Rigby2D 打开你的 DragonBones 项目（`_ske.json` + `_tex.json` + `_tex.png`）：骨骼、网格、权重、IK、皮肤、
嵌套骨架（武器、特效）和所有动画都会一并导入，并已与官方 DragonBones 运行时逐帧对比验证。
然后导出，在 Cocos Creator 中用 RigbySkeleton 播放。详见
[从 DragonBones 迁移](https://rigby2d.com/docs/migrating-from-dragonbones.html)。

## 安装

1. 从 [Releases](https://github.com/jaisurya-dev-art/rigby2d/releases) 下载 `rigby2d-cocos-<版本>.zip`，
   或在 Rigby2D 中选择 *File ▸ Get runtimes…*，桌面版可以直接 *安装到项目*。
2. 解压到项目的 `assets/` 文件夹，得到 `assets/rigby2d/`。

## 使用

1. 在 Rigby2D 中导出角色：*File ▸ Export ▸ JSON + atlas…*（或二进制 `.skel`）。
2. 把 `.json`（或 `.skel`）、`.atlas` 和 `.png` 复制到项目的 `assets/` 中。
3. 在 Canvas 下新建节点，添加 **Rigby2D ▸ RigbySkeleton** 组件。
4. 把 **Skeleton Data** 设为 Cocos 由 `.json` 和 `.atlas` 生成的资源，再在 **Animation** 中填写要播放的动画。

也可以直接设置 **Skeleton Json**（或 **Skeleton Binary**）、**Atlas Text** 和 **Textures**。
把 `.skel` 命名为 `.skel.bin`，Cocos 会将其导入为二进制资源；把 `.atlas` 命名为 `.atlas.txt`，则导入为文本。

```ts
import { _decorator, Component } from 'cc';
import { RigbySkeleton, RigbyEvent } from './rigby2d/RigbySkeleton';

@_decorator.ccclass('Hero')
export class Hero extends Component {
  start() {
    const rigby = this.getComponent(RigbySkeleton)!;
    rigby.setAnimation(0, 'run', true, 0.2);   // 轨道 0，0.2 秒交叉淡入
    rigby.setAnimation(1, 'shoot', false);      // 叠加在上层
    rigby.addAnimation(0, 'idle', true, 0.3);   // 跑完之后排队播放
    rigby.setSkin('armored');
    this.node.on(RigbySkeleton.EVENT, (e: RigbyEvent) => console.log(e.name, e.time));
  }
}
```

- `setAnimation(track, name, loop, mix)`、`addAnimation(track, name, loop, mix, delay)`、`clearTrack(track)`
- `setSkin(name)`、`animationNames`、`skinNames`、`timeScale`
- `boneTransform(name)`：骨骼在节点空间中的位置、旋转和缩放
- 节点事件：`RigbySkeleton.EVENT`（`RigbyEvent`）、`START`、`END`、`COMPLETE`

**RigbyBoneFollower**：把它加到骨骼节点的子节点上，设置 **Bone**，该节点就会跟随这根骨骼。

## 说明

- 所有骨骼共用一个 `rigby2d.effect`，它的 uuid 是固定的（见 `rigby2d.effect.meta`），组件会自动找到它；
  复制文件夹时请保留 `.meta` 文件。
- 绘制顺序中，每种贴图与混合模式的组合是一次 draw call，与编辑器一致。

许可证：MIT 或 Apache-2.0，与其他 Rigby2D 运行时相同。社区：[r/rigby2d](https://www.reddit.com/r/rigby2d/)。
