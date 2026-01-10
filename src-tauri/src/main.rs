// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ssh_client;
mod config_manager;
mod auth_manager;
mod backup_history;

use ssh_client::{SshClient, SshConfig};
use config_manager::{ConfigManager, AppSettings};
use auth_manager::AuthManager;
use backup_history::{BackupHistoryManager, BackupHistoryEntry, BackupStatus, BackupStatistics, generate_backup_id};
use tauri::{Manager, State, Emitter};
use std::sync::{Mutex, Arc};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use anyhow::Result;
use serde::Serialize;

// バックアップ結果構造体
#[derive(Serialize)]
pub struct BackupResult {
    pub message: String,
    pub transferred_files: usize,
    pub elapsed_seconds: u64,
}


// アプリケーション状態
pub struct AppState {
    config_manager: Mutex<ConfigManager>,
    auth_manager: Mutex<AuthManager>,
    backup_history_manager: Mutex<BackupHistoryManager>,
    backup_cancel_flag: Arc<AtomicBool>,
}

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// X-Server固定設定
const XSERVER_HOST: &str = "sv8187.xserver.jp";
const XSERVER_PORT: u16 = 10022;
const XSERVER_USER: &str = "funnybooth";

#[tauri::command]
async fn test_xserver_connection(key_path: String) -> Result<String, String> {
    let config = SshConfig {
        hostname: XSERVER_HOST.to_string(),
        port: XSERVER_PORT,
        username: XSERVER_USER.to_string(),
        key_path,
    };

    let mut client = SshClient::new(config);

    match client.test_connection().await {
        Ok(result) => Ok(result),
        Err(e) => Err(format!("X-Server SSH接続テストに失敗しました: {}", e)),
    }
}

#[tauri::command]
async fn test_ssh_connection(
    hostname: String,
    port: u16,
    username: String,
    key_path: String,
) -> Result<String, String> {
    let config = SshConfig {
        hostname,
        port,
        username,
        key_path,
    };

    let mut client = SshClient::new(config);

    match client.test_connection().await {
        Ok(result) => Ok(result),
        Err(e) => Err(format!("SSH接続テストに失敗しました: {}", e)),
    }
}

#[tauri::command]
async fn find_xserver_domains(key_path: String) -> Result<Vec<String>, String> {
    let config = SshConfig {
        hostname: XSERVER_HOST.to_string(),
        port: XSERVER_PORT,
        username: XSERVER_USER.to_string(),
        key_path,
    };

    let mut client = SshClient::new(config);

    match client.find_domains().await {
        Ok(domains) => Ok(domains),
        Err(e) => Err(format!("X-Serverドメイン探索に失敗しました: {}", e)),
    }
}

#[tauri::command]
async fn list_xserver_directories(
    key_path: String,
    path: String,
) -> Result<Vec<String>, String> {
    let config = SshConfig {
        hostname: XSERVER_HOST.to_string(),
        port: XSERVER_PORT,
        username: XSERVER_USER.to_string(),
        key_path,
    };

    let mut client = SshClient::new(config);

    match client.list_remote_directories(&path).await {
        Ok(dirs) => Ok(dirs),
        Err(e) => Err(format!("X-Serverディレクトリ探索に失敗しました: {}", e)),
    }
}

