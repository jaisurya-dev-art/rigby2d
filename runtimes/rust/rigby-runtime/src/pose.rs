// SPDX-License-Identifier: MIT OR Apache-2.0
//! Evaluated skeleton state: local and world transforms of every bone, slot state, mesh
//! deformation, draw order and constraints. Behaves exactly like the JavaScript runtime's `Pose`.

use crate::curve::{cubic4, sample_raw};
use crate::math::{angle_of, lerp, wrap_degrees, Affine, Transform, DEG};
use crate::model::*;
use std::collections::HashMap;

const EPSILON: f64 = 1e-5;

#[derive(Clone, Copy, Debug, Default)]
pub struct IkState {
    pub mix: f64,
    pub softness: f64,
    pub bend_positive: bool,
    pub compress: bool,
    pub stretch: bool,
}

/// Animatable state of a transform, path, physics or slider constraint.
#[derive(Clone, Debug)]
pub enum ConstraintState {
    Transform([f64; PROPS]),
    Path(PathState),
    /// inertia, strength, damping, mass, wind, gravity, mix.
    Physics([f64; 7]),
    /// time, mix.
    Slider([f64; 2]),
}

impl ConstraintState {
    fn setup(c: &ConstraintData) -> ConstraintState {
        match &c.kind {
            ConstraintKind::Transform(t) => ConstraintState::Transform(t.mix),
            ConstraintKind::Path(p) => ConstraintState::Path(p.setup),
            ConstraintKind::Physics(p) => ConstraintState::Physics(p.setup),
            ConstraintKind::Slider(s) => ConstraintState::Slider(s.setup),
        }
    }
}

/// Persistent physics simulation of one constraint.
#[derive(Clone, Debug, Default)]
pub struct PhysicsSim {
    rest: f64,
    o: [f64; 2],
    ov: [f64; 2],
    t: [f64; 2],
    tv: [f64; 2],
    last_origin: [f64; 2],
    last_tip: [f64; 2],
}

#[derive(Clone, Copy, Debug)]
enum Step {
    Ik(usize),
    Other(usize),
}

enum Solved {
    None,
    World(Vec<(usize, Affine)>),
    Local(Vec<usize>),
    All,
}

/// A visible region or mesh in draw order (see `Pose::quads`).
#[derive(Clone, Debug)]
pub struct Quad {
    pub slot: usize,
    pub image: NameId,
    /// World positions, flat: regions TL, TR, BR, BL; meshes one pair per vertex.
    pub positions: Vec<f64>,
    pub color: [f64; 4],
}

/// A mutable pose for one skeleton instance.
#[derive(Clone, Debug)]
pub struct Pose {
    /// Animated local transforms.
    pub local: Vec<Transform>,
    /// Local transforms after constraints; world transforms are computed from these.
    pub applied: Vec<Transform>,
    pub world: Vec<Affine>,
    pub inherit: Vec<Inherit>,
    pub attachment: Vec<Option<NameId>>,
    pub color: Vec<[f64; 4]>,
    pub dark: Vec<Option<[f64; 3]>>,
    pub draw_order: Vec<usize>,
    pub sequence: Vec<i64>,
    /// Deform deltas by (slot, attachment name).
    pub deform: HashMap<(usize, NameId), Vec<f64>>,
    pub ik: Vec<IkState>,
    pub constraint_state: Vec<ConstraintState>,
    /// Physics simulation state by constraint; it survives `reset` (see `reset_physics`).
    pub physics: Vec<Option<PhysicsSim>>,
    /// Seconds of physics to simulate in the next `update_world` (0 = only apply offsets).
    pub physics_delta: f64,
    /// Active skin (None = default skin only).
    pub skin: Option<usize>,
    /// Transform above the root bones (where a scene places this skeleton), None = identity.
    /// Physics simulates in the skeleton's own units, so a placed character swings like it does at
    /// full size.
    pub placement: Option<Affine>,
    steps: Vec<Step>,
    dirty: Vec<u8>,
    /// While a slider applies its animation, keys go to `applied` instead of `local`.
    into_applied: bool,
    scratch: Vec<f64>,
}

impl Pose {
    pub fn new(sk: &SkeletonData) -> Pose {
        let mut steps: Vec<(f64, Step)> = sk.ik.iter().enumerate().map(|(i, c)| (c.order, Step::Ik(i))).collect();
        steps.extend(sk.constraints.iter().enumerate().map(|(i, c)| (c.order, Step::Other(i))));
        steps.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let mut pose = Pose {
            local: Vec::new(),
            applied: Vec::new(),
            world: vec![Affine::IDENTITY; sk.bones.len()],
            inherit: Vec::new(),
            attachment: Vec::new(),
            color: Vec::new(),
            dark: Vec::new(),
            draw_order: Vec::new(),
            sequence: Vec::new(),
            deform: HashMap::new(),
            ik: Vec::new(),
            constraint_state: sk.constraints.iter().map(ConstraintState::setup).collect(),
            physics: vec![None; sk.constraints.len()],
            physics_delta: 0.0,
            skin: None,
            placement: None,
            steps: steps.into_iter().map(|s| s.1).collect(),
            dirty: vec![0; sk.bones.len()],
            into_applied: false,
            scratch: Vec::new(),
        };
        pose.set_to_setup(sk);
        pose
    }

    /// Resets everything to the setup pose and recomputes world transforms.
    pub fn set_to_setup(&mut self, sk: &SkeletonData) {
        self.reset(sk);
        self.update_world(sk);
    }

    /// Resets local state to the setup pose without computing world transforms.
    pub fn reset(&mut self, sk: &SkeletonData) {
        self.local.clear();
        self.local.extend(sk.bones.iter().map(|b| b.setup));
        self.inherit.clear();
        self.inherit.extend(sk.bones.iter().map(|b| b.inherit));
        self.attachment.clear();
        self.attachment.extend(sk.slots.iter().map(|s| s.attachment));
        self.color.clear();
        self.color.extend(sk.slots.iter().map(|s| s.color));
        self.dark.clear();
        self.dark.extend(sk.slots.iter().map(|s| s.dark));
        self.draw_order.clear();
        self.draw_order.extend(0..sk.slots.len());
        self.sequence.clear();
        self.sequence.resize(sk.slots.len(), -1);
        self.deform.clear();
        self.ik.clear();
        self.ik.extend(sk.ik.iter().map(|c| IkState { mix: c.mix, softness: c.softness, bend_positive: c.bend_positive, compress: c.compress, stretch: c.stretch }));
        for (state, c) in self.constraint_state.iter_mut().zip(sk.constraints.iter()) {
            *state = ConstraintState::setup(c);
        }
    }

    /// Clears physics so every simulated bone starts again from its animated pose.
    pub fn reset_physics(&mut self) {
        self.physics.iter_mut().for_each(|p| *p = None);
    }

    /// Applies animation `anim` at `time` on top of the current pose, blended by `alpha`.
    pub fn apply(&mut self, sk: &SkeletonData, anim: usize, time: f64, alpha: f64) {
        let Some(a) = sk.animations.get(anim) else { return };
        self.apply_animation(sk, a, time, alpha);
    }

