// SPDX-License-Identifier: MIT OR Apache-2.0
//! Turns a posed skeleton into textured triangle batches for an engine to draw: regions and meshes
//! in draw order, mapped into atlas pages, masked by clipping attachments, split into batches by
//! page and blend mode. Matches the reference WebGL renderer (src/webgl/renderer.js).

use crate::atlas::{Atlas, RegionUv};
use crate::clipping::Clipper;
use crate::model::{AttachmentKind, Blend, NameId, SkeletonData};
use crate::pose::Pose;

/// Atlas regions by skeleton image name id.
pub struct RegionLookup {
    regions: Vec<Option<RegionUv>>,
}

impl RegionLookup {
    pub fn new(sk: &SkeletonData, atlas: &Atlas) -> RegionLookup {
        let map = atlas.lookup();
        RegionLookup { regions: sk.names.iter().map(|n| map.get(n).copied()).collect() }
    }

    pub fn get(&self, image: NameId) -> Option<&RegionUv> {
        self.regions.get(image as usize).and_then(Option::as_ref)
    }

    /// Images the skeleton's region and mesh attachments use that have no atlas region.
    pub fn missing(&self, sk: &SkeletonData) -> Vec<String> {
        let mut used = Vec::new();
        for (slot_index, slot) in sk.slots.iter().enumerate() {
            for a in slot.attachments.iter().chain(sk.skins.iter().flat_map(|s| s.slots.iter().filter(|e| e.0 == slot_index).flat_map(|e| e.1.iter()))) {
                if matches!(a.kind, AttachmentKind::Region { .. } | AttachmentKind::Mesh { .. } | AttachmentKind::LinkedMesh { .. }) {
                    match &a.sequence {
                        Some(seq) => used.extend(seq.frames.iter().copied()),
                        None => used.push(a.image),
                    }
                }
            }
        }
        used.sort_unstable();
        used.dedup();
        used.into_iter().filter(|&i| self.get(i).is_none()).map(|i| sk.name(i).to_string()).collect()
    }
}

/// Triangles that share an atlas page and a blend mode, in draw order.
#[derive(Clone, Debug, Default)]
pub struct Batch {
    /// Which skeleton's atlas `page` belongs to: the `source` given to `append` (0 for `build`).
    pub source: usize,
    pub page: usize,
    pub blend: Blend,
    /// World positions (x, y), Y up.
    pub positions: Vec<[f32; 2]>,
    /// Page UVs, 0..1 with v down.
    pub uvs: Vec<[f32; 2]>,
    /// Light color (straight alpha): slot tint × attachment color.
    pub colors: Vec<[f32; 4]>,
    /// Dark color for two-color tint (rgb) and whether the slot has one (a = 1).
    pub darks: Vec<[f32; 4]>,
    pub indices: Vec<u32>,
}

/// Reusable geometry output (its buffers are kept between frames).
#[derive(Default)]
pub struct RenderOutput {
    pub batches: Vec<Batch>,
    used: usize,
    source: usize,
    scratch_p: Vec<f64>,
    scratch_uv: Vec<f64>,
    clip_p: Vec<f64>,
    clip_uv: Vec<f64>,
    clip_t: Vec<u32>,
}

const QUAD: [u32; 6] = [0, 1, 2, 0, 2, 3];

impl RenderOutput {
    /// Batches filled by the last `build`.
    pub fn batches(&self) -> &[Batch] {
        &self.batches[..self.used]
    }

    /// Builds the geometry of `pose`. `tint` multiplies every color.
    pub fn build(&mut self, sk: &SkeletonData, pose: &Pose, lookup: &RegionLookup, tint: [f64; 4]) {
        self.clear();
        self.append(sk, pose, lookup, tint, &pose.draw_order, 0);
    }

    /// Empties the output before a series of `append`s.
    pub fn clear(&mut self) {
        self.used = 0;
    }

