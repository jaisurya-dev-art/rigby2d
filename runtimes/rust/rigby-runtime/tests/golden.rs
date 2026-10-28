// SPDX-License-Identifier: MIT OR Apache-2.0
//! Golden tests: the Rust runtime must reproduce the JavaScript runtime (src/core) frame by frame.
//! Golden files come from `tests/golden/generate.mjs`; `tests/golden/*.golden.json` are checked
//! in, and more can be given with the `RIGBY_GOLDEN_DIR` environment variable.

use rigby_runtime::json::Json;
use rigby_runtime::scene::{load_scene, scene_draw_list};
use rigby_runtime::{load_skeleton, AnimationState, Pose, SkeletonData, StateEventKind};
use std::path::{Path, PathBuf};

const DT: f64 = 1.0 / 30.0;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().unwrap()
}

fn golden_files() -> Vec<PathBuf> {
    let mut dirs = vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden")];
    if let Ok(extra) = std::env::var("RIGBY_GOLDEN_DIR") {
        dirs.push(PathBuf::from(extra));
    }
    let mut files = Vec::new();
    for dir in dirs {
        for e in std::fs::read_dir(&dir).unwrap_or_else(|_| panic!("cannot read {}", dir.display())) {
            let p = e.unwrap().path();
            if p.to_string_lossy().ends_with(".golden.json") {
                files.push(p);
            }
        }
    }
    files.sort();
    files
}

struct Worst {
    world: f64,
    positions: f64,
    color: f64,
    at: String,
}

fn close(a: f64, b: f64, rel: f64) -> f64 {
    if a == b || (a.is_nan() && b.is_nan()) {
        return 0.0;
    }
    (a - b).abs() / 1f64.max(a.abs()).max(b.abs()) / rel
}

/// Plays one scenario the way generate.mjs does, returning per-frame state.
fn replay(sk: &SkeletonData, scenario: &Json, worst: &mut Worst, label: &str) -> Vec<String> {
    let mut problems = Vec::new();
    let kind = scenario.str_or("kind", "");
    let animation = scenario.str_or("animation", "");
    let mut pose = Pose::new(sk);
    pose.skin = scenario.get("skin").as_str().and_then(|s| sk.find_skin(s));
    let mut state = AnimationState::new();
    let frames = scenario.get("frames").as_array();
    let (steps, every) = match kind {
        "setup" => (1, 1),
        "mix" => (45, 2),
        "skin" => (20, 5),
        _ => (frames.len() * 3, 3),
    };
    let names: Vec<&str> = animation.split(['>', '+']).collect();
    let setup = |state: &mut AnimationState, i: usize| match kind {
        "loop" | "skin" if i == 0 => {
            state.set_animation(sk, 0, animation, true, 0.0);
        }
        "mix" => {
            if i == 0 {
                state.set_animation(sk, 0, names[0], true, 0.0);
            }
            if i == 12 {
                state.set_animation(sk, 0, names[1], true, 0.25);
                if state.set_animation(sk, 1, names[2], false, 0.0).is_some() {
                    state.current_mut(1).unwrap().alpha = 0.5;
                }
                state.add_animation(sk, 0, names[0], true, 0.2, Some(0.5));
            }
        }
        _ => {}
    };
    setup(&mut state, 0);
    let mut events: Vec<String> = Vec::new();
    let mut f = 0;
    for i in 1..=steps {
        setup(&mut state, i);
        state.update(sk, DT);
        state.apply(sk, &mut pose);
        for e in state.drain_events() {
            let name = &sk.animations[e.animation].name;
            match e.kind {
                StateEventKind::Event(ev) => events.push(format!("{}:{}@{}", e.track, ev.name, js_number(ev.time))),
                StateEventKind::Complete => events.push(format!("{}:complete:{}", e.track, name)),
                _ => {}
            }
        }
        if i % every != 0 {
            continue;
        }
        let Some(expected) = frames.get(f) else { break };
        f += 1;
        let at = format!("{label} {kind} '{animation}' frame {f}");
        let world: Vec<f64> = expected.get("world").as_array().iter().map(|v| v.as_f64().unwrap_or(f64::NAN)).collect();
        for (b, m) in pose.world.iter().enumerate() {
            for (k, v) in [m.a, m.b, m.c, m.d, m.tx, m.ty].into_iter().enumerate() {
                let e = close(v, world[b * 6 + k], 1.0);
                if e > worst.world {
                    worst.world = e;
                    worst.at = format!("{at}, bone {} value {k}: rust {v} js {}", sk.bones[b].name, world[b * 6 + k]);
                }
            }
        }
        let order: Vec<usize> = expected.get("drawOrder").as_array().iter().map(|v| v.as_f64().unwrap() as usize).collect();
        if order != pose.draw_order {
            problems.push(format!("{at}: draw order differs"));
        }
        let quads = pose.quads(sk);
        let expected_quads = expected.get("quads").as_array();
        if quads.len() != expected_quads.len() {
            problems.push(format!("{at}: {} drawables, expected {}", quads.len(), expected_quads.len()));
            continue;
        }
        for (q, e) in quads.iter().zip(expected_quads) {
            if q.slot != e.num("slot", -1.0) as usize || sk.name(q.image) != e.str_or("image", "") {
                problems.push(format!("{at}: slot {} shows '{}', expected slot {} '{}'", sk.slots[q.slot].name, sk.name(q.image), e.num("slot", -1.0), e.str_or("image", "")));
                continue;
            }
            let pos = e.get("positions").as_array();
            if pos.len() != q.positions.len() {
                problems.push(format!("{at}: slot {} has {} positions, expected {}", sk.slots[q.slot].name, q.positions.len(), pos.len()));
                continue;
            }
            for (k, v) in q.positions.iter().enumerate() {
                let err = close(*v, pos[k].as_f64().unwrap_or(f64::NAN), 1.0);
                if err > worst.positions {
                    worst.positions = err;
                }
            }
            for (k, v) in q.color.iter().enumerate() {
                let err = close(*v, e.get("color").as_array()[k].as_f64().unwrap_or(f64::NAN), 1.0);
                if err > worst.color {
                    worst.color = err;
                }
            }
        }
        let expected_events: Vec<String> = expected.get("events").as_array().iter().map(|v| v.as_str().unwrap_or("").to_string()).collect();
        if expected_events != events {
            problems.push(format!("{at}: events {events:?}, expected {expected_events:?}"));
        }
        events.clear();
    }
    problems
}