    fn apply_animation(&mut self, sk: &SkeletonData, anim: &Animation, time: f64, alpha: f64) {
        let hold = alpha >= 0.5;
        for t in &anim.bones {
            let Some(bone) = sk.bones.get(t.bone) else { continue };
            let setup = &bone.setup;
            let target = if self.into_applied { &mut self.applied } else { &mut self.local };
            let l = &mut target[t.bone];
            let (mut x, mut y, mut rotation, mut sx, mut sy, mut hx, mut hy) = (l.x, l.y, l.rotation, l.scale_x, l.scale_y, l.shear_x, l.shear_y);
            let c = &t.channels;
            if !c[CH_ROTATE].is_empty() {
                rotation = setup.rotation + sample_component(&c[CH_ROTATE], time, 0);
            }
            if !c[CH_TRANSLATE].is_empty() {
                x = setup.x + sample_component(&c[CH_TRANSLATE], time, 0);
                y = setup.y + sample_component(&c[CH_TRANSLATE], time, 1);
            }
            if !c[CH_TRANSLATE_X].is_empty() {
                x = setup.x + sample_component(&c[CH_TRANSLATE_X], time, 0);
            }
            if !c[CH_TRANSLATE_Y].is_empty() {
                y = setup.y + sample_component(&c[CH_TRANSLATE_Y], time, 0);
            }
            if !c[CH_SCALE].is_empty() {
                sx = setup.scale_x * sample_component(&c[CH_SCALE], time, 0);
                sy = setup.scale_y * sample_component(&c[CH_SCALE], time, 1);
            }
            if !c[CH_SCALE_X].is_empty() {
                sx = setup.scale_x * sample_component(&c[CH_SCALE_X], time, 0);
            }
            if !c[CH_SCALE_Y].is_empty() {
                sy = setup.scale_y * sample_component(&c[CH_SCALE_Y], time, 0);
            }
            if !c[CH_SHEAR].is_empty() {
                hx = setup.shear_x + sample_component(&c[CH_SHEAR], time, 0);
                hy = setup.shear_y + sample_component(&c[CH_SHEAR], time, 1);
            }
            if !c[CH_SHEAR_X].is_empty() {
                hx = setup.shear_x + sample_component(&c[CH_SHEAR_X], time, 0);
            }
            if !c[CH_SHEAR_Y].is_empty() {
                hy = setup.shear_y + sample_component(&c[CH_SHEAR_Y], time, 0);
            }
            if hold && !t.inherit.is_empty() {
                self.inherit[t.bone] = sample_discrete(&t.inherit, time);
            }
            let target = if self.into_applied { &mut self.applied } else { &mut self.local };
            let l = &mut target[t.bone];
            if alpha >= 1.0 {
                *l = Transform { x, y, rotation, scale_x: sx, scale_y: sy, shear_x: hx, shear_y: hy };
            } else {
                l.x = lerp(l.x, x, alpha);
                l.y = lerp(l.y, y, alpha);
                l.rotation = lerp(l.rotation, rotation, alpha);
                l.scale_x = lerp(l.scale_x, sx, alpha);
                l.scale_y = lerp(l.scale_y, sy, alpha);
                l.shear_x = lerp(l.shear_x, hx, alpha);
                l.shear_y = lerp(l.shear_y, hy, alpha);
            }
        }
        for t in &anim.slots {
            let i = t.slot;
            if i >= self.attachment.len() {
                continue;
            }
            if hold && !t.attachment.is_empty() {
                self.attachment[i] = sample_discrete(&t.attachment, time);
            }
            let mut color = self.color[i];
            let mut dark = self.dark[i];
            let mut v = std::mem::take(&mut self.scratch);
            if sample_into(&t.color, time, &mut v) {
                for k in 0..4.min(v.len()) {
                    color[k] = v[k];
                }
            }
            if sample_into(&t.rgb, time, &mut v) {
                // An 8-digit color in an rgb key also sets alpha (as the JavaScript runtime does).
                for k in 0..4.min(v.len()) {
                    color[k] = v[k];
                }
            }
            if sample_into(&t.alpha, time, &mut v) {
                color[3] = v[0];
            }
            if sample_into(&t.rgba2, time, &mut v) {
                for k in 0..4 {
                    color[k] = v[k];
                }
                dark = Some([v[4], v[5], v[6]]);
            }
            if sample_into(&t.rgb2, time, &mut v) {
                for k in 0..3 {
                    color[k] = v[k];
                }
                dark = Some([v[3], v[4], v[5]]);
            }
            self.scratch = v;
            let current = &mut self.color[i];
            for k in 0..4 {
                current[k] = lerp(current[k], color[k], alpha);
            }
            if let Some(d) = dark {
                let from = self.dark[i].unwrap_or(d);
                self.dark[i] = Some([lerp(from[0], d[0], alpha), lerp(from[1], d[1], alpha), lerp(from[2], d[2], alpha)]);
            }
        }
        for t in &anim.deform {
            if t.keys.is_empty() || t.slot >= sk.slots.len() {
                continue;
            }
            let skin = match &t.skin {
                Some(name) => sk.find_skin(name),
                None => self.skin,
            };
            // A named skin that does not exist resolves through the default skin only.
            let Some(att) = sk.attachment(t.slot, Some(t.attachment), skin) else { continue };
            let source = sk.mesh_source(t.slot, att, self.skin).unwrap_or(att);
            let n = deform_len(source);
            let deltas = sample_deform(&t.keys, time, n);
            let key = (t.slot, t.attachment);
            match self.deform.get_mut(&key) {
                Some(prev) if alpha < 1.0 => {
                    for (j, p) in prev.iter_mut().enumerate() {
                        *p = lerp(*p, deltas.get(j).copied().unwrap_or(0.0), alpha);
                    }
                }
                _ => {
                    self.deform.insert(key, deltas);
                }
            }
        }
        // Sequence keys: the frame of the image sequence a slot's attachment shows.
        if hold {
            for t in &anim.sequences {
                if self.attachment[t.slot] != Some(t.attachment) {
                    continue;
                }
                let skin = match &t.skin {
                    Some(name) => sk.find_skin(name),
                    None => None,
                };
                let att = sk.attachment(t.slot, Some(t.attachment), skin).or_else(|| sk.attachment(t.slot, Some(t.attachment), self.skin));
                let Some(seq) = att.and_then(|a| a.sequence.as_ref()) else { continue };
                if let Some(index) = sequence_index_at(&t.keys, time, seq.count) {
                    self.sequence[t.slot] = index;
                }
            }
        }
        if hold && !anim.draw_order.is_empty() {
            let i = anim.draw_order.partition_point(|k| k.0 <= time) as isize - 1;
            if i >= 0 {
                self.draw_order = apply_draw_order(sk.slots.len(), anim.draw_order[i as usize].1.as_deref());
            }
        }
        self.apply_constraint_timelines(sk, anim, time, alpha);
        for t in &anim.ik {
            let Some(state) = self.ik.get_mut(t.constraint) else { continue };
            let i = t.keys.partition_point(|k| k.time <= time) as isize - 1;
            if i < 0 {
                continue;
            }
            let a = &t.keys[i as usize];
            let b = t.keys.get(i as usize + 1);
            let frac = match b {
                Some(b) if b.time > a.time => (time - a.time) / (b.time - a.time),
                _ => 0.0,
            };
            let mix = lerp(a.mix, b.map_or(a.mix, |b| b.mix), frac);
            let softness = lerp(a.softness, b.map_or(a.softness, |b| b.softness), frac);
            state.mix = lerp(state.mix, mix, alpha);
            state.softness = lerp(state.softness, softness, alpha);
            if hold {
                state.bend_positive = a.bend_positive;
                state.compress = a.compress;
                state.stretch = a.stretch;
            }
        }
    }

