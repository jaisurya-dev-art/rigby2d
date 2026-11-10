// SPDX-License-Identifier: MIT OR Apache-2.0
//! The Rust runtime for the web: a `wasm32-unknown-unknown` module with a plain C ABI (no
//! wasm-bindgen). JavaScript loads a skeleton and its atlas, makes instances, plays animations and
//! calls `inst_update`, which poses the skeleton, builds its draw batches and returns a table
//! describing them; the vertex data stays in linear memory, where JavaScript reads it in place.
//!
//! Batch table (u32 words): count, then per batch `TABLE_STRIDE` words: page, blend, positions
//! pointer, uvs pointer, vertex count, indices pointer, index count, light rgba (4 x f32 bits),
//! dark rgba (4 x f32 bits; a = 1 when the slot has a dark color). Positions are world x, y with
//! Y up (f32 pairs), UVs page coordinates (f32 pairs), indices u32 relative to the batch. Every
//! batch has a single color, so it maps to one tinted mesh.

// The exports take raw handles and buffers from JavaScript, which is the only caller.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

use rigby_runtime::{load_skeleton, AnimationState, Atlas, Pose, RegionLookup, RenderOutput, SkeletonData};

pub const TABLE_STRIDE: usize = 15;

pub struct Data {
    pub sk: SkeletonData,
    pub lookup: RegionLookup,
}

pub struct Instance {
    data: *const Data,
    pub pose: Pose,
    pub state: AnimationState,
    pub out: RenderOutput,
    table: Vec<u32>,
    bone: [f64; 6],
}

static mut ERROR: String = String::new();

fn str_arg<'a>(ptr: *const u8, len: usize) -> &'a str {
    if len == 0 {
        return "";
    }
    // SAFETY: JavaScript passes a buffer it wrote with `alloc`.
    std::str::from_utf8(unsafe { std::slice::from_raw_parts(ptr, len) }).unwrap_or("")
}

fn inst<'a>(h: *mut Instance) -> &'a mut Instance {
    // SAFETY: handles come from `inst_new` and are used only until `inst_free`.
    unsafe { &mut *h }
}

fn data_of<'a>(i: &Instance) -> &'a Data {
    // SAFETY: data outlives its instances (JavaScript frees the instances first).
    unsafe { &*i.data }
}

/// Allocates `len` bytes for JavaScript to write into.
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    // SAFETY: `ptr` came from `alloc(len)`.
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len.max(1))) }
}

/// The last error message (UTF-8): its pointer, and its length from `error_len`.
#[no_mangle]
pub extern "C" fn error_ptr() -> *const u8 {
    // SAFETY: the module is single-threaded.
    unsafe { (&*std::ptr::addr_of!(ERROR)).as_ptr() }
}
#[no_mangle]
pub extern "C" fn error_len() -> usize {
    // SAFETY: the module is single-threaded.
    unsafe { (&*std::ptr::addr_of!(ERROR)).len() }
}

