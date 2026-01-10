use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use anyhow::{Context, Result};
use base64::{engine::general_purpose, Engine as _};
use dirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::ssh_client::BackupConfig;

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    pub backup_configs: Vec<BackupConfig>,
    pub default_local_backup_path: Option<String>,
    pub auto_backup_enabled: bool,
    pub auto_backup_interval_hours: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            backup_configs: Vec::new(),
            default_local_backup_path: None,
            auto_backup_enabled: false,
            auto_backup_interval_hours: 24,
        }
    }
}

pub struct ConfigManager {
    config_path: PathBuf,
    encryption_key: [u8; 32],
}

impl ConfigManager {
    pub fn new() -> Result<Self> {
        // アプリケーション設定ディレクトリを取得
        let config_dir = dirs::config_dir()
            .context("設定ディレクトリの取得に失敗しました")?
            .join("kyosho-backup");

        // ディレクトリが存在しない場合は作成
        fs::create_dir_all(&config_dir)
            .context("設定ディレクトリの作成に失敗しました")?;

        let config_path = config_dir.join("settings.enc");

        // 暗号化キーの生成/読み取り
        let key_path = config_dir.join("key.dat");
        let encryption_key = if key_path.exists() {
            fs::read(&key_path)
                .context("暗号化キーの読み取りに失敗しました")?
                .try_into()
                .map_err(|_| anyhow::anyhow!("無効な暗号化キーファイル"))?
        } else {
            let key = Aes256Gcm::generate_key(&mut rand::thread_rng());
            fs::write(&key_path, &key)
                .context("暗号化キーの保存に失敗しました")?;
            key.into()
        };

        Ok(Self {
            config_path,
            encryption_key,
        })
    }

    /// 設定を暗号化して保存
    pub fn save_settings(&self, settings: &AppSettings) -> Result<()> {
        // JSONにシリアライズ
        let json_data = serde_json::to_vec(settings)
            .context("設定のシリアライズに失敗しました")?;

        // AES-256-GCMで暗号化
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.encryption_key));
        let nonce = Aes256Gcm::generate_nonce(&mut rand::thread_rng());

        let ciphertext = cipher
            .encrypt(&nonce, json_data.as_ref())
            .map_err(|e| anyhow::anyhow!("暗号化に失敗しました: {}", e))?;

        // Nonce + Ciphertextの形式で保存
        let mut encrypted_data = Vec::new();
        encrypted_data.extend_from_slice(&nonce);
        encrypted_data.extend_from_slice(&ciphertext);

        // Base64エンコードして保存
        let encoded_data = general_purpose::STANDARD.encode(encrypted_data);
        fs::write(&self.config_path, encoded_data)
            .context("暗号化された設定ファイルの保存に失敗しました")?;

        Ok(())
    }

    /// 暗号化された設定を読み込み
    pub fn load_settings(&self) -> Result<AppSettings> {
        if !self.config_path.exists() {
            // 設定ファイルが存在しない場合はデフォルト設定を返す
            return Ok(AppSettings::default());
        }

        // Base64デコード
        let encoded_data = fs::read_to_string(&self.config_path)
            .context("暗号化された設定ファイルの読み取りに失敗しました")?;

        let encrypted_data = general_purpose::STANDARD
            .decode(encoded_data.trim())
            .context("Base64デコードに失敗しました")?;

        if encrypted_data.len() < 12 {
            return Err(anyhow::anyhow!("無効な暗号化データです"));
        }

        // NonceとCiphertextを分離
        let (nonce_bytes, ciphertext) = encrypted_data.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        // 復号化
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.encryption_key));
        let decrypted_data = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("復号化に失敗しました: {}", e))?;

        // JSONデシリアライズ
        let settings: AppSettings = serde_json::from_slice(&decrypted_data)
            .context("設定のデシリアライズに失敗しました")?;

        Ok(settings)
    }

    /// 設定ファイルが存在するかチェック
    pub fn settings_exist(&self) -> bool {
        self.config_path.exists()
    }

    /// 設定ファイルを削除
    pub fn delete_settings(&self) -> Result<()> {
        if self.config_path.exists() {
            fs::remove_file(&self.config_path)
                .context("設定ファイルの削除に失敗しました")?;
        }
        Ok(())
    }
}