    fn apply_constraint_timelines(&mut self, sk: &SkeletonData, anim: &Animation, time: f64, alpha: f64) {
        if !anim.has_constraint_keys {
            return;
        }
        let mut v = std::mem::take(&mut self.scratch);
        for t in &anim.constraints {
            let c = &sk.constraints[t.constraint];
            let state = &mut self.constraint_state[t.constraint];
            match (state, &c.kind) {
                (ConstraintState::Transform(mix), _) => {
                    if t.transform.is_empty() {
                        continue;
                    }
                    sample_raw(&t.transform, time, &mut v);
                    for j in 0..PROPS {
                        mix[j] += (v[j] - mix[j]) * alpha;
                    }
                }
                (ConstraintState::Slider(s), _) => {
                    for (k, keys) in [&t.slider_time, &t.slider_mix].into_iter().enumerate() {
                        if keys.is_empty() {
                            continue;
                        }
                        sample_raw(keys, time, &mut v);
                        s[k] += (v[0] - s[k]) * alpha;
                    }
                }
                (ConstraintState::Physics(s), ConstraintKind::Physics(p)) => {
                    for (global, lists) in [(false, &t.physics), (true, &t.physics_global)] {
                        for (k, keys) in lists.iter().enumerate() {
                            if keys.is_empty() || (global && !p.globals[k]) {
                                continue;
                            }
                            sample_raw(keys, time, &mut v);
                            s[k] += (v[0] - s[k]) * alpha;
                        }
                    }
                }
                (ConstraintState::Path(s), _) => {
                    if !t.position.is_empty() {
                        sample_raw(&t.position, time, &mut v);
                        s.position += (v[0] - s.position) * alpha;
                    }
                    if !t.spacing.is_empty() {
                        sample_raw(&t.spacing, time, &mut v);
                        s.spacing += (v[0] - s.spacing) * alpha;
                    }
                    if !t.path_mix.is_empty() {
                        sample_raw(&t.path_mix, time, &mut v);
                        s.mix_rotate += (v[0] - s.mix_rotate) * alpha;
                        s.mix_x += (v[1] - s.mix_x) * alpha;
                        s.mix_y += (v[2] - s.mix_y) * alpha;
                    }
                }
                _ => {}
            }
        }
        self.scratch = v;
    }

    /// Recomputes world transforms from local transforms, then applies constraints in order.
    pub fn update_world(&mut self, sk: &SkeletonData) {
        self.applied.clear();
        self.applied.extend_from_slice(&self.local);
        self.world.resize(sk.bones.len(), Affine::IDENTITY);
        self.compute_world(sk);
        let delta = self.physics_delta;
        self.physics_delta = 0.0;
        for s in 0..self.steps.len() {
            match self.steps[s] {
                Step::Ik(i) => {
                    let c = &sk.ik[i];
                    if c.skin_required && !self.skin.is_some_and(|k| sk.skins[k].ik.contains(&i)) {
                        continue;
                    }
                    let state = self.ik[i];
                    self.solve_ik(sk, c, &state);
                }
                Step::Other(i) => {
                    let c = &sk.constraints[i];
                    if !self.constraint_active(sk, c) {
                        continue;
                    }
                    let result = match &c.kind {
                        ConstraintKind::Transform(t) => self.solve_transform(c, t, i),
                        ConstraintKind::Path(p) => self.solve_path(sk, c, p, i),
                        ConstraintKind::Slider(sl) => self.solve_slider(sk, sl, i),
                        ConstraintKind::Physics(p) => self.solve_physics(sk, p, i, delta),
                    };
                    match result {
                        Solved::None => {}
                        Solved::All => self.compute_world(sk),
                        Solved::World(desired) => self.set_worlds(sk, &desired),
                        Solved::Local(bones) => {
                            for b in bones {
                                self.update_branch(sk, b);
                            }
                        }
                    }
                }
            }
        }
    }

    fn constraint_active(&self, sk: &SkeletonData, c: &ConstraintData) -> bool {
        if !c.skin_required {
            return true;
        }
        self.skin.is_some_and(|k| sk.skins[k].constraints.contains(&c.name))
    }

    fn compute_world(&mut self, sk: &SkeletonData) {
        for i in 0..sk.bones.len() {
            self.update_bone(sk, i);
        }
    }

    fn update_bone(&mut self, sk: &SkeletonData, i: usize) {
        let local = self.applied[i].to_affine();
        self.world[i] = match sk.bones[i].parent {
            None => match &self.placement {
                Some(pl) => pl.mul(&local),
                None => local,
            },
            Some(p) => inherit_world(&self.world[p], &local, self.inherit[i]),
        };
    }

    /// Recomputes the world transform of `root` and its descendants.
    fn update_branch(&mut self, sk: &SkeletonData, root: usize) {
        self.dirty.iter_mut().for_each(|d| *d = 0);
        self.dirty.resize(sk.bones.len(), 0);
        self.dirty[root] = 1;
        self.update_bone(sk, root);
        for i in root + 1..sk.bones.len() {
            if let Some(p) = sk.bones[i].parent {
                if self.dirty[p] != 0 {
                    self.dirty[i] = 1;
                    self.update_bone(sk, i);
                }
            }
        }
    }

    /// Sets the world transforms of some bones, updating their applied local transforms to match
    /// and moving their descendants along.
    pub(crate) fn set_worlds(&mut self, sk: &SkeletonData, desired: &[(usize, Affine)]) {
        self.dirty.iter_mut().for_each(|d| *d = 0);
        self.dirty.resize(sk.bones.len(), 0);
        let first = desired.iter().map(|d| d.0).min().unwrap_or(sk.bones.len());
        for i in first..sk.bones.len() {
            let p = sk.bones[i].parent;
            if let Some(want) = desired.iter().rev().find(|d| d.0 == i).map(|d| d.1) {
                self.applied[i] = match (p, &self.placement) {
                    (None, Some(pl)) => local_from_world(Some(pl), &want, Inherit::Normal),
                    _ => local_from_world(p.map(|p| &self.world[p]), &want, self.inherit[i]),
                };
                self.world[i] = want;
                self.dirty[i] = 1;
            } else if let Some(p) = p {
                if self.dirty[p] != 0 {
                    self.update_bone(sk, i);
                    self.dirty[i] = 1;
                }
            }
        }
    }

    // ---- IK ----------------------------------------------------------------------------------

    fn parent_sign(&self, sk: &SkeletonData, b: usize) -> f64 {
        match sk.bones[b].parent {
            Some(p) if self.world[p].determinant() < 0.0 => -1.0,
            _ => 1.0,
        }
    }

    fn aim(&mut self, sk: &SkeletonData, b: usize, from: (f64, f64), tip: (f64, f64), target: (f64, f64), mix: f64) {
        let delta = wrap_degrees(angle_of(target.0 - from.0, target.1 - from.1) - angle_of(tip.0 - from.0, tip.1 - from.1));
        self.applied[b].rotation += delta * mix * self.parent_sign(sk, b);
    }

