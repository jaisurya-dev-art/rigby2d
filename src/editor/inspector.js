// SPDX-License-Identifier: MIT OR Apache-2.0
// Right panel: properties of the current selection.

import { identityTransform, transformEquals } from '../core/math.js';
import { BLEND_MODES, INHERIT_MODES, findAttachment, makeAttachment, makeBone, uniqueName, vertexCount } from '../core/model.js';
import { FPS, Mode, selBone, selSlot } from './app.js';
import * as edit from './edit.js';
import { renameBoneRefs, renameSlotRefs } from '../core/constraintdata.js';
import { sequenceFrameName } from '../core/sequence.js';
import { constraintUi } from './constraintui.js';
import { actorUi, depthUi } from './sceneui.js';
import { bindMesh, generateFromImage, regionToMesh, unbindMesh } from './meshtool.js';
import { MESH_DEFAULTS } from '../core/meshgen.js';
import { eventUi, skinUi } from './skineventui.js';
import { dragValue, h, select, textField } from './widgets.js';
import { FPS_PRESETS, SIZE_PRESETS, formatFps, hexToRgba, rgbaToHex } from './output.js';
import { posesUi } from './poseui.js';
import { has } from './workspaces.js';
import { sounds } from './audio.js';
import { renameOnionBone } from './onion.js';
import { openLipSync } from './lipsyncui.js';
import { t, tn } from './i18n.js';