/// Formats a number like JavaScript's `String(n)` for the values events use.
fn js_number(v: f64) -> String {
    if v == v.trunc() && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

#[test]
fn matches_the_javascript_runtime() {
    let root = repo_root();
    let files = golden_files();
    assert!(!files.is_empty(), "no golden files");
    let mut failures = Vec::new();
    for file in files {
        let golden = Json::parse(&std::fs::read_to_string(&file).unwrap()).unwrap();
        if golden.has("scene") {
            continue; // see scenes_match_the_javascript_runtime
        }
        let label = golden.str_or("label", "?").to_string();
        let source = root.join(golden.str_or("file", ""));
        let sk = match load_skeleton(&std::fs::read(&source).unwrap_or_else(|_| panic!("missing {}", source.display()))) {
            Ok(sk) => sk,
            Err(e) => {
                failures.push(format!("{label}: load failed: {e}"));
                continue;
            }
        };
        let mut worst = Worst { world: 0.0, positions: 0.0, color: 0.0, at: String::new() };
        let mut problems = Vec::new();
        for scenario in golden.get("scenarios").as_array() {
            problems.extend(replay(&sk, scenario, &mut worst, &label));
        }
        println!("{label}: max relative error world {:.2e}, positions {:.2e}, color {:.2e}", worst.world, worst.positions, worst.color);
        // Tolerances: float operations happen in a slightly different order than in JavaScript.
        if worst.world > 1e-6 {
            failures.push(format!("{label}: world error {:.2e} at {}", worst.world, worst.at));
        }
        if worst.positions > 1e-6 || worst.color > 1e-9 {
            failures.push(format!("{label}: drawable error positions {:.2e}, color {:.2e}", worst.positions, worst.color));
        }
        for p in problems.iter().take(8) {
            failures.push(p.clone());
        }
        if problems.len() > 8 {
            failures.push(format!("{label}: … {} more problems", problems.len() - 8));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

/// Largest relative difference between a pose's world matrices and recorded ones.
fn world_error(pose: &Pose, expected: &Json) -> (f64, usize) {
    let world: Vec<f64> = expected.as_array().iter().map(|v| v.as_f64().unwrap_or(f64::NAN)).collect();
    let mut worst = (0.0, 0);
    for (b, m) in pose.world.iter().enumerate() {
        for (k, v) in [m.a, m.b, m.c, m.d, m.tx, m.ty].into_iter().enumerate() {
            let e = close(v, world.get(b * 6 + k).copied().unwrap_or(f64::NAN), 1.0);
            if e > worst.0 {
                worst = (e, b);
            }
        }
    }
    worst
}

#[test]
fn scenes_match_the_javascript_runtime() {
    let root = repo_root();
    let mut failures = Vec::new();
    let mut checked = 0;
    for file in golden_files() {
        let golden = Json::parse(&std::fs::read_to_string(&file).unwrap()).unwrap();
        if !golden.has("scene") {
            continue;
        }
        checked += 1;
        let label = golden.str_or("label", "?").to_string();
        let manifest = root.join(golden.str_or("scene", ""));
        let dir = manifest.parent().unwrap().to_path_buf();
        let mut player = match load_scene(&std::fs::read(&manifest).unwrap_or_else(|_| panic!("missing {}", manifest.display())), |f| std::fs::read(dir.join(f))) {
            Ok(p) => p,
            Err(e) => {
                failures.push(format!("{label}: load failed: {e}"));
                continue;
            }
        };
        let (mut worst_world, mut worst_pos, mut at) = (0.0f64, 0.0f64, String::new());
        for shot in golden.get("shots").as_array() {
            let name = shot.str_or("shot", "");
            player.play(name, true);
            let frames = shot.get("frames").as_array();
            let mut f = 0;
            for i in 1.. {
                player.update(DT);
                if i % 3 != 0 {
                    continue;
                }
                let Some(expected) = frames.get(f) else { break };
                f += 1;
                let here = format!("{label} '{name}' frame {f}");
                if close(player.time, expected.num("time", f64::NAN), 1.0) > 1e-9 {
                    failures.push(format!("{here}: time {} expected {}", player.time, expected.num("time", f64::NAN)));
                }
                let (e, b) = world_error(&player.pose, expected.get("stage"));
                if e > worst_world {
                    worst_world = e;
                    at = format!("{here}, stage bone {}", player.stage.bones[b].name);
                }
                let layers: Vec<(f64, f64)> = scene_draw_list(&player.stage, &player.scene, &player.pose).iter().map(|l| (l.slot as f64, l.actor.map_or(-1.0, |a| a as f64))).collect();
                let want: Vec<(f64, f64)> = expected.get("layers").as_array().iter().map(|l| (l.as_array()[0].as_f64().unwrap(), l.as_array()[1].as_f64().unwrap())).collect();
                if layers != want {
                    failures.push(format!("{here}: draw list {layers:?}, expected {want:?}"));
                }
                for a in expected.get("actors").as_array() {
                    let id = a.str_or("id", "");
                    let Some(c) = player.characters.iter().find(|c| c.id == id) else {
                        failures.push(format!("{here}: no character '{id}'"));
                        continue;
                    };
                    let (e, b) = world_error(&c.pose, a.get("world"));
                    if e > worst_world {
                        worst_world = e;
                        at = format!("{here}, {id} bone {}", c.data.bones[b].name);
                    }
                    if a.get("quads").is_null() {
                        continue;
                    }
                    let quads = c.pose.quads(&c.data);
                    let want = a.get("quads").as_array();
                    if quads.len() != want.len() {
                        failures.push(format!("{here}: {id} has {} drawables, expected {}", quads.len(), want.len()));
                        continue;
                    }
                    for (q, w) in quads.iter().zip(want) {
                        if c.data.name(q.image) != w.str_or("image", "") {
                            failures.push(format!("{here}: {id} slot {} shows '{}', expected '{}'", q.slot, c.data.name(q.image), w.str_or("image", "")));
                            continue;
                        }
                        for (k, v) in q.positions.iter().enumerate() {
                            worst_pos = worst_pos.max(close(*v, w.get("positions").as_array().get(k).and_then(|x| x.as_f64()).unwrap_or(f64::NAN), 1.0));
                        }
                    }
                }
            }
            if f != frames.len() {
                failures.push(format!("{label} '{name}': {f} of {} frames played", frames.len()));
            }
        }
        println!("{label}: max relative error world {worst_world:.2e} ({at}), positions {worst_pos:.2e}");
        if worst_world > 1e-6 || worst_pos > 1e-6 {
            failures.push(format!("{label}: world error {worst_world:.2e} at {at}, positions {worst_pos:.2e}"));
        }
    }
    assert!(checked > 0, "no scene golden files");
    failures.truncate(12);
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}