    /// Rotates (and optionally stretches) the constrained bones so the chain reaches the target.
    fn solve_ik(&mut self, sk: &SkeletonData, c: &IkData, state: &IkState) {
        let mix = state.mix;
        if mix <= 0.0 || c.bones.is_empty() {
            return;
        }
        let target = self.world[c.target].apply(0.0, 0.0);
        if c.bones.len() == 1 {
            let b = c.bones[0];
            let w = self.world[b];
            let origin = w.apply(0.0, 0.0);
            self.aim(sk, b, origin, w.apply(1.0, 0.0), target, mix);
            let bone_len = sk.bones[b].length * w.a.hypot(w.b);
            let dist = (target.0 - origin.0).hypot(target.1 - origin.1);
            if bone_len > 1e-4 && ((state.compress && dist < bone_len) || (state.stretch && dist > bone_len)) {
                let s = (dist / bone_len - 1.0) * mix + 1.0;
                self.applied[b].scale_x *= s;
                if c.uniform {
                    self.applied[b].scale_y *= s;
                }
            }
            self.update_branch(sk, b);
            return;
        }
        let (p, ch) = (c.bones[0], c.bones[1]);
        let pp = self.world[p].apply(0.0, 0.0);
        let cc = self.world[ch].apply(0.0, 0.0);
        let tip = self.world[ch].apply(sk.bones[ch].length, 0.0);
        let a = (cc.0 - pp.0).hypot(cc.1 - pp.1);
        let b_len = (tip.0 - cc.0).hypot(tip.1 - cc.1);
        if a < 1e-4 || b_len < 1e-4 {
            let to = if cc.0 != pp.0 || cc.1 != pp.1 { cc } else { self.world[p].apply(1.0, 0.0) };
            self.aim(sk, p, pp, to, target, mix);
            self.update_branch(sk, p);
            return;
        }
        let mut d = (target.0 - pp.0).hypot(target.1 - pp.1);
        if state.stretch && d > a + b_len {
            let s = (d / (a + b_len) - 1.0) * mix + 1.0;
            self.applied[p].scale_x *= s;
            if c.uniform {
                self.applied[p].scale_y *= s;
            }
            self.update_branch(sk, p);
            self.finish_two_bone(sk, ch, target, mix);
            return;
        }
        let soft = state.softness;
        if soft > 0.0 && d > a + b_len - soft {
            d = a + b_len - soft * (-(d - (a + b_len - soft)) / soft).exp();
        }
        d = d.max((a - b_len).abs() + 1e-6).min(a + b_len - 1e-6);
        let cos_a = ((a * a + d * d - b_len * b_len) / (2.0 * a * d)).clamp(-1.0, 1.0);
        let angle = cos_a.acos() / DEG;
        // A mirrored chain bends the other way on screen.
        let bend = (if state.bend_positive { 1.0 } else { -1.0 }) * (if self.world[p].determinant() < 0.0 { -1.0 } else { 1.0 });
        let desired = angle_of(target.0 - pp.0, target.1 - pp.1) - bend * angle;
        let delta = wrap_degrees(desired - angle_of(cc.0 - pp.0, cc.1 - pp.1));
        self.applied[p].rotation += delta * mix * self.parent_sign(sk, p);
        self.update_branch(sk, p);
        self.finish_two_bone(sk, ch, target, mix);
    }

    fn finish_two_bone(&mut self, sk: &SkeletonData, ch: usize, target: (f64, f64), mix: f64) {
        let cc = self.world[ch].apply(0.0, 0.0);
        let tip = self.world[ch].apply(sk.bones[ch].length.max(1e-3), 0.0);
        let delta = wrap_degrees(angle_of(target.0 - cc.0, target.1 - cc.1) - angle_of(tip.0 - cc.0, tip.1 - cc.1));
        self.applied[ch].rotation += delta * mix * self.parent_sign(sk, ch);
        self.update_branch(sk, ch);
    }

    // ---- transform constraints -----------------------------------------------------------------

    fn source_values(&self, t: &TransformData) -> [f64; PROPS] {
        if t.local_source {
            let a = &self.applied[t.source];
            return [a.rotation, a.x, a.y, a.scale_x, a.scale_y, a.shear_y];
        }
        let s = &self.world[t.source];
        let (x, y) = s.apply(t.offsets[P_X], t.offsets[P_Y]);
        let x_angle = angle_of(s.a, s.b);
        [x_angle, x, y, s.a.hypot(s.b), s.c.hypot(s.d), wrap_degrees(angle_of(s.c, s.d) - x_angle - 90.0)]
    }

    /// Target property values after the mapping and offsets (None = property not targeted).
    fn target_values(&self, t: &TransformData) -> [Option<f64>; PROPS] {
        let src = self.source_values(t);
        let reflected = !t.local_source && self.world[t.source].determinant() < 0.0;
        let mut out = [None; PROPS];
        for p in &t.props {
            let from = src[p.from] - p.offset;
            for to in &p.to {
                let mut v = from * to.scale + to.offset;
                if t.clamp {
                    v = v.max(to.offset.min(to.max)).min(to.offset.max(to.max));
                }
                // World x/y offsets are already applied through the source bone.
                let point_offset = !t.local_source && (to.prop == P_X || to.prop == P_Y) && (p.from == P_X || p.from == P_Y);
                let mut off = if point_offset { 0.0 } else { t.offsets[to.prop] };
                if reflected && (to.prop == P_ROTATE || to.prop == P_SHEAR_Y) {
                    off = -off;
                }
                out[to.prop] = Some(out[to.prop].unwrap_or(0.0) + v + off);
            }
        }
        out
    }

    fn solve_transform(&mut self, c: &ConstraintData, t: &TransformData, index: usize) -> Solved {
        let ConstraintState::Transform(mix) = self.constraint_state[index] else { return Solved::None };
        if mix.iter().all(|m| *m == 0.0) {
            return Solved::None;
        }
        let v = self.target_values(t);
        if t.local_target {
            for &b in &c.bones {
                let a = &mut self.applied[b];
                let m = |p: usize| if v[p].is_none() { 0.0 } else { mix[p] };
                let val = |p: usize| v[p].unwrap_or(f64::NAN);
                if t.additive {
                    if m(P_ROTATE) != 0.0 {
                        a.rotation += val(P_ROTATE) * mix[P_ROTATE];
                    }
                    if m(P_X) != 0.0 {
                        a.x += val(P_X) * mix[P_X];
                    }
                    if m(P_Y) != 0.0 {
                        a.y += val(P_Y) * mix[P_Y];
                    }
                    if m(P_SCALE_X) != 0.0 {
                        a.scale_x *= (val(P_SCALE_X) - 1.0) * mix[P_SCALE_X] + 1.0;
                    }
                    if m(P_SCALE_Y) != 0.0 {
                        a.scale_y *= (val(P_SCALE_Y) - 1.0) * mix[P_SCALE_Y] + 1.0;
                    }
                    if m(P_SHEAR_Y) != 0.0 {
                        a.shear_y += val(P_SHEAR_Y) * mix[P_SHEAR_Y];
                    }
                } else {
                    if m(P_ROTATE) != 0.0 {
                        a.rotation += wrap_degrees(val(P_ROTATE) - a.rotation) * mix[P_ROTATE];
                    }
                    if m(P_X) != 0.0 {
                        a.x += (val(P_X) - a.x) * mix[P_X];
                    }
                    if m(P_Y) != 0.0 {
                        a.y += (val(P_Y) - a.y) * mix[P_Y];
                    }
                    if m(P_SCALE_X) != 0.0 {
                        a.scale_x += (val(P_SCALE_X) - a.scale_x) * mix[P_SCALE_X];
                    }
                    if m(P_SCALE_Y) != 0.0 {
                        a.scale_y += (val(P_SCALE_Y) - a.scale_y) * mix[P_SCALE_Y];
                    }
                    if m(P_SHEAR_Y) != 0.0 {
                        a.shear_y += wrap_degrees(val(P_SHEAR_Y) - a.shear_y) * mix[P_SHEAR_Y];
                    }
                }
            }
            return Solved::Local(c.bones.clone());
        }
        let mut desired = Vec::with_capacity(c.bones.len());
        for &b in &c.bones {
            let mut m = self.world[b];
            if let Some(r) = v[P_ROTATE] {
                if mix[P_ROTATE] != 0.0 {
                    let r = if t.additive { r } else { wrap_degrees(r - angle_of(m.a, m.b)) };
                    rotate_linear(&mut m, r * mix[P_ROTATE]);
                }
            }
            if let Some(x) = v[P_X] {
                if mix[P_X] != 0.0 {
                    m.tx += if t.additive { x * mix[P_X] } else { (x - m.tx) * mix[P_X] };
                }
            }
            if let Some(y) = v[P_Y] {
                if mix[P_Y] != 0.0 {
                    m.ty += if t.additive { y * mix[P_Y] } else { (y - m.ty) * mix[P_Y] };
                }
            }
            let scale = |m: &mut Affine, value: f64, mix_value: f64, y_axis: bool| {
                let (ax, ay) = if y_axis { (m.c, m.d) } else { (m.a, m.b) };
                let s = ax.hypot(ay);
                if s < EPSILON {
                    return;
                }
                let f = if t.additive { (value - 1.0) * mix_value + 1.0 } else { (s + (value - s) * mix_value) / s };
                if y_axis {
                    m.c *= f;
                    m.d *= f;
                } else {
                    m.a *= f;
                    m.b *= f;
                }
            };
            if let Some(sx) = v[P_SCALE_X] {
                if mix[P_SCALE_X] != 0.0 {
                    scale(&mut m, sx, mix[P_SCALE_X], false);
                }
            }
            if let Some(sy) = v[P_SCALE_Y] {
                if mix[P_SCALE_Y] != 0.0 {
                    scale(&mut m, sy, mix[P_SCALE_Y], true);
                }
            }
            if let Some(shear) = v[P_SHEAR_Y] {
                if mix[P_SHEAR_Y] != 0.0 {
                    let x_angle = angle_of(m.a, m.b);
                    let gap = wrap_degrees(angle_of(m.c, m.d) - x_angle);
                    let want = if t.additive { gap + shear * mix[P_SHEAR_Y] } else { gap + wrap_degrees(90.0 + shear - gap) * mix[P_SHEAR_Y] };
                    let len = m.c.hypot(m.d);
                    m.c = ((x_angle + want) * DEG).cos() * len;
                    m.d = ((x_angle + want) * DEG).sin() * len;
                }
            }
            desired.push((b, m));
        }
        Solved::World(desired)
    }