#[tauri::command]
async fn backup_xserver_folder(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    key_path: String,
    remote_folder: String,
    local_folder: String,
) -> Result<BackupResult, String> {
    let start_time = Instant::now();

    // キャンセルフラグをリセット
    state.backup_cancel_flag.store(false, Ordering::Relaxed);

    let ssh_config = SshConfig {
        hostname: XSERVER_HOST.to_string(),
        port: XSERVER_PORT,
        username: XSERVER_USER.to_string(),
        key_path,
    };

    let mut client = SshClient::new(ssh_config);

    let backup_id = generate_backup_id();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // 進捗レポート用のコールバック関数
    let app_handle_clone = app_handle.clone();
    let progress_callback = move |progress: ssh_client::BackupProgress| {
        let _ = app_handle_clone.emit("backup-progress", &progress);
    };

    match client.backup_folder_with_progress(&remote_folder, &local_folder, state.backup_cancel_flag.clone(), progress_callback).await {
        Ok(result) => {
            let elapsed = start_time.elapsed();

            // 結果文字列からファイル数を抽出（改善版）
            let transferred_files = if result.contains("転送ファイル数:") {
                result
                    .split("転送ファイル数:")
                    .nth(1)
                    .and_then(|s| s.split('\n').next())
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0)
            } else {
                0
            };

            let backup_result = BackupResult {
                message: result.clone(),
                transferred_files,
                elapsed_seconds: elapsed.as_secs(),
            };

            // バックアップ履歴に保存
            let history_entry = BackupHistoryEntry {
                id: backup_id,
                timestamp,
                remote_path: remote_folder,
                local_path: local_folder,
                transferred_files,
                elapsed_seconds: elapsed.as_secs(),
                status: BackupStatus::Success,
                message: result,
                ssh_host: XSERVER_HOST.to_string(),
                ssh_user: XSERVER_USER.to_string(),
            };

            if let Ok(history_manager) = state.backup_history_manager.lock() {
                if let Err(e) = history_manager.add_backup_entry(history_entry) {
                    eprintln!("履歴保存エラー: {}", e);
                }
            }

            Ok(backup_result)
        }
        Err(e) => {
            // 失敗した場合も履歴に保存
            let history_entry = BackupHistoryEntry {
                id: backup_id,
                timestamp,
                remote_path: remote_folder,
                local_path: local_folder,
                transferred_files: 0,
                elapsed_seconds: start_time.elapsed().as_secs(),
                status: BackupStatus::Failed,
                message: format!("バックアップ失敗: {}", e),
                ssh_host: XSERVER_HOST.to_string(),
                ssh_user: XSERVER_USER.to_string(),
            };

            if let Ok(history_manager) = state.backup_history_manager.lock() {
                if let Err(e) = history_manager.add_backup_entry(history_entry) {
                    eprintln!("履歴保存エラー: {}", e);
                }
            }

            Err(format!("X-Serverバックアップに失敗しました: {}", e))
        }
    }
}

#[tauri::command]
async fn backup_folder(
    hostname: String,
    port: u16,
    username: String,
    key_path: String,
    remote_folder: String,
    local_folder: String,
) -> Result<String, String> {
    let ssh_config = SshConfig {
        hostname,
        port,
        username,
        key_path,
    };

    let mut client = SshClient::new(ssh_config);

    match client.backup_folder(&remote_folder, &local_folder).await {
        Ok(result) => Ok(result),
        Err(e) => Err(format!("バックアップに失敗しました: {}", e)),
    }
}

#[tauri::command]
async fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    let config_manager = state.config_manager.lock()
        .map_err(|e| format!("設定管理のロックに失敗しました: {}", e))?;

    config_manager.save_settings(&settings)
        .map_err(|e| format!("設定の保存に失敗しました: {}", e))
}

#[tauri::command]
async fn load_settings(
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    let config_manager = state.config_manager.lock()
        .map_err(|e| format!("設定管理のロックに失敗しました: {}", e))?;

    config_manager.load_settings()
        .map_err(|e| format!("設定の読み込みに失敗しました: {}", e))
}

// PIN認証関連のコマンド
#[tauri::command]
async fn setup_pin(
    state: State<'_, AppState>,
    pin: String,
) -> Result<(), String> {
    let auth_manager = state.auth_manager.lock()
        .map_err(|e| format!("認証管理のロックに失敗しました: {}", e))?;

    auth_manager.setup_pin(&pin)
        .map_err(|e| format!("PIN設定に失敗しました: {}", e))
}

