use anyhow::{anyhow, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthSettings {
    pub pin_hash: Option<String>,
    pub is_enabled: bool,
    pub max_attempts: u32,
    pub lockout_duration_minutes: u32,
}

impl Default for AuthSettings {
    fn default() -> Self {
        Self {
            pin_hash: None,
            is_enabled: false,
            max_attempts: 3,
            lockout_duration_minutes: 15,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LockoutInfo {
    pub failed_attempts: u32,
    pub last_attempt_timestamp: u64,
    pub is_locked: bool,
}

impl Default for LockoutInfo {
    fn default() -> Self {
        Self {
            failed_attempts: 0,
            last_attempt_timestamp: 0,
            is_locked: false,
        }
    }
}

pub struct AuthManager {
    config_path: PathBuf,
    lockout_path: PathBuf,
}

impl AuthManager {
    pub fn new() -> Result<Self> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| anyhow!("設定ディレクトリの取得に失敗しました"))?
            .join("kyosho-backup");

        // 設定ディレクトリを作成
        fs::create_dir_all(&config_dir)?;

        Ok(Self {
            config_path: config_dir.join("auth_settings.json"),
            lockout_path: config_dir.join("lockout_info.json"),
        })
    }

    /// PIN認証を有効化し、新しいPINを設定
    pub fn setup_pin(&self, pin: &str) -> Result<()> {
        if pin.len() < 4 || pin.len() > 20 {
            return Err(anyhow!("PINは4文字以上20文字以下で設定してください"));
        }

        // 数字のみ許可
        if !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(anyhow!("PINは数字のみ使用してください"));
        }

        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let pin_hash = argon2
            .hash_password(pin.as_bytes(), &salt)
            .map_err(|e| anyhow!("PINハッシュ化に失敗しました: {}", e))?
            .to_string();

        let settings = AuthSettings {
            pin_hash: Some(pin_hash),
            is_enabled: true,
            ..Default::default()
        };

        self.save_auth_settings(&settings)?;

        // ロックアウト情報をリセット
        self.reset_lockout_info()?;

        Ok(())
    }

    /// PIN認証を無効化
    pub fn disable_pin(&self) -> Result<()> {
        let mut settings = self.load_auth_settings()?;
        settings.is_enabled = false;
        settings.pin_hash = None;
        self.save_auth_settings(&settings)?;
        self.reset_lockout_info()?;
        Ok(())
    }

    /// PIN認証が有効かチェック
    pub fn is_pin_enabled(&self) -> Result<bool> {
        let settings = self.load_auth_settings()?;
        Ok(settings.is_enabled && settings.pin_hash.is_some())
    }

    /// PIN認証を実行
    pub fn verify_pin(&self, pin: &str) -> Result<bool> {
        let settings = self.load_auth_settings()?;
        let mut lockout_info = self.load_lockout_info()?;

        // PIN認証が無効な場合は常に成功
        if !settings.is_enabled || settings.pin_hash.is_none() {
            return Ok(true);
        }

        // ロックアウト状態をチェック
        if self.is_locked_out(&settings, &lockout_info)? {
            return Err(anyhow!(
                "ロックアウト中です。{}分後に再試行してください",
                settings.lockout_duration_minutes
            ));
        }

        let pin_hash = settings
            .pin_hash
            .as_ref()
            .ok_or_else(|| anyhow!("PIN設定が見つかりません"))?;

        let parsed_hash = PasswordHash::new(pin_hash)
            .map_err(|e| anyhow!("保存されたPINハッシュが無効です: {}", e))?;

        let argon2 = Argon2::default();
        let is_valid = argon2.verify_password(pin.as_bytes(), &parsed_hash).is_ok();

        if is_valid {
            // 認証成功時はロックアウト情報をリセット
            self.reset_lockout_info()?;
            Ok(true)
        } else {
            // 認証失敗時はカウンタを更新
            lockout_info.failed_attempts += 1;
            lockout_info.last_attempt_timestamp = self.current_timestamp();

            if lockout_info.failed_attempts >= settings.max_attempts {
                lockout_info.is_locked = true;
            }

            self.save_lockout_info(&lockout_info)?;

            let remaining_attempts = settings.max_attempts.saturating_sub(lockout_info.failed_attempts);
            if remaining_attempts > 0 {
                Err(anyhow!(
                    "PINが正しくありません。あと{}回失敗するとロックアウトされます",
                    remaining_attempts
                ))
            } else {
                Err(anyhow!(
                    "PINが正しくありません。{}分間ロックアウトされました",
                    settings.lockout_duration_minutes
                ))
            }
        }
    }

    /// ロックアウト状態をチェック
    fn is_locked_out(&self, settings: &AuthSettings, lockout_info: &LockoutInfo) -> Result<bool> {
        if !lockout_info.is_locked {
            return Ok(false);
        }

        let current_time = self.current_timestamp();
        let lockout_duration_seconds = settings.lockout_duration_minutes as u64 * 60;

        if current_time >= lockout_info.last_attempt_timestamp + lockout_duration_seconds {
            // ロックアウト期間が過ぎたのでリセット
            self.reset_lockout_info()?;
            Ok(false)
        } else {
            Ok(true)
        }
    }

    /// 現在のタイムスタンプを取得（Unix秒）
    fn current_timestamp(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// 認証設定を保存
    fn save_auth_settings(&self, settings: &AuthSettings) -> Result<()> {
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| anyhow!("認証設定のシリアライズに失敗しました: {}", e))?;

        fs::write(&self.config_path, json)
            .map_err(|e| anyhow!("認証設定の保存に失敗しました: {}", e))?;

        Ok(())
    }

    /// 認証設定を読み込み
    fn load_auth_settings(&self) -> Result<AuthSettings> {
        if !self.config_path.exists() {
            return Ok(AuthSettings::default());
        }

        let json = fs::read_to_string(&self.config_path)
            .map_err(|e| anyhow!("認証設定の読み込みに失敗しました: {}", e))?;

        let settings = serde_json::from_str(&json)
            .map_err(|e| anyhow!("認証設定のパースに失敗しました: {}", e))?;

        Ok(settings)
    }

    /// ロックアウト情報を保存
    fn save_lockout_info(&self, lockout_info: &LockoutInfo) -> Result<()> {
        let json = serde_json::to_string_pretty(lockout_info)
            .map_err(|e| anyhow!("ロックアウト情報のシリアライズに失敗しました: {}", e))?;

        fs::write(&self.lockout_path, json)
            .map_err(|e| anyhow!("ロックアウト情報の保存に失敗しました: {}", e))?;

        Ok(())
    }

    /// ロックアウト情報を読み込み
    fn load_lockout_info(&self) -> Result<LockoutInfo> {
        if !self.lockout_path.exists() {
            return Ok(LockoutInfo::default());
        }

        let json = fs::read_to_string(&self.lockout_path)
            .map_err(|e| anyhow!("ロックアウト情報の読み込みに失敗しました: {}", e))?;

        let lockout_info = serde_json::from_str(&json)
            .map_err(|e| anyhow!("ロックアウト情報のパースに失敗しました: {}", e))?;

        Ok(lockout_info)
    }

    /// ロックアウト情報をリセット
    fn reset_lockout_info(&self) -> Result<()> {
        self.save_lockout_info(&LockoutInfo::default())
    }

    /// ロックアウト残り時間を取得（分）
    pub fn get_lockout_remaining_minutes(&self) -> Result<Option<u32>> {
        let settings = self.load_auth_settings()?;
        let lockout_info = self.load_lockout_info()?;

        if !lockout_info.is_locked {
            return Ok(None);
        }

        let current_time = self.current_timestamp();
        let lockout_duration_seconds = settings.lockout_duration_minutes as u64 * 60;
        let unlock_time = lockout_info.last_attempt_timestamp + lockout_duration_seconds;

        if current_time >= unlock_time {
            Ok(None)
        } else {
            let remaining_seconds = unlock_time - current_time;
            let remaining_minutes = (remaining_seconds + 59) / 60; // 切り上げ
            Ok(Some(remaining_minutes as u32))
        }
    }
}