/// Loads a skeleton (.skel or JSON bytes) with its atlas text. Returns a data handle, or null (see `error_ptr`).
#[no_mangle]
pub extern "C" fn data_load(skel: *const u8, skel_len: usize, atlas: *const u8, atlas_len: usize) -> *mut Data {
    // SAFETY: JavaScript passes a buffer it wrote with `alloc`.
    let bytes = unsafe { std::slice::from_raw_parts(skel, skel_len) };
    match load_skeleton(bytes) {
        Ok(sk) => {
            let lookup = RegionLookup::new(&sk, &Atlas::parse(str_arg(atlas, atlas_len)));
            Box::into_raw(Box::new(Data { sk, lookup }))
        }
        Err(e) => {
            // SAFETY: the module is single-threaded.
            unsafe { *std::ptr::addr_of_mut!(ERROR) = e.0 };
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "C" fn data_free(d: *mut Data) {
    // SAFETY: `d` came from `data_load`.
    unsafe { drop(Box::from_raw(d)) }
}

#[no_mangle]
pub extern "C" fn inst_new(d: *const Data) -> *mut Instance {
    // SAFETY: `d` came from `data_load`.
    let data = unsafe { &*d };
    let mut out = RenderOutput::default();
    out.split_colors = true;
    Box::into_raw(Box::new(Instance { data: d, pose: Pose::new(&data.sk), state: AnimationState::new(), out, table: Vec::new(), bone: [0.0; 6] }))
}

#[no_mangle]
pub extern "C" fn inst_free(h: *mut Instance) {
    // SAFETY: `h` came from `inst_new`.
    unsafe { drop(Box::from_raw(h)) }
}

/// Plays animation `name` on `track`. Returns 0 when there is no such animation.
#[no_mangle]
pub extern "C" fn inst_set_animation(h: *mut Instance, track: usize, name: *const u8, name_len: usize, looping: u32, mix: f64) -> u32 {
    let i = inst(h);
    i.state.set_animation(&data_of(i).sk, track, str_arg(name, name_len), looping != 0, mix).is_some() as u32
}

/// Queues animation `name` on `track` (`delay` NaN: when the current one ends).
#[no_mangle]
pub extern "C" fn inst_add_animation(h: *mut Instance, track: usize, name: *const u8, name_len: usize, looping: u32, mix: f64, delay: f64) -> u32 {
    let i = inst(h);
    let delay = if delay.is_nan() { None } else { Some(delay) };
    i.state.add_animation(&data_of(i).sk, track, str_arg(name, name_len), looping != 0, mix, delay).is_some() as u32
}

/// Stops every track and returns to the setup pose.
#[no_mangle]
pub extern "C" fn inst_stop(h: *mut Instance) {
    let i = inst(h);
    i.state.stop();
    i.pose.set_to_setup(&data_of(i).sk);
}

/// Sets the skin by name (empty = default skin). Returns 0 when there is no such skin.
#[no_mangle]
pub extern "C" fn inst_set_skin(h: *mut Instance, name: *const u8, name_len: usize) -> u32 {
    let i = inst(h);
    let sk = &data_of(i).sk;
    let skin = if name_len == 0 { None } else { sk.find_skin(str_arg(name, name_len)) };
    if name_len != 0 && skin.is_none() {
        return 0;
    }
    i.pose.skin = skin;
    i.pose.set_to_setup(sk);
    1
}

/// Advances by `dt` seconds, poses, builds the draw batches and returns the batch table.
#[no_mangle]
pub extern "C" fn inst_update(h: *mut Instance, dt: f64) -> *const u32 {
    let i = inst(h);
    let data = data_of(i);
    i.state.update(&data.sk, dt);
    i.state.apply(&data.sk, &mut i.pose);
    i.out.build(&data.sk, &i.pose, &data.lookup, [1.0; 4]);
    i.table.clear();
    i.table.push(i.out.batches().len() as u32);
    for b in i.out.batches() {
        let l = b.colors.first().copied().unwrap_or([1.0; 4]);
        let d = b.darks.first().copied().unwrap_or([0.0; 4]);
        i.table.extend_from_slice(&[
            b.page as u32,
            b.blend as u32,
            b.positions.as_ptr() as usize as u32,
            b.uvs.as_ptr() as usize as u32,
            b.positions.len() as u32,
            b.indices.as_ptr() as usize as u32,
            b.indices.len() as u32,
            l[0].to_bits(),
            l[1].to_bits(),
            l[2].to_bits(),
            l[3].to_bits(),
            d[0].to_bits(),
            d[1].to_bits(),
            d[2].to_bits(),
            d[3].to_bits(),
        ]);
    }
    i.table.as_ptr()
}

/// World transform of bone `index` (a, b, c, d, tx, ty as f64), or null.
#[no_mangle]
pub extern "C" fn inst_bone_world(h: *mut Instance, index: usize) -> *const f64 {
    let i = inst(h);
    let Some(w) = i.pose.world.get(index) else { return std::ptr::null() };
    i.bone = [w.a, w.b, w.c, w.d, w.tx, w.ty];
    i.bone.as_ptr()
}
