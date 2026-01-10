// Tauri APIの型定義

export interface SshConfig {
  hostname: string;
  port: number;
  username: string;
  key_path: string;
}

export interface BackupConfig {
  ssh: SshConfig;
  remote_folder: string;
  local_folder: string;
}

export interface AppSettings {
  backup_configs: BackupConfig[];
  default_local_backup_path?: string;
  auto_backup_enabled: boolean;
  auto_backup_interval_hours: number;
}

// バックアップ結果型
export interface BackupResult {
  message: string;
  transferred_files: number;
  elapsed_seconds: number;
}

// バックアップ進捗情報型
export interface BackupProgress {
  phase: string;                      // 現在のフェーズ（接続中、探索中、転送中など）
  transferred_files: number;          // 転送済みファイル数
  total_files?: number;               // 総ファイル数（判明している場合）
  transferred_bytes: number;          // 転送済みバイト数
  current_file?: string;              // 現在処理中のファイル名
  elapsed_seconds: number;            // 経過時間
  transfer_speed?: number;            // 転送速度 (MB/s)
}

// バックアップ履歴エントリ型
export interface BackupHistoryEntry {
  id: string;
  timestamp: number;
  remote_path: string;
  local_path: string;
  transferred_files: number;
  elapsed_seconds: number;
  status: 'Success' | 'Failed' | 'Cancelled';
  message: string;
  ssh_host: string;
  ssh_user: string;
}

// バックアップ統計情報型
export interface BackupStatistics {
  total_backups: number;
  successful_backups: number;
  failed_backups: number;
  success_rate: number;
  total_files_transferred: number;
  total_time_spent: number;
  avg_files_per_backup: number;
  avg_time_per_backup: number;
  last_backup_timestamp: number;
}

// Tauriコマンドの戻り値型
export type TauriResult<T> = Promise<T>;
export type TauriError = string;

// Tauriコマンドインターフェース
export interface TauriCommands {
  greet: (name: string) => TauriResult<string>;

  test_ssh_connection: (
    hostname: string,
    port: number,
    username: string,
    key_path: string
  ) => TauriResult<string>;

  backup_folder: (
    hostname: string,
    port: number,
    username: string,
    key_path: string,
    remote_folder: string,
    local_folder: string
  ) => TauriResult<string>;

  save_settings: (settings: AppSettings) => TauriResult<void>;
  load_settings: () => TauriResult<AppSettings>;

  // PIN認証関連
  setup_pin: (pin: string) => TauriResult<void>;
  verify_pin: (pin: string) => TauriResult<boolean>;
  is_pin_enabled: () => TauriResult<boolean>;
  disable_pin: () => TauriResult<void>;
  get_lockout_remaining_minutes: () => TauriResult<number | null>;

  // バックアップ履歴関連
  get_backup_history: () => TauriResult<BackupHistoryEntry[]>;
  get_backup_statistics: () => TauriResult<BackupStatistics>;
  clear_backup_history: () => TauriResult<void>;
  delete_backup_entry: (entry_id: string) => TauriResult<boolean>;

  select_folder: () => TauriResult<string | null>;
  select_file: () => TauriResult<string | null>;
}

// フォームデータ型
export interface SettingsFormData {
  hostname: string;
  port: number;
  username: string;
  keyPath: string;
  remoteFolder: string;
  localFolder: string;
}