#[tauri::command]
async fn verify_pin(
    state: State<'_, AppState>,
    pin: String,
) -> Result<bool, String> {
    let auth_manager = state.auth_manager.lock()
        .map_err(|e| format!("認証管理のロックに失敗しました: {}", e))?;

    auth_manager.verify_pin(&pin)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn is_pin_enabled(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let auth_manager = state.auth_manager.lock()
        .map_err(|e| format!("認証管理のロックに失敗しました: {}", e))?;

    auth_manager.is_pin_enabled()
        .map_err(|e| format!("PIN状態の確認に失敗しました: {}", e))
}

#[tauri::command]
async fn disable_pin(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth_manager = state.auth_manager.lock()
        .map_err(|e| format!("認証管理のロックに失敗しました: {}", e))?;

    auth_manager.disable_pin()
        .map_err(|e| format!("PIN無効化に失敗しました: {}", e))
}

#[tauri::command]
async fn get_lockout_remaining_minutes(
    state: State<'_, AppState>,
) -> Result<Option<u32>, String> {
    let auth_manager = state.auth_manager.lock()
        .map_err(|e| format!("認証管理のロックに失敗しました: {}", e))?;

    auth_manager.get_lockout_remaining_minutes()
        .map_err(|e| format!("ロックアウト状態の確認に失敗しました: {}", e))
}

// バックアップ履歴関連のコマンド
#[tauri::command]
async fn get_backup_history(
    state: State<'_, AppState>,
) -> Result<Vec<BackupHistoryEntry>, String> {
    let history_manager = state.backup_history_manager.lock()
        .map_err(|e| format!("履歴管理のロックに失敗しました: {}", e))?;

    history_manager.get_recent_history(50) // 最新50件を取得
        .map_err(|e| format!("バックアップ履歴の取得に失敗しました: {}", e))
}

#[tauri::command]
async fn get_backup_statistics(
    state: State<'_, AppState>,
) -> Result<BackupStatistics, String> {
    let history_manager = state.backup_history_manager.lock()
        .map_err(|e| format!("履歴管理のロックに失敗しました: {}", e))?;

    history_manager.get_statistics()
        .map_err(|e| format!("統計情報の取得に失敗しました: {}", e))
}

#[tauri::command]
async fn clear_backup_history(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let history_manager = state.backup_history_manager.lock()
        .map_err(|e| format!("履歴管理のロックに失敗しました: {}", e))?;

    history_manager.clear_history()
        .map_err(|e| format!("履歴のクリアに失敗しました: {}", e))
}

#[tauri::command]
async fn delete_backup_entry(
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<bool, String> {
    let history_manager = state.backup_history_manager.lock()
        .map_err(|e| format!("履歴管理のロックに失敗しました: {}", e))?;

    history_manager.delete_backup_entry(&entry_id)
        .map_err(|e| format!("履歴エントリの削除に失敗しました: {}", e))
}

#[tauri::command]
async fn cancel_backup(state: State<'_, AppState>) -> Result<(), String> {
    state.backup_cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn is_backup_cancelled(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.backup_cancel_flag.load(Ordering::Relaxed))
}

// Dialog機能は一時的に無効化（設定エラー解決のため）

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            config_manager: Mutex::new(
                ConfigManager::new().expect("設定管理の初期化に失敗しました")
            ),
            auth_manager: Mutex::new(
                AuthManager::new().expect("認証管理の初期化に失敗しました")
            ),
            backup_history_manager: Mutex::new(
                BackupHistoryManager::new().expect("履歴管理の初期化に失敗しました")
            ),
            backup_cancel_flag: Arc::new(AtomicBool::new(false)),
        })
        .setup(|app| {
            // メインウィンドウを取得し、表示を確実にする
            let window = app.get_webview_window("main").unwrap();

            // macOS特有の問題を回避するため、少し待ってから表示
            std::thread::sleep(std::time::Duration::from_millis(100));

            // ウィンドウを前面に表示
            window.show().unwrap();
            window.set_focus().unwrap();

            // macOS用の追加設定
            #[cfg(target_os = "macos")]
            {
                window.set_always_on_top(false).unwrap();
                window.center().unwrap();
            }

            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                window.open_devtools();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            test_ssh_connection,
            test_xserver_connection,
            find_xserver_domains,
            list_xserver_directories,
            backup_folder,
            backup_xserver_folder,
            cancel_backup,
            is_backup_cancelled,
            save_settings,
            load_settings,
            setup_pin,
            verify_pin,
            is_pin_enabled,
            disable_pin,
            get_lockout_remaining_minutes,
            get_backup_history,
            get_backup_statistics,
            clear_backup_history,
            delete_backup_entry
            // select_folder,  // 一時的に無効化
            // select_file     // 一時的に無効化
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}