    /// Adds the geometry of some slots of `pose` (`slots`, in draw order) after what is already
    /// built. Several skeletons can be layered this way (a scene's stage and characters); `source`
    /// tells their atlases apart in the batches.
    pub fn append(&mut self, sk: &SkeletonData, pose: &Pose, lookup: &RegionLookup, tint: [f64; 4], slots: &[usize], source: usize) {
        self.source = source;
        let mut clipper: Option<Clipper> = None;
        let mut clip_end: Option<usize> = None;
        for &i in slots {
            let att = pose.slot_attachment(sk, i);
            if let Some(att) = att {
                match &att.kind {
                    AttachmentKind::Clipping { end, .. } => {
                        clipper = Some(Clipper::new(&pose.world_vertices(sk, i, att)));
                        clip_end = if *end == Some(i) { None } else { *end }; // ending at its own slot: to the end
                    }
                    AttachmentKind::Region { .. } | AttachmentKind::Mesh { .. } | AttachmentKind::LinkedMesh { .. } => {
                        self.draw_attachment(sk, pose, i, att, lookup, tint, clipper.as_ref());
                    }
                    _ => {}
                }
            }
            if clipper.is_some() && clip_end == Some(i) {
                clipper = None;
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_attachment(&mut self, sk: &SkeletonData, pose: &Pose, i: usize, att: &crate::model::Attachment, lookup: &RegionLookup, tint: [f64; 4], clipper: Option<&Clipper>) {
        let is_region = matches!(att.kind, AttachmentKind::Region { .. });
        let source = if is_region { Some(att) } else { sk.mesh_source(i, att, pose.skin) };
        let Some(source) = source else { return };
        let image = pose.image_of(i, if matches!(att.kind, AttachmentKind::Mesh { .. }) { source } else { att });
        let Some(entry) = lookup.get(image) else { return };
        let c = pose.color[i];
        let ac = att.color;
        let light = [(c[0] * ac[0] * tint[0]) as f32, (c[1] * ac[1] * tint[1]) as f32, (c[2] * ac[2] * tint[2]) as f32, (c[3] * ac[3] * tint[3]) as f32];
        let dark = match pose.dark[i] {
            Some(d) => [d[0] as f32, d[1] as f32, d[2] as f32, 1.0],
            None => [0.0, 0.0, 0.0, 0.0],
        };
        let blend = sk.slots[i].blend;
        let mut positions = std::mem::take(&mut self.scratch_p);
        let mut uvs = std::mem::take(&mut self.scratch_uv);
        positions.clear();
        uvs.clear();
        let triangles: &[u32] = match &att.kind {
            AttachmentKind::Region { offset, width, height } => {
                // The packed (trimmed) part of the image, as corners of the attachment quad.
                let m = pose.attachment_world(sk, i, offset);
                let [u0, v0, u1, v1] = entry.trim;
                let (hw, hh) = (width / 2.0, height / 2.0);
                for (u, v) in [(u0, v0), (u1, v0), (u1, v1), (u0, v1)] {
                    let lx = -hw + u * width;
                    let ly = hh - v * height;
                    let p = m.apply(lx, ly);
                    positions.extend_from_slice(&[p.0, p.1]);
                    let t = entry.map(u, v);
                    uvs.extend_from_slice(&[t.0, t.1]);
                }
                &QUAD
            }
            _ => {
                pose.world_vertices_into(sk, i, att, &mut positions);
                let AttachmentKind::Mesh { uvs: mesh_uvs, triangles, .. } = &source.kind else {
                    self.scratch_p = positions;
                    self.scratch_uv = uvs;
                    return;
                };
                for k in 0..positions.len() / 2 {
                    let t = entry.map(mesh_uvs.get(2 * k).copied().unwrap_or(0.0), mesh_uvs.get(2 * k + 1).copied().unwrap_or(0.0));
                    uvs.extend_from_slice(&[t.0, t.1]);
                }
                triangles
            }
        };
        if let Some(clipper) = clipper {
            let (mut cp, mut cu, mut ct) = (std::mem::take(&mut self.clip_p), std::mem::take(&mut self.clip_uv), std::mem::take(&mut self.clip_t));
            cp.clear();
            cu.clear();
            ct.clear();
            clipper.clip(&positions, &uvs, triangles, &mut cp, &mut cu, &mut ct);
            if !ct.is_empty() {
                self.emit(entry.page, blend, &cp, &cu, &ct, light, dark);
            }
            self.clip_p = cp;
            self.clip_uv = cu;
            self.clip_t = ct;
        } else {
            self.emit(entry.page, blend, &positions, &uvs, triangles, light, dark);
        }
        self.scratch_p = positions;
        self.scratch_uv = uvs;
    }

    #[allow(clippy::too_many_arguments)]
    fn emit(&mut self, page: usize, blend: Blend, positions: &[f64], uvs: &[f64], triangles: &[u32], light: [f32; 4], dark: [f32; 4]) {
        let continues = self.used > 0 && {
            let b = &self.batches[self.used - 1];
            b.source == self.source && b.page == page && b.blend == blend
        };
        if !continues {
            if self.batches.len() == self.used {
                self.batches.push(Batch::default());
            }
            let b = &mut self.batches[self.used];
            b.source = self.source;
            b.page = page;
            b.blend = blend;
            b.positions.clear();
            b.uvs.clear();
            b.colors.clear();
            b.darks.clear();
            b.indices.clear();
            self.used += 1;
        }
        let b = &mut self.batches[self.used - 1];
        let base = b.positions.len() as u32;
        for k in 0..positions.len() / 2 {
            b.positions.push([positions[2 * k] as f32, positions[2 * k + 1] as f32]);
            b.uvs.push([uvs[2 * k] as f32, uvs[2 * k + 1] as f32]);
            b.colors.push(light);
            b.darks.push(dark);
        }
        b.indices.extend(triangles.iter().map(|t| base + t));
    }
}