    // ---- path constraints ----------------------------------------------------------------------

    fn solve_path(&mut self, sk: &SkeletonData, c: &ConstraintData, p: &PathData, index: usize) -> Solved {
        let ConstraintState::Path(state) = self.constraint_state[index] else { return Solved::None };
        if state.mix_rotate == 0.0 && state.mix_x == 0.0 && state.mix_y == 0.0 {
            return Solved::None;
        }
        let Some(att) = self.slot_attachment(sk, p.slot) else { return Solved::None };
        let AttachmentKind::Path { closed, constant_speed, lengths, .. } = &att.kind else { return Solved::None };
        let verts = self.world_vertices(sk, p.slot, att);
        let Some(path) = PathCurve::build(&verts, *closed, *constant_speed, lengths) else { return Solved::None };

        let n = c.bones.len();
        let tangents = p.rotate_mode == RotateMode::Tangent;
        let chain_scale = p.rotate_mode == RotateMode::ChainScale;
        let count = if tangents { n } else { n + 1 };
        let lens: Vec<f64> = c.bones.iter().map(|&b| sk.bones[b].length * self.world[b].a.hypot(self.world[b].b)).collect();
        let mut spaces = vec![0.0; count];
        let percent_spacing = p.spacing_mode == SpacingMode::Percent;
        for i in 0..count.saturating_sub(1) {
            let len = lens.get(i).copied().unwrap_or(f64::NAN);
            spaces[i + 1] = match p.spacing_mode {
                SpacingMode::Percent | SpacingMode::Fixed => state.spacing,
                SpacingMode::Proportional => len,
                SpacingMode::Length => {
                    if len < EPSILON {
                        0.0
                    } else {
                        len + state.spacing
                    }
                }
            };
        }
        if p.spacing_mode == SpacingMode::Proportional {
            let sum: f64 = spaces.iter().sum();
            if sum > EPSILON {
                for s in spaces.iter_mut().skip(1) {
                    *s *= (path.length * (1.0 - state.spacing.min(1.0))) / sum;
                }
            }
        }
        let mut position = state.position;
        if p.position_mode == PositionMode::Percent {
            position *= path.length;
        }
        let mut points = Vec::with_capacity(count);
        let mut at = position;
        for s in &spaces {
            at += if percent_spacing { s * path.length } else { *s };
            points.push(path.at(at));
        }
        let mut desired = Vec::with_capacity(n);
        for (i, &b) in c.bones.iter().enumerate() {
            let mut m = self.world[b];
            let (x, y, angle) = points[i];
            m.tx += (x - m.tx) * state.mix_x;
            m.ty += (y - m.ty) * state.mix_y;
            if state.mix_rotate > 0.0 {
                let r = if tangents {
                    angle
                } else {
                    let (nx, ny, _) = points[i + 1];
                    let dx = nx - m.tx;
                    let dy = ny - m.ty;
                    if chain_scale && lens[i] >= EPSILON {
                        let s = (dx.hypot(dy) / lens[i] - 1.0) * state.mix_rotate + 1.0;
                        m.a *= s;
                        m.b *= s;
                    }
                    if dx.hypot(dy) > EPSILON {
                        angle_of(dx, dy)
                    } else {
                        angle
                    }
                };
                let reflect = if m.determinant() < 0.0 { -1.0 } else { 1.0 };
                let r = wrap_degrees(r - angle_of(m.a, m.b) + p.offset_rotation * reflect);
                rotate_linear(&mut m, r * state.mix_rotate);
            }
            desired.push((b, m));
        }
        Solved::World(desired)
    }

    // ---- physics -------------------------------------------------------------------------------