export function render(app, el) {
  const b = selBone(app.sel);
  const s = selSlot(app.sel);
  const k = app.sel?.constraint;
  const content =
    k !== undefined
      ? constraintUi(app, k)
      : app.sel?.skin !== undefined
        ? skinUi(app, app.sel.skin)
        : app.sel?.event !== undefined
          ? eventUi(app, app.sel.event)
          : b !== null
            ? boneUi(app, b)
            : s !== null
              ? slotUi(app, s)
              : projectUi(app);
  // The mesh being edited stays on top while bones are selected for binding or painting.
  const mesh = meshUi(app);
  el.replaceChildren(...[mesh, content, posesUi(app)].flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
}

const row = (label, ...content) => [h('label', null, label), h('div', { class: 'cell' }, ...content)];

/** Display names of the bone inherit and slot blend modes (the values stay the format's names). */
const MODE_LABELS = {
  normal: tn('Normal'),
  onlyTranslation: tn('Only translation'),
  noRotationOrReflection: tn('No rotation or reflection'),
  noScale: tn('No scale'),
  noScaleOrReflection: tn('No scale or reflection'),
  additive: tn('Additive'),
  multiply: tn('Multiply'),
  screen: tn('Screen'),
};

const KEY_STATE_TITLES = {
  none: tn('Not keyed at this frame. Click to key.'),
  changed: tn('Changed but not keyed. Click to key (or press K).'),
  keyed: tn('Keyed at this frame. Click to key again.'),
};

/** Key button: green = no key, orange = unkeyed change, red = keyed at this frame. */
function keyMarker(app, bone, channel) {
  if (app.mode !== Mode.Animate) return null;
  const state = edit.channelState(app, bone, channel);
  return h(
    'button',
    {
      class: `keybtn ${state}`,
      title: t(KEY_STATE_TITLES[state]),
      onclick: () => edit.keyChannels(app, app.selectedBones().length ? app.selectedBones() : [bone], [channel]),
    },
    '◆',
  );
}

function boneUi(app, b) {
  const setupMode = app.mode === Mode.Setup;
  const bone = app.doc.bones[b];
  const props = [
    ...row(
      t('Name'),
      textField(bone.name, (name) => {
        if (name && app.doc.boneIndex(name) === null) {
          renameBoneRefs(app.doc, bone.name, name);
          renameOnionBone(app.onion, bone.name, name); // per-bone onion settings are keyed by name
          bone.name = name;
          app.changed();
        }
      }, { disabled: !setupMode }),
    ),
  ];
  if (b === 0) {
    props.push(...row(t('Parent'), t('(none)')));
  } else {
    const options = app.doc.bones.map((x, i) => [i, x.name]).filter(([i]) => !app.doc.isDescendant(i, b));
    props.push(
      ...row(
        t('Parent'),
        select(options, bone.parent ?? 0, (i) => {
          if (i !== bone.parent) edit.reparentBoneKeepWorld(app, b, i);
        }, { disabled: !setupMode }),
      ),
    );
  }
  props.push(
    ...row(
      t('Length'),
      dragValue(bone.length, (v) => {
        bone.length = v;
        app.changed();
      }, { speed: 0.5, min: 0, disabled: !setupMode }),
    ),
    ...row(
      t('Inherit'),
      select(INHERIT_MODES.map((m) => [m, t(MODE_LABELS[m] ?? m)]), bone.inherit ?? 'normal', (m) => {
        bone.inherit = m;
        app.changed();
      }, { disabled: !setupMode }),
    ),
  );

  const local = app.pose().local[b];
  const field = (key, opts) =>
    dragValue(local[key], (v) => {
      const local = { ...app.pose().local[b], [key]: v };
      if (!transformEquals(local, app.pose().local[b])) edit.setBoneLocal(app, b, local);
    }, opts);
  const pos = { speed: 0.5, decimals: 2 };
  const scl = { speed: 0.01, decimals: 3 };

  return [
    actorUi(app, b),
    h('h2', null, app.selectedBones().length > 1 ? t('Bone ({count} selected)', { count: app.selectedBones().length }) : t('Bone')),
    h('div', { class: 'grid' }, props),
    depthUi(app, b),
    h('hr'),
    h('strong', null, setupMode ? t('Setup pose') : app.autoKey ? t('Pose at current frame (auto key on)') : t('Pose at current frame')),
    h(
      'div',
      { class: 'grid three' },
      h('label', null, t('Rotation')),
      h('div', { class: 'cell' }, field('rotation', { ...pos, suffix: '°' })),
      keyMarker(app, b, 'rotate') ?? h('span'),
      h('label', null, t('Position')),
      h('div', { class: 'cell' }, field('x', { ...pos, prefix: 'x ' }), field('y', { ...pos, prefix: 'y ' })),
      keyMarker(app, b, 'translate') ?? h('span'),
      h('label', null, t('Scale')),
      h('div', { class: 'cell' }, field('scale_x', { ...scl, prefix: 'x ' }), field('scale_y', { ...scl, prefix: 'y ' })),
      keyMarker(app, b, 'scale') ?? h('span'),
      h('label', null, t('Shear')),
      h('div', { class: 'cell' }, field('shear_x', { ...pos, prefix: 'x ', suffix: '°' }), field('shear_y', { ...pos, prefix: 'y ', suffix: '°' })),
      keyMarker(app, b, 'shear') ?? h('span'),
    ),
    h(
      'div',
      { class: 'buttons' },
      !setupMode ? h('button', { onclick: () => edit.keySelection(app) }, t('◆ Key all (K)')) : null,
      setupMode ? h('button', { onclick: () => edit.addChildBone(app, b) }, t('＋ Child bone')) : null,
      setupMode && b !== 0 ? h('button', { onclick: () => edit.deleteSelection(app) }, t('🗑 Delete')) : null,
    ),
  ];
}

const toHex = (c) => `#${c.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

function slotUi(app, s) {
  const setupMode = app.mode === Mode.Setup;
  const slot = app.doc.slots[s];
  const color = h('input', {
    type: 'color',
    value: toHex(slot.color),
    disabled: !setupMode,
    oninput: (e) => {
      slot.color.splice(0, 3, ...fromHex(e.target.value));
      app.changed();
    },
    onchange: (e) => e.target.blur(),
  });
  const alpha = dragValue(slot.color[3], (v) => {
    slot.color[3] = v;
    app.changed();
  }, { speed: 0.005, min: 0, max: 1, decimals: 2, prefix: 'a ', disabled: !setupMode });

  const out = [
    h('h2', null, t('Slot')),
    h(
      'div',
      { class: 'grid' },
      row(
        t('Name'),
        textField(slot.name, (name) => {
          if (name && app.doc.slotIndex(name) === null) {
            renameSlotRefs(app.doc, slot.name, name);
            slot.name = name;
            app.changed();
          }
        }, { disabled: !setupMode }),
      ),
      row(
        t('Bone'),
        select(app.doc.bones.map((x, i) => [i, x.name]), slot.bone, (i) => {
          if (i !== slot.bone) edit.setSlotBoneKeepWorld(app, s, i);
        }, { disabled: !setupMode, tut: 'slot-bone' }),
      ),
      row(t('Tint'), color, alpha),
      row(
        t('Blend'),
        select(BLEND_MODES.map((m) => [m, t(MODE_LABELS[m] ?? m)]), slot.blend ?? 'normal', (m) => {
          slot.blend = m;
          app.changed();
        }, { disabled: !setupMode }),
      ),
    ),
    h('hr'),
    h('strong', null, t('Attachments')),
    h('div', { class: 'small weak' }, t('Pick which image is visible. In animate mode this sets a key.')),
  ];

  const visible = app.pose().attachment[s];
  const radio = (value, label) =>
    h(
      'label',
      { class: 'radio' },
      h('input', {
        type: 'radio',
        name: `att-${s}`,
        checked: visible === value,
        onchange: () => edit.setSlotAttachment(app, s, value),
      }),
      ` ${label}`,
    );
  const skinAtts = app.doc.skin ? app.doc.skinAttachments(s, app.doc.skin) : [];
  const names = [...new Set([...skinAtts, ...slot.attachments].map((a) => a.name))];
  out.push(radio(null, t('(none)')), ...names.map((n) => radio(n, skinAtts.some((a) => a.name === n) ? `${n}  [${app.doc.skin}]` : n)));
  if (setupMode && app.doc.images.length) {
    out.push(
      select(app.doc.images.map((i) => [i.name, i.name]), undefined, (name) => {
        const img = app.doc.images.find((i) => i.name === name);
        addToSlot(app, s, (attName) => makeAttachment(attName, name, identityTransform(), img.width, img.height), name);
      }, { placeholder: app.doc.skin ? t("＋ Add image to skin '{skin}'…", { skin: app.doc.skin }) : t('＋ Add image to this slot…') }),
    );
  }
  if (setupMode) {
    out.push(
      select([['boundingbox', t('Bounding box')], ['clipping', t('Clipping')], ['point', t('Point')], ['path', t('Path')]], undefined, (type) => {
        addToSlot(app, s, (attName) => makeShape(app, s, type, attName), type);
      }, { placeholder: t('＋ Add shape…') }),
    );
  }

  const att = visible === null ? undefined : app.doc.attachment(s, visible);
  if (att && !att.offset) {
    const source = app.doc.meshSource(s, att);
    out.push(
      h('hr'),
      h('strong', null, `${att.type}: ${visible}`),
      h(
        'div',
        { class: 'grid' },
        att.type === 'mesh' || att.type === 'linkedmesh'
          ? row(t('Image'), select(app.doc.images.map((i) => [i.name, i.name]), att.image, (name) => ((att.image = name), app.changed()), { disabled: !setupMode }))
          : null,
        source ? row(t('Vertices'), source.weights ? t('{count} (weighted)', { count: vertexCount(source) }) : String(vertexCount(source))) : null,
        source?.triangles ? row(t('Triangles'), String(source.triangles.length / 3)) : null,
        att.type === 'linkedmesh' ? row(t('Parent'), `${att.parent}${att.skin ? ` (${att.skin})` : ''}`) : null,
        att.type === 'linkedmesh'
          ? row('', h('label', { class: 'check', title: t('Use the deform keys of the parent mesh') }, h('input', { type: 'checkbox', disabled: !setupMode, checked: att.deform !== false, onchange: (e) => ((att.deform = e.target.checked), app.changed()) }), ' ' + t('Inherit deform')))
          : null,
      ),
      att.type === 'mesh' && setupMode && app.doc.images.length
        ? select(app.doc.images.map((i) => [i.name, i.name]), undefined, (image) => {
            const img = app.doc.images.find((i) => i.name === image);
            addToSlot(app, s, (name) => ({ name, type: 'linkedmesh', image, parent: att.name, skin: null, deform: true, width: img?.width ?? att.width, height: img?.height ?? att.height }), image); // named after its image, like exported linked meshes
            app.setStatus(t("Linked mesh added: it shares this mesh's shape and weights with another image"));
          }, { placeholder: t('＋ Linked mesh with image…') })
        : null,
      att.type === 'mesh' || att.type === 'linkedmesh' ? sequenceUi(app, s, att, setupMode) : null,
      att.type === 'clipping'
        ? h(
            'div',
            { class: 'grid' },
            row(
              t('Clip until'),
              select([['', '(end of draw order)'], ...app.doc.slots.map((sl, i) => [String(i), sl.name])], att.end === null || att.end === undefined || att.end === s ? '' : String(att.end), (v) => {
                att.end = v === '' ? null : Number(v);
                app.changed();
              }, { disabled: !setupMode }),
            ),
          )
        : null,
      att.type === 'path'
        ? h(
            'div',
            { class: 'grid' },
            row('', h('label', { class: 'check' }, h('input', { type: 'checkbox', disabled: !setupMode, checked: !!att.closed, onchange: (e) => ((att.closed = e.target.checked), app.changed()) }), ' Closed')),
            row('', h('label', { class: 'check' }, h('input', { type: 'checkbox', disabled: !setupMode, checked: att.constantSpeed !== false, onchange: (e) => ((att.constantSpeed = e.target.checked), app.changed()) }), ' ' + t('Constant speed'))),
          )
        : null,
      setupMode && ['boundingbox', 'clipping', 'path'].includes(att.type)
        ? h(
            'div',
            { class: 'buttons' },
            app.shapeEdit?.slot === s && app.shapeEdit?.name === visible
              ? h('button', { class: 'active', onclick: () => ((app.shapeEdit = null), app.changed()) }, t('✓ Done editing'))
              : h('button', { onclick: () => ((app.shapeEdit = { slot: s, name: visible, selected: null }), (app.meshEdit = null), app.changed()) }, t('✎ Edit shape')),
            h(
              'span',
              { class: 'small weak' },
              att.type === 'path' ? ' ' + t('Drag points or handles (Alt: unlinked), click to add, Delete removes.') : ' ' + t('Drag vertices, click to add on the nearest edge, Delete removes.'),
            ),
          )
        : null,
      setupMode ? h('div', { class: 'buttons' }, h('button', { onclick: () => removeAttachment(app, s, att) }, t('🗑 Remove {type}', { type: att.type }))) : null,
      att.type === 'mesh' && !(app.meshEdit?.slot === s && app.meshEdit?.name === visible)
        ? h('div', { class: 'buttons' }, h('button', { onclick: () => startMeshEdit(app, s, visible) }, setupMode ? t('✎ Edit mesh') : t('✎ Deform mesh')))
        : att.type === 'linkedmesh'
          ? h('div', { class: 'small weak' }, t('Linked meshes share their parent mesh; edit the parent.'))
          : null,
    );
  }
  if (att && att.offset) {
    const num = (obj, key, opts) =>
      dragValue(obj[key], (v) => {
        obj[key] = v;
        app.changed();
      }, opts);
    const pos = { speed: 0.5, decimals: 2 };
    const scl = { speed: 0.01, decimals: 3 };
    out.push(
      h('hr'),
      h('strong', null, t('Image placement: {image}', { image: visible })),
      h(
        'div',
        { class: 'grid' },
        row(
          t('Image'),
          select(app.doc.images.map((i) => [i.name, i.name]), att.image, (name) => {
            att.image = name;
            app.changed();
          }),
        ),
        row(t('Position'), num(att.offset, 'x', { ...pos, prefix: 'x ' }), num(att.offset, 'y', { ...pos, prefix: 'y ' })),
        row(t('Rotation'), num(att.offset, 'rotation', { ...pos, suffix: '°' })),
        row(t('Scale'), num(att.offset, 'scale_x', { ...scl, prefix: 'x ' }), num(att.offset, 'scale_y', { ...scl, prefix: 'y ' })),
        row(t('Size'), num(att, 'width', { ...pos, prefix: 'w ', min: 0 }), num(att, 'height', { ...pos, prefix: 'h ', min: 0 })),
      ),
      sequenceUi(app, s, att, setupMode),
      h(
        'div',
        { class: 'buttons' },
        h(
          'button',
          {
            onclick: () => {
              const img = app.doc.images.find((i) => i.name === att.image);
              if (img) {
                att.width = img.width;
                att.height = img.height;
                app.changed();
              }
            },
          },
          t('Reset size'),
        ),
        setupMode
          ? h(
              'button',
              {
                title: t('Replace this image with a mesh you can reshape and bind to bones'),
                onclick: () => {
                  regionToMesh(app.doc, s, att);
                  startMeshEdit(app, s, att.name);
                },
              },
              t('▦ Convert to mesh'),
            )
          : null,
        setupMode
          ? h(
              'button',
              {
                onclick: () => removeAttachment(app, s, att),
              },
              t('🗑 Remove image'),
            )
          : null,
      ),
    );
  }
  if (setupMode) out.push(h('div', { class: 'buttons' }, h('button', { onclick: () => edit.deleteSelection(app) }, t('🗑 Delete slot'))));
  return out;
}

function projectUi(app) {
  return [
    h('h2', null, t('Project')),
    h(
      'div',
      { class: 'grid' },
      row(
        t('Name'),
        textField(app.doc.name, (v) => {
          app.doc.name = v;
          app.changed();
        }),
      ),
      row(t('Textures'), textureFilterSelect(app)),
      row(t('Pixel grid'), pixelGridSelect(app)),
    ),
    app.doc.skins.length
      ? h(
          'div',
          { class: 'grid' },
          row(
            t('Skin'),
            select([['', 'default'], ...app.doc.skins.map((k) => [k.name, k.name])], app.doc.skin ?? '', (name) => {
              app.doc.skin = name || null;
              app.changed();
            }),
          ),
        )
      : null,
    app.doc.header
      ? h('div', { class: 'small weak' }, t('Imported from skeleton JSON {version}. Export again with File ▸ Export ▸ JSON + atlas.', { version: app.doc.header.version ?? '' }))
      : null,
    h('hr'),
    has(app, 'output') ? outputUi(app) : null,
    has(app, 'audio') ? audioUi(app) : null,
    h('hr'),
    h('strong', null, t('Rig')),
    h('div', null, t('{bones} bones · {slots} slots · {skins} skins', { bones: app.doc.bones.length, slots: app.doc.slots.length, skins: app.doc.skins.length + 1 })),
    h('div', null, t('{ik} IK constraints · {events} events · {animations} animations', { ik: app.doc.ik.length, events: app.doc.events.length, animations: app.doc.animations.length })),
    h('hr'),
    h('strong', null, t('Images ({count})', { count: app.doc.images.length })),
    app.doc.images.length ? null : h('p', null, t('Use File ▸ Import ▸ PSD, SVG or PNG images to add art.')),
    app.doc.images.map((img) => h('div', null, `${img.name}  (${img.width}×${img.height})`)),
    h('hr'),
    h('strong', null, t('Getting started')),
    h(
      'ol',
      null,
      h('li', null, t("Import your character's art (PSD or SVG layers, or PNG parts).")),
      h('li', null, t('Pick the Create tool and drag in the canvas to draw bones (select a bone first to chain children).')),
      h('li', null, t('Select an image and set its Bone in the inspector.')),
      h('li', null, t('Press Tab for Animate mode, move the time cursor, pose bones and set keys with the key buttons (or turn on Auto key).')),
      h('li', null, t('File ▸ Save writes the .rigby work file; File ▸ Export writes skeleton JSON or .skel + a packed atlas for runtimes.')),
    ),
  ];
}

/** How images are sampled when scaled: smooth, or sharp for pixel art. Also written to exported atlases. */
function textureFilterSelect(app) {
  const el = select(
    [
      ['linear', t('Smooth (linear)')],
      ['nearest', t('Pixel art (nearest)')],
    ],
    app.doc.textureFilter,
    (v) => {
      app.doc.textureFilter = v;
      app.changed();
    },
  );
  el.title = t('How images are drawn when scaled. Pixel art keeps every pixel sharp in the viewport, in renders and in exported atlases (filter: Nearest).');
  return el;
}

/**
 * Pixel grid for pixel art: the viewport and renders draw the skeleton at the art's pixel size and
 * scale it up sharp, so rotated parts stay on the pixel grid. The value is world units per pixel.
 */
function pixelGridSelect(app) {
  const el = select(
    [
      ['0', t('Off')],
      ['1', t('On: 1 unit per pixel')],
      ['2', t('On: 2 units per pixel')],
      ['3', t('On: 3 units per pixel')],
      ['4', t('On: 4 units per pixel')],
    ],
    String(app.doc.pixelGrid || 0),
    (v) => {
      app.doc.pixelGrid = Number(v);
      if (app.doc.pixelGrid > 0) app.doc.textureFilter = 'nearest';
      app.changed();
    },
  );
  el.title = t("Draws the skeleton at the art's own pixel size and scales it up sharp, so rotated and bent parts stay on the pixel grid, as in a pixel-art game. Applies to the viewport and renders; zoom in to see each pixel's outline. Use 2 to 4 units per pixel for art imported at 2x to 4x.");
  return el;
}

/** Film: audio tracks of the current animation (offset and volume). */
function audioUi(app) {
  const anim = app.currentAnimation();
  const tracks = anim ? app.doc.audio.filter((tr) => tr.animation === anim.name) : [];
  return [
    h('hr'),
    h('strong', null, `${t('Audio')}${anim ? ` · ${anim.name}` : ''}`),
    tracks.map((tr) =>
      h(
        'div',
        { class: 'grid' },
        row(sounds.get(tr.sound) ? tr.sound : t('{sound} (missing)', { sound: tr.sound }), h('button', { class: 'small', title: t('Remove this track'), onclick: () => ((app.doc.audio = app.doc.audio.filter((x) => x !== tr)), app.changed()) }, '✕')),
        row(t('Starts at'), dragValue(tr.offset, (v) => ((tr.offset = v), app.changed()), { speed: 0.01, decimals: 3, suffix: ' s' })),
        row(t('Volume'), dragValue(tr.volume * 100, (v) => ((tr.volume = Math.max(0, v) / 100), app.changed()), { speed: 1, min: 0, max: 400, decimals: 0, suffix: ' %' })),
      ),
    ),
    h(
      'div',
      { class: 'buttons' },
      h('button', { disabled: !anim, onclick: () => app.importAudio() }, t('Import audio…')),
      h('button', { disabled: !tracks.length, 'data-tut': 'lipsync', title: t('Key mouth shapes (visemes) from the speech in a track'), onclick: () => openLipSync(app) }, t('Lip-sync…')),
    ),
    h('div', { class: 'small weak' }, t('Tracks play with the timeline. Lip-sync keys a mouth slot shape by shape from the speech; face controls can also follow loudness.')),
  ];
}

/** Output settings: frame rate, frame size, background and framing for rendering. */
function outputUi(app) {
  const s = app.doc.settings;
  const set = (change) => {
    Object.assign(s, change);
    app.changed();
  };
  const fpsValue = FPS_PRESETS.includes(s.fps) ? s.fps : 'custom';
  const sizeValue = SIZE_PRESETS.find(([w, hgt]) => w === s.width && hgt === s.height) ? `${s.width}x${s.height}` : 'custom';
  return h(
    'div',
    null,
    h('strong', null, t('Output')),
    h(
      'div',
      { class: 'grid' },
      row(
        t('Frame rate'),
        select([...FPS_PRESETS.map((f) => [f, `${formatFps(f)} fps`]), ['custom', t('Custom')]], fpsValue, (v) => v !== 'custom' && set({ fps: v })),
        dragValue(s.fps, (v) => set({ fps: v }), { speed: 0.1, min: 1, max: 240, decimals: 3, suffix: ' fps' }),
      ),
      row(
        t('Size'),
        select([...SIZE_PRESETS.map(([w, hgt, label]) => [`${w}x${hgt}`, `${w}×${hgt} ${t(label)}`]), ['custom', t('Custom')]], sizeValue, (v) => {
          if (v === 'custom') return;
          const [w, hgt] = v.split('x').map(Number);
          set({ width: w, height: hgt });
        }),
      ),
      row(
        '',
        dragValue(s.width, (v) => set({ width: Math.round(v) }), { speed: 1, min: 16, max: 16384, decimals: 0, suffix: ' px' }),
        dragValue(s.height, (v) => set({ height: Math.round(v) }), { speed: 1, min: 16, max: 16384, decimals: 0, suffix: ' px' }),
      ),
      row(
        t('Background'),
        h('label', null, h('input', { type: 'checkbox', checked: !s.background, onchange: (e) => set({ background: e.target.checked ? null : [0, 0, 0, 1] }) }), ' Transparent'),
        s.background ? h('input', { type: 'color', value: rgbaToHex(s.background), oninput: (e) => set({ background: hexToRgba(e.target.value) }) }) : null,
      ),
      row(
        t('Framing'),
        select(
          [
            ['auto', t('Fit the animation')],
            ['fixed', t('Fixed')],
            ['camera', "Follow the 'camera' bone"],
          ],
          s.frame?.camera ? 'camera' : s.frame ? 'fixed' : 'auto',
          (v) => {
            if (v === 'auto') set({ frame: null });
            else if (v === 'camera') {
              // A root-level bone named camera; its rest position is the current frame center.
              const f = app.viewport?.outputFrame() ?? { cx: 0, cy: 0, scale: 1 };
              if (!app.doc.bones.some((b) => b.name === 'camera')) app.doc.bones.push(makeBone('camera', 0, { ...identityTransform(), x: f.cx, y: f.cy }, 100));
              set({ frame: { x: f.cx, y: f.cy, scale: f.scale, camera: true } });
            }
            else {
              const f = app.viewport?.outputFrame();
              set({ frame: f ? { x: f.cx, y: f.cy, scale: f.scale } : { x: 0, y: 0, scale: 1 } });
            }
            app.showFrame = true;
          },
        ),
      ),
      s.frame
        ? [
            row(
              t('Center'),
              dragValue(s.frame.x, (v) => set({ frame: { ...s.frame, x: v } }), { speed: 1, decimals: 1 }),
              dragValue(s.frame.y, (v) => set({ frame: { ...s.frame, y: v } }), { speed: 1, decimals: 1 }),
            ),
            row(t('Units / pixel'), dragValue(s.frame.scale, (v) => set({ frame: { ...s.frame, scale: v } }), { speed: 0.005, min: 0.001, max: 1000, decimals: 3 })),
            row(
              '',
              h(
                'button',
                {
                  title: t('Frame what the viewport shows'),
                  onclick: () => {
                    if (app.viewport) set({ frame: app.viewport.frameFromView() });
                    app.showFrame = true;
                  },
                },
                t('Use the current view'),
              ),
            ),
          ]
        : null,
    ),
    h('div', { class: 'small weak' }, t('Used when rendering image sequences and video. View ▸ Show output frame shows the framed area.')),
  );
}

/** Remembered between meshes, so a whole character can be meshed with the same settings. */
const generateOptions = { ...MESH_DEFAULTS };

/** "Generate from image": a mesh traced from the image's alpha, regenerated live as the settings change. */
function generateUi(app, e, att) {
  const o = generateOptions;
  const run = () => {
    const r = generateFromImage(app, e.slot, att, o);
    if (!r) app.setStatus(t('Generate mesh: the image has no pixels above the alpha threshold'));
    else app.setStatus(t('Generated {vertices} vertices ({hull} on the outline), {triangles} triangles', { vertices: r.points.length, hull: r.hull, triangles: r.triangles.length / 3 }) + (r.islands > 1 ? '; ' + t('used the largest of {count} separate shapes', { count: r.islands }) : '') + (r.removed ? '; ' + t('removed {count} deform timeline(s)', { count: r.removed }) : ''));
    app.changed();
  };
  // After the first generate, changing a setting regenerates (live preview); before it, nothing changes.
  const live = (key, transform = (v) => v) => (v) => {
    o[key] = transform(v);
    if (e.generated) run();
  };
  return [
    h('div', { class: 'section-title' }, t('Generate from image')),
    h(
      'div',
      { class: 'grid' },
      row(t('Outline points'), dragValue(o.points, live('points', Math.round), { min: 3, max: 400, decimals: 0, speed: 0.25 })),
      row(t('Alpha threshold'), dragValue(o.threshold, live('threshold', Math.round), { min: 1, max: 254, decimals: 0 })),
      row(t('Expand'), dragValue(o.expand, live('expand', Math.round), { min: -30, max: 30, decimals: 0, speed: 0.2, suffix: ' px' })),
      row(t('Smoothing'), dragValue(o.smoothing, live('smoothing', Math.round), { min: 0, max: 6, decimals: 0, speed: 0.1 })),
      row(t('Interior'), select([['none', t('None')], ['low', t('Low')], ['medium', t('Medium')], ['high', t('High')]], o.interior, live('interior'))),
    ),
    h(
      'div',
      { class: 'buttons' },
      h('button', { title: t('Trace the image outline, simplify it to the number of points, fill the inside and triangulate. Replaces this mesh; weights are kept.'), onclick: () => ((e.generated = true), run()) }, t('✦ Generate mesh')),
      h('button', { title: t('Back to the default settings'), onclick: () => (Object.assign(o, MESH_DEFAULTS), app.changed()) }, t('Reset')),
    ),
  ];
}

function startMeshEdit(app, slot, name) {
  app.meshEdit = { slot, name, mode: 'vertices', radius: 40, strength: 0.5, subtract: false, selected: null };
  app.changed();
}

/** Mesh editing controls, shown while a mesh is being edited. */
function meshUi(app) {
  const e = app.meshEdit;
  if (!e) return null;
  const att = app.doc.attachment(e.slot, e.name);
  if (!att || att.type !== 'mesh') return null;
  if (app.mode === Mode.Animate) {
    return [
      h('h2', null, t('Deform mesh: {name}', { name: e.name })),
      h('div', { class: 'small weak' }, t('Drag vertices to key their positions at the current frame; drag a box (or Ctrl+click) to select several and move them together. Keys appear in the dopesheet as the deform row.')),
      h('div', { class: 'buttons' }, h('button', { onclick: () => { app.meshEdit = null; app.changed(); } }, t('✓ Done'))),
      h('hr'),
    ];
  }
  const doc = app.doc;
  const set = (key, value) => {
    e[key] = value;
    app.changed();
  };
  const mode = (id, label) => h('button', { class: e.mode === id ? 'active' : '', onclick: () => set('mode', id) }, label);
  const bound = att.weights ? [...new Set(att.weights.flatMap((v) => v.map((w) => w.bone)))].sort((x, y) => x - y) : [];
  const selectedBones = app.selectedBones();
  const out = [
    h('h2', null, t('Mesh: {name}', { name: e.name })),
    h('div', { class: 'grid' }, row(t('Slot'), doc.slots[e.slot].name), row(t('Vertices'), att.weights ? t('{count} (outline {outline}), weighted', { count: att.uvs.length / 2, outline: att.hull }) : t('{count} (outline {outline})', { count: att.uvs.length / 2, outline: att.hull }))),
    h('div', { class: 'buttons' }, h('span', { class: 'segmented' }, mode('vertices', t('Vertices')), mode('weights', t('Weights'))), h('button', { onclick: () => { app.meshEdit = null; app.changed(); } }, t('✓ Done'))),
  ];
  if (e.mode === 'vertices') {
    out.push(h('div', { class: 'small weak' }, t('Click inside to add a vertex, near or outside the outline to extend it. Drag vertices to move them over the image. Ctrl+click or Ctrl+drag a box to select several; Delete removes the selection.')));
    out.push(...generateUi(app, e, att));
  } else {
    const bindLabel = selectedBones.length ? selectedBones.length === 1 ? t('Bind to 1 selected bone') : t('Bind to {count} selected bones', { count: selectedBones.length }) : t('Select bones to bind (Ctrl+click in the tree)');
    out.push(
      h(
        'div',
        { class: 'buttons' },
        h(
          'button',
          {
            disabled: !selectedBones.length,
            title: t('Weights each vertex to the nearest of the selected bones'),
            onclick: () => {
              const removed = bindMesh(doc, e.slot, att, selectedBones);
              e.bone = selectedBones[0];
              app.setStatus(`${selectedBones.length === 1 ? t('Bound to 1 bone') : t('Bound to {count} bones', { count: selectedBones.length })}${removed ? `; ${t('removed {count} deform timeline(s)', { count: removed })}` : ''}`);
              app.changed();
            },
          },
          bindLabel,
        ),
        att.weights
          ? h(
              'button',
              {
                onclick: () => {
                  unbindMesh(doc, e.slot, att);
                  app.changed();
                },
              },
              t('Unbind'),
            )
          : null,
      ),
    );
    if (att.weights) {
      const choices = doc.bones.map((bone, i) => [i, `${bound.includes(i) ? '● ' : ''}${bone.name}`]);
      out.push(
        h(
          'div',
          { class: 'grid' },
          row(t('Paint bone'), select(choices, e.bone ?? bound[0], (v) => set('bone', Number(v)))),
          row(t('Brush'), dragValue(e.radius ?? 40, (v) => set('radius', v), { speed: 0.5, min: 2, max: 400, suffix: ' px', decimals: 0 })),
          row(t('Strength'), dragValue(e.strength ?? 0.5, (v) => set('strength', v), { speed: 0.01, min: 0.01, max: 1, decimals: 2 })),
          row(
            t('Mode'),
            h('span', { class: 'segmented' },
              h('button', { class: e.subtract ? '' : 'active', onclick: () => set('subtract', false) }, t('Add')),
              h('button', { class: e.subtract ? 'active' : '', onclick: () => set('subtract', true) }, t('Subtract')),
            ),
          ),
        ),
        h('div', { class: 'small weak' }, t('Drag over the mesh to paint (Shift subtracts). Colors show the paint bone: red = full weight, blue = none. ● marks bones the mesh uses.')),
      );
    }
  }
  out.push(h('hr'));
  return out;
}

/** Adds an attachment to a slot: to the active skin when one is active, else the default skin. */
function addToSlot(app, s, make, base) {
  const doc = app.doc;
  const slot = doc.slots[s];
  const skin = doc.skin ? doc.findSkin(doc.skin) : null;
  let list = slot.attachments;
  if (skin) {
    let entry = skin.slots.find((e) => e.slot === s);
    if (!entry) skin.slots.push((entry = { slot: s, attachments: [] }));
    list = entry.attachments;
  }
  const name = uniqueName(base, (n) => list.some((a) => a.name === n) || !!findAttachment(slot, n));
  list.push(make(name));
  if (!slot.attachment) slot.attachment = name;
  app.changed();
}

/** Removes an attachment from whichever skin holds it. */
function removeAttachment(app, s, att) {
  const doc = app.doc;
  const slot = doc.slots[s];
  const lists = [slot.attachments, ...doc.skins.flatMap((k) => k.slots.filter((e) => e.slot === s).map((e) => e.attachments))];
  for (const list of lists) {
    const i = list.indexOf(att);
    if (i >= 0) list.splice(i, 1);
  }
  if (slot.attachment === att.name && !doc.attachment(s, att.name)) slot.attachment = slot.attachments[0]?.name ?? null;
  if (app.meshEdit?.slot === s && app.meshEdit?.name === att.name) app.meshEdit = null;
  app.changed();
}

/** A new shape attachment around the slot's bone, sized to stay visible at the current zoom. */
function makeShape(app, s, type, name) {
  const size = 50 / Math.max(0.05, app.view.zoom);
  if (type === 'point') return { name, type: 'point', offset: identityTransform() };
  if (type === 'path') {
    const pts = [[0, 0], [size * 2, 0]];
    const vertices = [];
    pts.forEach((p, i) => {
      const d = (i === 0 ? 1 : -1) * size * 0.66;
      vertices.push(p[0] - d, p[1], p[0], p[1], p[0] + d, p[1]);
    });
    return { name, type: 'path', image: name, vertexCount: 6, vertices, closed: false, constantSpeed: true, lengths: [size * 2, size * 4] };
  }
  const square = [-size, size, size, size, size, -size, -size, -size];
  const att = { name, type, image: name, vertexCount: 4, vertices: square };
  if (type === 'clipping') att.end = null;
  return att;
}

const SEQUENCE_MODES = [
  ['hold', tn('Hold')],
  ['once', tn('Once')],
  ['loop', tn('Loop')],
  ['pingpong', tn('Ping-pong')],
  ['onceReverse', tn('Once reverse')],
  ['loopReverse', tn('Loop reverse')],
  ['pingpongReverse', tn('Ping-pong reverse')],
];

/** Sequence keys of an attachment in the current animation (created when `create`). */
export function sequenceKeys(app, s, att, create = false) {
  const anim = app.currentAnimation();
  if (!anim) return null;
  const doc = app.doc;
  const skin = doc.slots[s].attachments.includes(att) ? 'default' : doc.skin ?? 'default';
  anim.extra ??= {};
  const slotName = doc.slots[s].name;
  if (!create) return anim.extra.attachments?.[skin]?.[slotName]?.[att.name]?.sequence ?? null;
  const timelines = (((anim.extra.attachments ??= {})[skin] ??= {})[slotName] ??= {})[att.name] ??= {};
  return (timelines.sequence ??= []);
}

/** Image sequence settings (Setup) or sequence keys (Animate) of a region or mesh. */
function sequenceUi(app, s, att, setupMode) {
  const doc = app.doc;
  if (setupMode) {
    const seq = att.sequence;
    const toggle = h(
      'label',
      { class: 'check', title: t('Show numbered images (name01, name02, …) one at a time') },
      h('input', {
        type: 'checkbox',
        checked: !!seq,
        onchange: (e) => {
          if (e.target.checked) att.sequence = { count: 2 };
          else delete att.sequence;
          app.changed();
        },
      }),
      ' ' + t('Image sequence'),
    );
    if (!seq) return h('div', { class: 'buttons' }, toggle);
    const set = (key, v, def) => {
      if (v === def) delete seq[key];
      else seq[key] = v;
      app.changed();
    };
    const count = seq.count ?? 1;
    const frames = Array.from({ length: count }, (_, i) => sequenceFrameName(att, i));
    const found = frames.filter((n) => app.images.get(n)).length;
    return [
      h('div', { class: 'buttons' }, toggle),
      h(
        'div',
        { class: 'grid' },
        row(t('Frames'), dragValue(count, (v) => set('count', Math.max(1, Math.round(v)), undefined), { speed: 0.1, min: 1, decimals: 0 })),
        row(t('Start'), dragValue(seq.start ?? 1, (v) => set('start', Math.round(v), 1), { speed: 0.1, min: 0, decimals: 0 })),
        row(t('Digits'), dragValue(seq.digits ?? 0, (v) => set('digits', Math.max(0, Math.round(v)), 0), { speed: 0.05, min: 0, max: 8, decimals: 0 })),
        row(t('Setup frame'), dragValue(seq.setup ?? 0, (v) => set('setup', Math.min(count - 1, Math.max(0, Math.round(v))), 0), { speed: 0.1, decimals: 0 })),
        row(t('Images'), t('{first} … {last} ({found} of {count} found)', { first: frames[0], last: frames.at(-1), found, count })),
      ),
    ];
  }
  if (!att.sequence) return null;
  const anim = app.currentAnimation();
  if (!anim) return null;
  const time = Math.round(app.time * FPS) / FPS;
  const keys = sequenceKeys(app, s, att) ?? [];
  let current = null;
  let delay = 0;
  for (const k of keys) {
    if ((k.time ?? 0) > time + 1e-6) break;
    current = k;
    delay = k.delay ?? delay;
  }
  const state = { mode: current?.mode ?? 'hold', index: current?.index ?? 0, delay: delay || 1 / FPS };
  const keyed = !!current && Math.abs((current.time ?? 0) - time) < 5e-4;
  const write = (changes) => {
    const v = { ...state, ...changes };
    const list = sequenceKeys(app, s, att, true);
    let k = list.find((x) => Math.abs((x.time ?? 0) - time) < 5e-4);
    if (!k) {
      k = { time };
      list.push(k);
      list.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    }
    k.time = time;
    if (v.mode === 'hold') delete k.mode;
    else k.mode = v.mode;
    if (v.index) k.index = v.index;
    else delete k.index;
    k.delay = v.delay;
    app.changed();
  };
  return [
    h('strong', null, t('Sequence')),
    h(
      'div',
      { class: 'grid' },
      row(t('Mode'), select(SEQUENCE_MODES.map(([v, l]) => [v, t(l)]), state.mode, (v) => write({ mode: v }))),
      row(t('Frame'), dragValue(state.index, (v) => write({ index: Math.max(0, Math.round(v)) }), { speed: 0.1, min: 0, max: (att.sequence.count ?? 1) - 1, decimals: 0 })),
      row(t('Frame time'), dragValue(state.delay, (v) => write({ delay: Math.max(0, v) }), { speed: 0.001, min: 0, decimals: 3, suffix: ' s' })),
      row('', h('button', { class: `keybtn ${keyed ? 'keyed' : 'none'}`, onclick: () => write({}) }, '◆'), h('span', { class: 'small weak' }, ' ' + t('Key at frame {frame}', { frame: Math.round(time * FPS) }))),
    ),
  ];
}
