// SPDX-License-Identifier: MIT OR Apache-2.0
//! Rigby2D runtime in Rust: loads skeleton JSON (3.8, 4.x) and binary `.skel` (4.3) exports with
//! their `.atlas`, and evaluates poses, IK, transform, path, physics and slider constraints, image
//! sequences, clipping and animation playback with tracks, crossfades, queues and events. It
//! matches the JavaScript runtime in `src/core` and has no dependencies.
//!
//! ```no_run
//! use rigby_runtime::{load_skeleton, AnimationState, Pose};
//! let data = load_skeleton(&std::fs::read("hero.skel").unwrap()).unwrap();
//! let mut pose = Pose::new(&data);
//! let mut state = AnimationState::new();
//! state.play(&data, "walk", true, 0.2);
//! state.update(&data, 1.0 / 60.0);
//! state.apply(&data, &mut pose);
//! ```

pub mod atlas;
pub mod binary;
pub mod clipping;
pub mod curve;
pub mod json;
pub mod math;
pub mod model;
pub mod pose;
pub mod reader;
pub mod render;
pub mod scene;
pub mod state;

pub use atlas::Atlas;
pub use model::SkeletonData;
pub use pose::Pose;
pub use reader::LoadError;
pub use render::{Batch, RegionLookup, RenderOutput};
pub use scene::{load_scene, Scene, ScenePlayer};
pub use state::{AnimationState, StateEvent, StateEventKind};

/// Loads skeleton data from file bytes: binary `.skel` or skeleton JSON.
pub fn load_skeleton(bytes: &[u8]) -> Result<SkeletonData, LoadError> {
    let json = if binary::is_skeleton_binary(bytes) {
        binary::read_skeleton_binary(bytes)?
    } else {
        let text = std::str::from_utf8(bytes).map_err(|_| LoadError("the file is neither a binary skeleton nor UTF-8 JSON".into()))?;
        json::Json::parse(text).map_err(|e| LoadError(format!("invalid JSON: {e}")))?
    };
    reader::read_skeleton_json(&json)
}