    fn solve_physics(&mut self, sk: &SkeletonData, p: &PhysicsData, index: usize, delta: f64) -> Solved {
        /// Wind and gravity are scaled by this to accelerations in skeleton units per second².
        const FORCE_SCALE: f64 = 100.0;
        /// Tip distance used for rotation, scale and shear of bones without a length.
        const MIN_TIP: f64 = 10.0;
        let ConstraintState::Physics(state) = self.constraint_state[index] else { return Solved::None };
        let [inertia, strength, damping, mass, wind, gravity, mix] = state;
        let m = self.world[p.bone];
        let axis = {
            let h = m.a.hypot(m.b);
            if h == 0.0 || h.is_nan() {
                1.0
            } else {
                h
            }
        };
        // A placed skeleton simulates in its own units (see `placement`): positions are divided by
        // the placement's scale going in and the result multiplied by it coming out.
        let ps = match &self.placement {
            Some(pl) => {
                let s = pl.determinant().abs().sqrt();
                if s == 0.0 || s.is_nan() {
                    1.0
                } else {
                    s
                }
            }
            None => 1.0,
        };
        let len = MIN_TIP.max(sk.bones[p.bone].length * axis / ps);
        let origin = [m.tx / ps, m.ty / ps];
        let tip = [origin[0] + (m.a / axis) * len, origin[1] + (m.b / axis) * len];
        let sim = self.physics[index].get_or_insert_with(|| PhysicsSim { last_origin: origin, last_tip: tip, ..Default::default() });
        if delta > 0.0 {
            let step = 1.0 / p.fps.max(1.0);
            sim.rest += delta;
            let mut steps = (sim.rest / step).floor();
            sim.rest -= steps * step;
            steps = steps.min(p.fps.max(1.0)); // at most one second of catching up
            if steps > 0.0 {
                // Inertia: part of the animated movement since the last update is left behind.
                for k in 0..2 {
                    sim.o[k] -= (origin[k] - sim.last_origin[k]) * inertia;
                    sim.t[k] -= (tip[k] - sim.last_tip[k]) * inertia;
                }
                let mass_inv = if mass > 0.0 { 1.0 / mass } else { 1.0 };
                let keep = damping.clamp(0.0, 1.0).powf(60.0 * step);
                let force = [wind * FORCE_SCALE, -gravity * FORCE_SCALE];
                for _ in 0..steps as i64 {
                    for (pos, vel) in [(&mut sim.o, &mut sim.ov), (&mut sim.t, &mut sim.tv)] {
                        for k in 0..2 {
                            vel[k] = (vel[k] + (force[k] - strength * pos[k]) * mass_inv * step) * keep;
                        }
                        let speed = vel[0].hypot(vel[1]);
                        if speed > p.limit {
                            vel[0] *= p.limit / speed;
                            vel[1] *= p.limit / speed;
                        }
                        pos[0] += vel[0] * step;
                        pos[1] += vel[1] * step;
                    }
                }
                sim.last_origin = origin;
                sim.last_tip = tip;
            }
        }
        if mix == 0.0 {
            return Solved::None;
        }
        let mut out = m;
        out.tx += sim.o[0] * p.x * mix * ps;
        out.ty += sim.o[1] * p.y * mix * ps;
        if p.rotate != 0.0 || p.scale_x != 0.0 || p.shear_x != 0.0 {
            let from = [tip[0] - origin[0], tip[1] - origin[1]];
            let to = [from[0] + sim.t[0], from[1] + sim.t[1]];
            let angle = wrap_degrees(angle_of(to[0], to[1]) - angle_of(from[0], from[1]));
            rotate_linear(&mut out, angle * p.rotate * mix);
            if p.shear_x != 0.0 {
                // Tilt only the X axis.
                let r = angle * p.shear_x * mix * DEG;
                let (a, b) = (out.a, out.b);
                out.a = a * r.cos() - b * r.sin();
                out.b = a * r.sin() + b * r.cos();
            }
            if p.scale_x != 0.0 {
                let f = (to[0].hypot(to[1]) / len - 1.0) * p.scale_x * mix + 1.0;
                out.a *= f;
                out.b *= f;
            }
        }
        Solved::World(vec![(p.bone, out)])
    }

    // ---- slider --------------------------------------------------------------------------------

    fn solve_slider(&mut self, sk: &SkeletonData, s: &SliderData, index: usize) -> Solved {
        let ConstraintState::Slider([state_time, state_mix]) = self.constraint_state[index] else { return Solved::None };
        let Some(anim) = sk.animations.get(s.animation) else { return Solved::None };
        if state_mix <= 0.0 {
            return Solved::None;
        }
        let mut time = state_time;
        if let Some(b) = s.bone {
            let value = if s.local { local_property(&self.applied[b], s.property) } else { world_property(&self.world[b], s.property) };
            time = value * s.scale + s.offset;
        }
        let d = anim.duration;
        if d > 0.0 {
            time = if s.looping { ((time % d) + d) % d } else { time.clamp(0.0, d) };
        }
        // Apply onto the constrained (applied) transforms, then recompute world transforms.
        self.into_applied = true;
        self.apply_animation(sk, anim, time, state_mix.min(1.0));
        self.into_applied = false;
        Solved::All
    }

    // ---- attachments ---------------------------------------------------------------------------

    /// The attachment a slot shows, resolved through the active skin.
    pub fn slot_attachment<'a>(&self, sk: &'a SkeletonData, slot: usize) -> Option<&'a Attachment> {
        sk.attachment(slot, self.attachment[slot], self.skin)
    }

    /// Image an attachment shows in a slot: its image, or the current frame of its sequence.
    pub fn image_of(&self, slot: usize, att: &Attachment) -> NameId {
        match &att.sequence {
            None => att.image,
            Some(seq) => {
                let index = self.sequence.get(slot).copied().unwrap_or(-1);
                let i = if index >= 0 { index } else { seq.setup };
                let i = i.clamp(0, seq.frames.len() as i64 - 1) as usize;
                seq.frames[i]
            }
        }
    }

    /// World transform of a region or point attachment.
    pub fn attachment_world(&self, sk: &SkeletonData, slot: usize, offset: &Transform) -> Affine {
        self.world[sk.slots[slot].bone].mul(&offset.to_affine())
    }

    /// World positions of a mesh-like attachment's vertices, flat [x, y, ...].
    pub fn world_vertices(&self, sk: &SkeletonData, slot: usize, att: &Attachment) -> Vec<f64> {
        let mut out = Vec::new();
        self.world_vertices_into(sk, slot, att, &mut out);
        out
    }

    pub fn world_vertices_into(&self, sk: &SkeletonData, slot: usize, att: &Attachment, out: &mut Vec<f64>) {
        out.clear();
        let Some(source) = sk.mesh_source(slot, att, self.skin) else { return };
        let deform_name = match &att.kind {
            AttachmentKind::LinkedMesh { parent, deform: true, .. } => *parent,
            _ => att.name,
        };
        let deform = self.deform.get(&(slot, deform_name));
        let d = |k: usize| deform.map_or(0.0, |v| v.get(k).copied().unwrap_or(0.0));
        let Some(vertices) = vertices_of(source) else { return };
        match vertices {
            Vertices::Weighted(weights) => {
                let mut k = 0;
                for v in weights {
                    let (mut x, mut y) = (0.0, 0.0);
                    for w in v {
                        let bx = w.x + d(k);
                        let by = w.y + d(k + 1);
                        k += 2;
                        let m = &self.world[w.bone];
                        x += (m.a * bx + m.c * by + m.tx) * w.weight;
                        y += (m.b * bx + m.d * by + m.ty) * w.weight;
                    }
                    out.push(x);
                    out.push(y);
                }
            }
            Vertices::Plain(verts) => {
                let m = &self.world[sk.slots[slot].bone];
                let mut i = 0;
                while i + 1 < verts.len() {
                    let vx = verts[i] + d(i);
                    let vy = verts[i + 1] + d(i + 1);
                    out.push(m.a * vx + m.c * vy + m.tx);
                    out.push(m.b * vx + m.d * vy + m.ty);
                    i += 2;
                }
            }
        }
    }

    /// Visible regions and meshes in draw order, with world positions and tint (for tests and
    /// simple renderers; `render::build` makes textured, clipped geometry).
    pub fn quads(&self, sk: &SkeletonData) -> Vec<Quad> {
        let mut out = Vec::new();
        for &i in &self.draw_order {
            let Some(att) = self.slot_attachment(sk, i) else { continue };
            let tint = self.color[i];
            let color = [tint[0] * att.color[0], tint[1] * att.color[1], tint[2] * att.color[2], tint[3] * att.color[3]];
            match &att.kind {
                AttachmentKind::Region { offset, width, height } => {
                    let m = self.attachment_world(sk, i, offset);
                    let (hw, hh) = (width * 0.5, height * 0.5);
                    let mut positions = Vec::with_capacity(8);
                    for (x, y) in [(-hw, hh), (hw, hh), (hw, -hh), (-hw, -hh)] {
                        let p = m.apply(x, y);
                        positions.push(p.0);
                        positions.push(p.1);
                    }
                    out.push(Quad { slot: i, image: self.image_of(i, att), positions, color });
                }
                AttachmentKind::Mesh { .. } | AttachmentKind::LinkedMesh { .. } => {
                    let Some(source) = sk.mesh_source(i, att, self.skin) else { continue };
                    let image = self.image_of(i, if matches!(att.kind, AttachmentKind::LinkedMesh { .. }) { att } else { source });
                    out.push(Quad { slot: i, image, positions: self.world_vertices(sk, i, att), color });
                }
                _ => {}
            }
        }
        out
    }
}

