// SPDX-License-Identifier: MIT OR Apache-2.0
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// The file the app was started with (`Rigby2D.exe walk.rigby`, or a double-clicked .rigby file),
/// as an absolute path. The editor opens it.
#[tauri::command]
fn launch_file() -> Option<String> {
    if render_mode() {
        return None;
    }
    let arg = std::env::args_os().skip(1).find(|a| !a.to_string_lossy().starts_with('-'))?;
    let path = std::path::PathBuf::from(arg);
    let path = if path.is_absolute() { path } else { std::env::current_dir().ok()?.join(path) };
    path.is_file().then(|| path.to_string_lossy().into_owned())
}

/// Windowless render mode: `Rigby2D --render <project> --out <file> [options]` (the options of
/// `rigby render`). The app renders in a hidden window and exits; no editor window opens. Every
/// launch is its own process (there is no single-instance handoff), so an editor that is already
/// open is left alone.
fn render_mode() -> bool {
    std::env::args().skip(1).any(|a| a == "--render")
}

/// The render mode's arguments (after `--render`) and the folder they are relative to.
#[tauri::command]
fn render_args() -> serde_json::Value {
    let args: Vec<String> = std::env::args().skip_while(|a| a != "--render").skip(1).collect();
    let cwd = std::env::current_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    serde_json::json!({ "cwd": cwd, "args": args })
}

/// One line of the render mode's report (JSON, from rendermode.js) on standard output.
#[tauri::command]
fn render_report(line: String) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

/// Ends the render mode with an exit code (0 done, 1 failed).
#[tauri::command]
fn render_exit(app: tauri::AppHandle, code: i32) {
    app.exit(code);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![launch_file, render_args, render_report, render_exit])
        .setup(|app| {
            if render_mode() {
                // A hidden window with its own WebView data folder: its own browser process, which
                // can run on the discrete GPU next to an editor that is already open.
                let data = app.path().app_local_data_dir()?.join("render-webview");
                WebviewWindowBuilder::new(app, "render", WebviewUrl::App("render.html".into()))
                    .title("Rigby2D render")
                    .visible(false)
                    .focused(false)
                    .skip_taskbar(true)
                    .data_directory(data)
                    .additional_browser_args("--force_high_performance_gpu --ignore-gpu-blocklist --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection")
                    .build()?;
            } else {
                // The editor and splash windows (tauri.conf.json, created here so render mode has none).
                for config in app.config().app.windows.clone() {
                    WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Rigby2D");
}
