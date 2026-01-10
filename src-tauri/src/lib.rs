// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command

mod ssh_client;
mod config_manager;

use config_manager::ConfigManager;
use std::sync::Mutex;

// アプリケーション状態
pub struct AppState {
    config_manager: Mutex<ConfigManager>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        // .plugin(tauri_plugin_dialog::init()) // 一時的に無効化
        .manage(AppState {
            config_manager: Mutex::new(
                ConfigManager::new().expect("設定管理の初期化に失敗しました")
            ),
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}