pub(crate) fn vertices_of(att: &Attachment) -> Option<&Vertices> {
    match &att.kind {
        AttachmentKind::Mesh { vertices, .. } | AttachmentKind::BoundingBox { vertices } | AttachmentKind::Path { vertices, .. } | AttachmentKind::Clipping { vertices, .. } => Some(vertices),
        _ => None,
    }
}

fn deform_len(att: &Attachment) -> usize {
    vertices_of(att).map_or(0, Vertices::deform_len)
}

/// Samples component `c` of numeric keys at `time` (keys must not be empty).
fn sample_component(keys: &[Key], time: f64, c: usize) -> f64 {
    let comp = |k: &Key| k.values.get(c).copied().unwrap_or(f64::NAN);
    if time <= keys[0].time {
        return comp(&keys[0]);
    }
    let next = keys.partition_point(|k| k.time <= time);
    if next >= keys.len() {
        return comp(&keys[keys.len() - 1]);
    }
    let (a, b) = (&keys[next - 1], &keys[next]);
    let span = b.time - a.time;
    let va = comp(a);
    va + (comp(b) - va) * a.curve.ease(if span > 0.0 { (time - a.time) / span } else { 1.0 }, c)
}

/// Samples every component of numeric keys into `out`; false when there are no keys.
fn sample_into(keys: &[Key], time: f64, out: &mut Vec<f64>) -> bool {
    if keys.is_empty() {
        return false;
    }
    out.clear();
    if time <= keys[0].time {
        out.extend_from_slice(&keys[0].values);
        return true;
    }
    let next = keys.partition_point(|k| k.time <= time);
    if next >= keys.len() {
        out.extend_from_slice(&keys[keys.len() - 1].values);
        return true;
    }
    let (a, b) = (&keys[next - 1], &keys[next]);
    let span = b.time - a.time;
    let t = if span > 0.0 { (time - a.time) / span } else { 1.0 };
    for (i, &va) in a.values.iter().enumerate() {
        let vb = b.values.get(i).copied().unwrap_or(f64::NAN);
        out.push(lerp(va, vb, a.curve.ease(t, i)));
    }
    true
}

/// Discrete keys (names, modes): the value of the last key at or before `time` (the first key
/// before it).
fn sample_discrete<T: Copy>(keys: &[(f64, T)], time: f64) -> T {
    if time <= keys[0].0 {
        return keys[0].1;
    }
    let next = keys.partition_point(|k| k.0 <= time);
    keys[next.max(1) - 1].1
}

/// Deform deltas at `time`: each key's sparse values expanded, interpolated along its curve.
fn sample_deform(keys: &[DeformKey], time: f64, n: usize) -> Vec<f64> {
    let expand = |k: &DeformKey| {
        let mut d = vec![0.0; n];
        for (j, v) in k.vertices.iter().enumerate() {
            if k.offset + j < n {
                d[k.offset + j] = *v;
            }
        }
        d
    };
    let i = (keys.partition_point(|k| k.time <= time) as isize - 1).max(0) as usize;
    let a = &keys[i];
    let mut from = expand(a);
    let Some(b) = keys.get(i + 1) else { return from };
    if time <= a.time || a.curve == crate::curve::Curve::Stepped {
        return from;
    }
    let to = expand(b);
    let e = a.curve.ease((time - a.time) / (b.time - a.time), 0);
    for j in 0..n {
        from[j] += (to[j] - from[j]) * e;
    }
    from
}

/// Frame for sequence keys at `time`, or None before the first key.
fn sequence_index_at(keys: &[SequenceKey], time: f64, count: i64) -> Option<i64> {
    let mut k: Option<usize> = None;
    let mut delay = 0.0;
    for (i, key) in keys.iter().enumerate() {
        if key.time > time {
            break;
        }
        k = Some(i);
        if let Some(d) = key.delay {
            delay = d;
        }
    }
    let key = &keys[k?];
    let index = key.index;
    if key.mode == SequenceMode::Hold || count <= 1 {
        return Some(index.max(0).min(count - 1));
    }
    let steps = if delay > 0.0 { ((time - key.time) / delay + 1e-6).floor() as i64 } else { 0 };
    let (base, reverse) = match key.mode {
        SequenceMode::Once => (SequenceMode::Once, false),
        SequenceMode::Loop => (SequenceMode::Loop, false),
        SequenceMode::PingPong => (SequenceMode::PingPong, false),
        SequenceMode::OnceReverse => (SequenceMode::Once, true),
        SequenceMode::LoopReverse => (SequenceMode::Loop, true),
        SequenceMode::PingPongReverse => (SequenceMode::PingPong, true),
        SequenceMode::Hold => (SequenceMode::Hold, false),
    };
    let mut f = index + steps;
    match base {
        SequenceMode::Once => f = f.min(count - 1),
        SequenceMode::Loop => f %= count,
        SequenceMode::PingPong => {
            let period = 2 * (count - 1);
            f %= period;
            if f >= count {
                f = period - f;
            }
        }
        _ => {}
    }
    Some(if reverse { count - 1 - f } else { f })
}

/// Slot order for a draw order key: `offsets` move slots relative to their setup index.
pub fn apply_draw_order(count: usize, offsets: Option<&[(usize, i64)]>) -> Vec<usize> {
    let identity: Vec<usize> = (0..count).collect();
    let Some(offsets) = offsets.filter(|o| !o.is_empty()) else { return identity };
    let mut order: Vec<isize> = vec![-1; count];
    let mut unchanged: Vec<usize> = Vec::new();
    let mut original = 0usize;
    let mut sorted = offsets.to_vec();
    sorted.sort_by_key(|o| o.0);
    for (slot, offset) in sorted {
        if slot >= count {
            continue;
        }
        while original < slot {
            unchanged.push(original);
            original += 1;
        }
        let at = original as i64 + offset;
        if at >= 0 && (at as usize) < count && order[at as usize] == -1 {
            order[at as usize] = original as isize;
        } else {
            unchanged.push(original);
        }
        original += 1;
    }
    while original < count {
        unchanged.push(original);
        original += 1;
    }
    for i in (0..count).rev() {
        if order[i] == -1 {
            order[i] = unchanged.pop().map_or(-1, |v| v as isize);
        }
    }
    order.into_iter().map(|v| v.max(0) as usize).collect()
}

/// Child world transform for an inherit mode. Translation always goes through the full parent;
/// the linear part through the part of the parent the mode keeps.
fn inherit_world(parent: &Affine, local: &Affine, mode: Inherit) -> Affine {
    if mode == Inherit::Normal {
        return parent.mul(local);
    }
    let tx = parent.a * local.tx + parent.c * local.ty + parent.tx;
    let ty = parent.b * local.tx + parent.d * local.ty + parent.ty;
    let sx = parent.a.hypot(parent.b);
    let det = parent.determinant();
    let (pa, pb, pc, pd) = match mode {
        Inherit::OnlyTranslation => (1.0, 0.0, 0.0, 1.0),
        Inherit::NoRotationOrReflection => (sx, 0.0, 0.0, if sx > 1e-12 { det.abs() / sx } else { 0.0 }),
        Inherit::NoScale | Inherit::NoScaleOrReflection => {
            let ux = if sx > 1e-12 { parent.a / sx } else { 1.0 };
            let uy = if sx > 1e-12 { parent.b / sx } else { 0.0 };
            let flip = if mode == Inherit::NoScale && det < 0.0 { -1.0 } else { 1.0 };
            (ux, uy, -uy * flip, ux * flip)
        }
        Inherit::Normal => unreachable!(),
    };
    Affine::new(pa * local.a + pc * local.b, pb * local.a + pd * local.b, pa * local.c + pc * local.d, pb * local.c + pd * local.d, tx, ty)
}

