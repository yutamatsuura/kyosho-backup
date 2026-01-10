use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupHistoryEntry {
    pub id: String,
    pub timestamp: u64, // Unix timestamp
    pub remote_path: String,
    pub local_path: String,
    pub transferred_files: usize,
    pub elapsed_seconds: u64,
    pub status: BackupStatus,
    pub message: String,
    pub ssh_host: String,
    pub ssh_user: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum BackupStatus {
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupHistory {
    pub entries: Vec<BackupHistoryEntry>,
    pub last_updated: u64,
    pub total_backups: usize,
    pub successful_backups: usize,
    pub failed_backups: usize,
}

impl Default for BackupHistory {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            last_updated: 0,
            total_backups: 0,
            successful_backups: 0,
            failed_backups: 0,
        }
    }
}

pub struct BackupHistoryManager {
    history_path: PathBuf,
}

impl BackupHistoryManager {
    pub fn new() -> Result<Self> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| anyhow!("設定ディレクトリの取得に失敗しました"))?
            .join("kyosho-backup");

        // 設定ディレクトリを作成
        fs::create_dir_all(&config_dir)?;

        Ok(Self {
            history_path: config_dir.join("backup_history.json"),
        })
    }

    /// バックアップエントリを追加
    pub fn add_backup_entry(&self, entry: BackupHistoryEntry) -> Result<()> {
        let mut history = self.load_history()?;

        // 統計を更新
        history.entries.push(entry.clone());
        history.total_backups += 1;
        history.last_updated = self.current_timestamp();

        match entry.status {
            BackupStatus::Success => history.successful_backups += 1,
            BackupStatus::Failed => history.failed_backups += 1,
            _ => {}
        }

        // 最新100件のみ保持（メモリとディスク使用量を制限）
        if history.entries.len() > 100 {
            history.entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
            history.entries.truncate(100);
        }

        self.save_history(&history)?;
        Ok(())
    }

    /// バックアップ履歴を取得
    pub fn get_history(&self) -> Result<BackupHistory> {
        self.load_history()
    }

    /// 特定の期間の履歴を取得
    pub fn get_history_by_date_range(&self, start_timestamp: u64, end_timestamp: u64) -> Result<Vec<BackupHistoryEntry>> {
        let history = self.load_history()?;

        let filtered_entries: Vec<BackupHistoryEntry> = history
            .entries
            .into_iter()
            .filter(|entry| entry.timestamp >= start_timestamp && entry.timestamp <= end_timestamp)
            .collect();

        Ok(filtered_entries)
    }

    /// 最新N件の履歴を取得
    pub fn get_recent_history(&self, limit: usize) -> Result<Vec<BackupHistoryEntry>> {
        let history = self.load_history()?;

        let mut sorted_entries = history.entries;
        sorted_entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        if limit > 0 && sorted_entries.len() > limit {
            sorted_entries.truncate(limit);
        }

        Ok(sorted_entries)
    }

    /// 統計情報を取得
    pub fn get_statistics(&self) -> Result<BackupStatistics> {
        let history = self.load_history()?;

        let total_files_transferred: usize = history.entries.iter()
            .map(|entry| entry.transferred_files)
            .sum();

        let total_time_spent: u64 = history.entries.iter()
            .map(|entry| entry.elapsed_seconds)
            .sum();

        let avg_files_per_backup = if history.total_backups > 0 {
            total_files_transferred as f64 / history.total_backups as f64
        } else {
            0.0
        };

        let avg_time_per_backup = if history.total_backups > 0 {
            total_time_spent as f64 / history.total_backups as f64
        } else {
            0.0
        };

        let success_rate = if history.total_backups > 0 {
            (history.successful_backups as f64 / history.total_backups as f64) * 100.0
        } else {
            0.0
        };

        // 最後のバックアップ日時
        let last_backup_timestamp = history.entries.iter()
            .map(|entry| entry.timestamp)
            .max()
            .unwrap_or(0);

        Ok(BackupStatistics {
            total_backups: history.total_backups,
            successful_backups: history.successful_backups,
            failed_backups: history.failed_backups,
            success_rate,
            total_files_transferred,
            total_time_spent,
            avg_files_per_backup,
            avg_time_per_backup,
            last_backup_timestamp,
        })
    }

    /// 履歴を削除
    pub fn clear_history(&self) -> Result<()> {
        let empty_history = BackupHistory::default();
        self.save_history(&empty_history)?;
        Ok(())
    }

    /// バックアップエントリを削除（IDで指定）
    pub fn delete_backup_entry(&self, entry_id: &str) -> Result<bool> {
        let mut history = self.load_history()?;
        let initial_len = history.entries.len();

        history.entries.retain(|entry| entry.id != entry_id);

        if history.entries.len() < initial_len {
            // 統計を再計算
            self.recalculate_statistics(&mut history);
            self.save_history(&history)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// 現在のタイムスタンプを取得（Unix秒）
    fn current_timestamp(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// 履歴を保存
    fn save_history(&self, history: &BackupHistory) -> Result<()> {
        let json = serde_json::to_string_pretty(history)
            .map_err(|e| anyhow!("履歴データのシリアライズに失敗しました: {}", e))?;

        fs::write(&self.history_path, json)
            .map_err(|e| anyhow!("履歴データの保存に失敗しました: {}", e))?;

        Ok(())
    }

    /// 履歴を読み込み
    fn load_history(&self) -> Result<BackupHistory> {
        if !self.history_path.exists() {
            return Ok(BackupHistory::default());
        }

        let json = fs::read_to_string(&self.history_path)
            .map_err(|e| anyhow!("履歴データの読み込みに失敗しました: {}", e))?;

        let history = serde_json::from_str(&json)
            .map_err(|e| anyhow!("履歴データのパースに失敗しました: {}", e))?;

        Ok(history)
    }

    /// 統計を再計算
    fn recalculate_statistics(&self, history: &mut BackupHistory) {
        history.total_backups = history.entries.len();
        history.successful_backups = history.entries.iter()
            .filter(|entry| matches!(entry.status, BackupStatus::Success))
            .count();
        history.failed_backups = history.entries.iter()
            .filter(|entry| matches!(entry.status, BackupStatus::Failed))
            .count();
        history.last_updated = self.current_timestamp();
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupStatistics {
    pub total_backups: usize,
    pub successful_backups: usize,
    pub failed_backups: usize,
    pub success_rate: f64,
    pub total_files_transferred: usize,
    pub total_time_spent: u64,
    pub avg_files_per_backup: f64,
    pub avg_time_per_backup: f64,
    pub last_backup_timestamp: u64,
}

/// ユニークIDを生成（バックアップエントリ用）
pub fn generate_backup_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let random_suffix: u32 = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        timestamp.hash(&mut hasher);
        std::thread::current().id().hash(&mut hasher);
        hasher.finish() as u32
    };

    format!("backup_{}_{}", timestamp, random_suffix)
}