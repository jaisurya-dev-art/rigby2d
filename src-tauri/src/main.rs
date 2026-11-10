// SPDX-License-Identifier: MIT OR Apache-2.0
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// The file the app was started with (`Rigby2D.exe walk.rigby`, or a double-clicked .rigby file),
/// as an absolute path. The editor opens it.
#[tauri::command]
fn launch_file() -> Option<String> {
    let arg = std::env::args_os().skip(1).find(|a| !a.to_string_lossy().starts_with('-'))?;
    let path = std::path::PathBuf::from(arg);
    let path = if path.is_absolute() { path } else { std::env::current_dir().ok()?.join(path) };
    path.is_file().then(|| path.to_string_lossy().into_owned())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![launch_file])
        .run(tauri::generate_context!())
        .expect("error while running Rigby2D");
}