/// The local transform that gives world transform `world` under `parent` and inherit `mode`.
fn local_from_world(parent: Option<&Affine>, world: &Affine, mode: Inherit) -> Transform {
    let Some(parent) = parent else { return world.decompose() };
    let (x, y) = parent.inverse().apply(world.tx, world.ty);
    let mut keep = inherit_world(parent, &Affine::IDENTITY, mode);
    keep.tx = 0.0;
    keep.ty = 0.0;
    let mut linear = keep.inverse().mul(&Affine::new(world.a, world.b, world.c, world.d, 0.0, 0.0));
    linear.tx = x;
    linear.ty = y;
    linear.decompose()
}

/// Rotates the linear part of `m` by `deg` degrees.
fn rotate_linear(m: &mut Affine, deg: f64) {
    if deg == 0.0 || deg.is_nan() {
        return;
    }
    let (cos, sin) = ((deg * DEG).cos(), (deg * DEG).sin());
    let (a, b, c, d) = (m.a, m.b, m.c, m.d);
    m.a = cos * a - sin * b;
    m.b = sin * a + cos * b;
    m.c = cos * c - sin * d;
    m.d = sin * c + cos * d;
}

fn local_property(t: &Transform, p: Property) -> f64 {
    match p {
        Property::X => t.x,
        Property::Y => t.y,
        Property::ScaleX => t.scale_x,
        Property::ScaleY => t.scale_y,
        Property::ShearY => t.shear_y,
        Property::Rotate => t.rotation,
    }
}

fn world_property(m: &Affine, p: Property) -> f64 {
    match p {
        Property::X => m.tx,
        Property::Y => m.ty,
        Property::ScaleX => m.a.hypot(m.b),
        Property::ScaleY => m.c.hypot(m.d),
        Property::ShearY => wrap_degrees(angle_of(m.c, m.d) - angle_of(m.a, m.b) - 90.0),
        Property::Rotate => angle_of(m.a, m.b),
    }
}

// ---- paths ----------------------------------------------------------------------------------------

const SEGMENTS: usize = 16;

/// A path from world vertices laid out as [in-handle, point, out-handle] per path point.
struct PathCurve {
    curves: Vec<[f64; 8]>,
    tables: Vec<[f64; SEGMENTS + 1]>,
    ends: Vec<f64>,
    length: f64,
    closed: bool,
    constant: bool,
}

impl PathCurve {
    fn build(v: &[f64], closed: bool, constant_speed: bool, lengths: &[f64]) -> Option<PathCurve> {
        let point_count = v.len() / 6;
        if point_count < 2 && !(closed && point_count >= 1) {
            return None;
        }
        let curve_count = if closed { point_count } else { point_count - 1 };
        let mut curves = Vec::with_capacity(curve_count);
        for i in 0..curve_count {
            let o = 6 * i;
            let next = if closed && i == point_count - 1 { 0 } else { o + 6 };
            curves.push([v[o + 2], v[o + 3], v[o + 4], v[o + 5], v[next], v[next + 1], v[next + 2], v[next + 3]]);
        }
        let tables: Vec<[f64; SEGMENTS + 1]> = curves
            .iter()
            .map(|cv| {
                let mut t = [0.0; SEGMENTS + 1];
                let (mut px, mut py) = (cv[0], cv[1]);
                for s in 1..=SEGMENTS {
                    let u = s as f64 / SEGMENTS as f64;
                    let x = cubic4(cv[0], cv[2], cv[4], cv[6], u);
                    let y = cubic4(cv[1], cv[3], cv[5], cv[7], u);
                    t[s] = t[s - 1] + (x - px).hypot(y - py);
                    px = x;
                    py = y;
                }
                t
            })
            .collect();
        let constant = constant_speed || lengths.is_empty();
        let mut ends: Vec<f64> = Vec::with_capacity(curve_count);
        if constant {
            let mut sum = 0.0;
            for t in &tables {
                sum += t[SEGMENTS];
                ends.push(sum);
            }
        } else {
            for i in 0..curve_count {
                let v = lengths.get(i).copied().or_else(|| if i > 0 { Some(ends[i - 1]) } else { None }).unwrap_or(0.0);
                ends.push(v);
            }
        }
        let length = ends.last().copied().unwrap_or(0.0);
        if length < EPSILON {
            return None;
        }
        Some(PathCurve { curves, tables, ends, length, closed, constant })
    }

    fn evaluate(&self, i: usize, u: f64) -> (f64, f64, f64) {
        let cv = &self.curves[i];
        let x = cubic4(cv[0], cv[2], cv[4], cv[6], u);
        let y = cubic4(cv[1], cv[3], cv[5], cv[7], u);
        let d = |p0: f64, p1: f64, p2: f64, p3: f64| 3.0 * (1.0 - u) * (1.0 - u) * (p1 - p0) + 6.0 * (1.0 - u) * u * (p2 - p1) + 3.0 * u * u * (p3 - p2);
        let mut dx = d(cv[0], cv[2], cv[4], cv[6]);
        let mut dy = d(cv[1], cv[3], cv[5], cv[7]);
        if dx.hypot(dy) < EPSILON {
            dx = cv[6] - cv[0];
            dy = cv[7] - cv[1];
        }
        (x, y, angle_of(dx, dy))
    }

    /// Point and tangent (degrees) at a distance along the path.
    fn at(&self, mut dist: f64) -> (f64, f64, f64) {
        if self.closed {
            dist %= self.length;
            if dist < 0.0 {
                dist += self.length;
            }
        } else if dist < 0.0 {
            let cv = &self.curves[0];
            let ang = angle_of(cv[2] - cv[0], cv[3] - cv[1]);
            return (cv[0] + (ang * DEG).cos() * dist, cv[1] + (ang * DEG).sin() * dist, ang);
        } else if dist > self.length {
            let cv = &self.curves[self.curves.len() - 1];
            let ang = angle_of(cv[6] - cv[4], cv[7] - cv[5]);
            let over = dist - self.length;
            return (cv[6] + (ang * DEG).cos() * over, cv[7] + (ang * DEG).sin() * over, ang);
        }
        let mut i = 0;
        while i < self.ends.len() - 1 && dist > self.ends[i] {
            i += 1;
        }
        let start = if i > 0 { self.ends[i - 1] } else { 0.0 };
        let span = self.ends[i] - start;
        let f = if span > EPSILON { (dist - start) / span } else { 0.0 };
        if !self.constant {
            return self.evaluate(i, f);
        }
        // Constant speed: invert the arc length table.
        let t = &self.tables[i];
        let target = f * t[SEGMENTS];
        let mut s = 1;
        while s < SEGMENTS && t[s] < target {
            s += 1;
        }
        let seg = t[s] - t[s - 1];
        let u = (s as f64 - 1.0 + if seg > EPSILON { (target - t[s - 1]) / seg } else { 0.0 }) / SEGMENTS as f64;
        self.evaluate(i, u)
    }
}
